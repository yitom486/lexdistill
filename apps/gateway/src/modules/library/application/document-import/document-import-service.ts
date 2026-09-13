import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import { markdownToAst } from '@study-studio/content';
import { convertPdfToAst } from '../pdf-import/pdf-import-service.js';
import type { PdfImportServiceDeps } from '../pdf-import/pdf-import-service.js';
import {
  DOCUMENT_SOURCE_KINDS,
  guessSourceKind,
  type DocumentSourceKind,
  type DocumentImporter,
} from './document-source.js';
import { decodeTextBytes } from './text-reader.js';
import { extractEpubText } from './epub-reader.js';
import { extractMobiText } from './mobi-reader.js';
import { extractWebArticle } from './url-reader.js';
import {
  createImportTask,
  updateImportTask,
  type ImportTask,
} from '../../persistence/import-tasks.js';
import { saveCanonicalAst } from '../../persistence/documents-annotations.js';
import type { RepoDeps } from '../../../../infrastructure/persistence/repo-context.js';

/**
 * 文档导入统一命令（HTTP / Tool / 未来 WS 任务共用）。
 *
 * 流程（LinguaCafe 式任务化，本仓库保持同步执行、状态落库）：
 * 建任务（processing）→ 源提取 markdown → markdownToAst → 入库 → 任务 done/failed。
 * PDF 走既有 convertPdfToAst（含 OCR 运行时能力层）；EPUB/文本走自研提取。
 * 原文不进库（content 只存前 2000 字摘要，与既有 PDF 导入一致）；失败可重发同一输入。
 */

const TEXT_PUBLISHER: Record<DocumentSourceKind, string> = {
  pdf: 'PDF导入（自有资料）',
  epub: 'EPUB导入（自有资料）',
  mobi: 'MOBI导入（自有资料）',
  text: '文本导入（自有资料）',
  url: '网页导入（自有学习）',
};

/** 本机文档直读（大文件不走 HTTP 拷贝；上限按来源：pdf 200MB / epub 100MB / text 5MB）。 */
export async function readDocumentFileBytes(
  filePath: string,
  kind: DocumentSourceKind
): Promise<Result<Uint8Array, BusinessError>> {
  try {
    const { promises: fsp } = await import('node:fs');
    const { default: path } = await import('node:path');
    if (!path.isAbsolute(filePath)) {
      return err(new BusinessError('E_INVALID_INPUT', '只接受本机文档绝对路径', 'VALIDATION', false));
    }
    const ext = path.extname(filePath).toLowerCase();
    const extOk =
      (kind === 'pdf' && ext === '.pdf') ||
      (kind === 'epub' && ext === '.epub') ||
      (kind === 'mobi' && (ext === '.mobi' || ext === '.azw')) ||
      (kind === 'text' && (ext === '.txt' || ext === '.md' || ext === '.markdown'));
    if (!extOk) {
      return err(new BusinessError('E_INVALID_INPUT', `文件扩展名与来源不符（${kind}）`, 'VALIDATION', false));
    }
    const cap =
      kind === 'pdf' ? 200 * 1024 * 1024
      : kind === 'epub' ? 100 * 1024 * 1024
      : kind === 'mobi' ? 100 * 1024 * 1024
      : 5 * 1024 * 1024;
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > cap) {
      return err(new BusinessError('E_INVALID_INPUT', '本地文件无效或过大', 'VALIDATION', false));
    }
    return ok(new Uint8Array(await fsp.readFile(filePath)));
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_INVALID_INPUT', '本地文件不存在或无权读取', 'VALIDATION', false));
  }
}

const textImporter: DocumentImporter = {
  kind: 'text',
  extract: async (input) => {
    if (!input.bytes) {
      throw new BusinessError('E_INVALID_INPUT', '文本导入需要字节或直传文本', 'VALIDATION', false);
    }
    return decodeTextBytes(input.bytes, input.filename);
  },
};

const epubImporter: DocumentImporter = {
  kind: 'epub',
  extract: async (input) => {
    if (!input.bytes) {
      throw new BusinessError('E_INVALID_INPUT', 'EPUB 导入需要文件字节', 'VALIDATION', false);
    }
    return extractEpubText(input.bytes, input.filename);
  },
};

const mobiImporter: DocumentImporter = {
  kind: 'mobi',
  extract: async (input) => {
    if (!input.bytes) {
      throw new BusinessError('E_INVALID_INPUT', 'MOBI 导入需要文件字节', 'VALIDATION', false);
    }
    return extractMobiText(input.bytes, input.filename);
  },
};

const urlImporter: DocumentImporter = {
  kind: 'url',
  extract: async (input) => {
    if (!input.url) {
      throw new BusinessError('E_INVALID_INPUT', '网页导入需要 url', 'VALIDATION', false);
    }
    return extractWebArticle(input.url);
  },
};

const IMPORTERS: Record<Exclude<DocumentSourceKind, 'pdf'>, DocumentImporter> = {
  epub: epubImporter,
  mobi: mobiImporter,
  text: textImporter,
  url: urlImporter,
};

export interface DocumentImportInput {
  userId: string;
  kind?: DocumentSourceKind | undefined;
  filename: string;
  bytes?: Uint8Array | undefined;
  /** kind=url 时必填（经 SSRF 防护后抓取） */
  url?: string | undefined;
  /** CMD-01：已确认结构分类（仅 pdf 分支透传给 convert；缺席走旧行为） */
  classes?: unknown;
}

export interface DocumentImportOutput {
  task: ImportTask;
  document: DocumentItem;
  book: TextbookAST;
  lessons: number;
  /** 目录单元标签（EPUB 目录驱动；无目录为空） */
  toc: string[];
}

export interface DocumentImportDeps {
  loadInspector?: PdfImportServiceDeps['loadInspector'];
  runtimeDir?: string;
}

function failReason(e: unknown): string {
  if (e instanceof BusinessError) return e.userMessage;
  return '导入运行时异常，请稍后重试';
}

export async function importDocument(
  deps: RepoDeps,
  readers: DocumentImportDeps,
  input: DocumentImportInput
): Promise<Result<DocumentImportOutput, BusinessError>> {
  const kind: DocumentSourceKind =
    input.kind ?? guessSourceKind(input.filename) ?? 'text';
  if (!DOCUMENT_SOURCE_KINDS.includes(kind)) {
    return err(new BusinessError('E_INVALID_INPUT', '不支持的导入来源（pdf/epub/mobi/txt/md/url）', 'VALIDATION', false));
  }
  if (kind !== 'url' && (!input.bytes || input.bytes.length === 0)) {
    return err(new BusinessError('E_INVALID_INPUT', '文件为空，无法导入', 'VALIDATION', false));
  }
  if (kind === 'url' && !input.url) {
    return err(new BusinessError('E_INVALID_INPUT', '网页导入需要 url', 'VALIDATION', false));
  }
  const taskCreated = await createImportTask(deps, {
    userId: input.userId,
    sourceKind: kind,
    filename: input.filename,
  });
  if (!isOk(taskCreated)) return taskCreated;
  const task = taskCreated.value;
  try {
    let title: string;
    let markdown: string;
    let toc: string[] = [];
    if (kind === 'pdf') {
      if (!input.bytes) throw new BusinessError('E_INVALID_INPUT', 'PDF 导入需要文件字节', 'VALIDATION', false);
      const converted = await convertPdfToAst(
        {
          ...(readers.loadInspector ? { loadInspector: readers.loadInspector } : {}),
          ...(readers.runtimeDir ? { runtimeDir: readers.runtimeDir } : {}),
        },
        {
          userId: input.userId,
          filename: input.filename,
          bytes: input.bytes,
          ...(input.classes !== undefined ? { classes: input.classes } : {}),
        }
      );
      if (!isOk(converted)) throw converted.error;
      title = converted.value.book.title;
      markdown = converted.value.markdown;
    } else {
      const importer = IMPORTERS[kind];
      const extracted = await importer.extract({
        ...(input.bytes ? { bytes: input.bytes } : {}),
        ...(input.url ? { url: input.url } : {}),
        filename: input.filename,
      });
      title = extracted.title;
      markdown = extracted.markdown;
      if (extracted.units) toc = extracted.units.filter((t): t is string => typeof t === 'string');
    }
    const ast = markdownToAst(markdown, { title });
    if (!isOk(ast)) throw ast.error;
    const book = ast.value;
    const now = nowIso();
    // 唯一 canonical 写入口：AST + shred 同一事务；失败即抛（任务 failed），
    // 不再“AST 已存、shred 失败仅 WARN”（旧双源漂移，已消除）。
    const saved = await saveCanonicalAst(deps, {
      id: generateId('doc'),
      userId: input.userId,
      title: book.title,
      sourceKind: 'user_import',
      language: book.language.toLowerCase(),
      content: markdown.slice(0, 2000),
      sourcePublisher: TEXT_PUBLISHER[kind],
      createdAt: now,
      updatedAt: now,
    }, book);
    if (!isOk(saved)) throw saved.error;
    const lessons = book.lessons.length;
    const done = await updateImportTask(deps, task.id, {
      status: 'done',
      documentId: saved.value.id,
      lessons,
    });
    if (!isOk(done)) return done;
    return ok({ task: done.value, document: saved.value, book, lessons, toc });
  } catch (e) {
    const message = failReason(e);
    await updateImportTask(deps, task.id, { status: 'failed', error: message });
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'importDocument'));
  }
}
