import {
  BusinessError,
  err,
  generateId,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import {
  convertPdfToAst,
  rangePages,
  validatePdfInput,
  type PdfAstOutput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { narrowPlanAnchors, narrowPlanEntries, planTocSegments } from './toc-segment-plan.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
  TOC_SEGMENT_CHUNK_PAGES,
} from '@study-studio/content';

/**
 * CMD-LINGUA-P5D1：导入一课已验证完整 lesson（本轮唯一写入口）。
 *
 * 只允许：P5-C preview 全绿 + 用户选定一课 + 指纹一致 + 最终确认后，
 * 把该课的**完整 verified range**交给既有 convert 路径，恰一课才经
 * 唯一 canonical 入口（documents + AST + shred 同一事务）落库。
 * 禁止整书/多课/append/任意页范围；任一步失败零残留。
 */

export interface TocLessonImportInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  entries: unknown;
  anchors: unknown;
  lessonIndex: unknown;
  fingerprint: unknown;
  docTitle?: unknown;
}

export interface TocLessonImportDeps extends Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> {
  saveCanonicalAst: (
    docBase: Omit<DocumentItem, 'astJson'>,
    book: TextbookAST
  ) => Promise<Result<DocumentItem, BusinessError>>;
  /**
   * 测试注入：替代既有 convert 路径（默认调 convertPdfToAst）。
   * 生产恒走真实路径；测试用它精确断言喂入页窗与判定分支。
   */
  convertRange?: (input: {
    userId: string;
    filename: string;
    bytes: Uint8Array;
    pages: number[];
  }) => Promise<Result<PdfAstOutput, BusinessError>>;
}

export interface TocLessonImportOutput {
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  stats: { lessons: number; dialogues: number; chunks: number };
}

function mapBookLanguage(language: string): string {
  if (language === 'EN') return 'en';
  if (language === 'KO') return 'ko';
  return 'ja';
}

/**
 * 单课导入编排（写）：
 * 输入校验 → 重跑 preview → 指纹核验 → 七门 gate → convert 精确窗 →
 * 恰一课断言 → 同一事务 canonical 落库。写操作仅最后一步，且单次调用。
 */
export async function importTocLesson(
  deps: TocLessonImportDeps,
  input: TocLessonImportInput
): Promise<Result<TocLessonImportOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  if (typeof input.lessonIndex !== 'number' || !Number.isSafeInteger(input.lessonIndex) || input.lessonIndex < 0) {
    return err(new BusinessError('E_INVALID_INPUT', '所选条目不存在或不是可导入课', 'VALIDATION'));
  }
  if (typeof input.fingerprint !== 'string' || !input.fingerprint) {
    return err(new BusinessError('E_INVALID_INPUT', '预览指纹缺失，请重新请求分段预览', 'VALIDATION'));
  }
  const titleRaw = typeof input.docTitle === 'string' ? input.docTitle.trim() : '';

  // 重跑 preview（当前 PDF + 当前 entries/anchors；其它一律不信客户端）。
  const planned = await planTocSegments(deps, {
    userId: input.userId,
    filename: input.filename,
    bytes: input.bytes,
    entries: input.entries,
    anchors: input.anchors,
  });
  if (!isOk(planned)) return planned;
  const preview = planned.value;

  // 指纹核验：用服务端窄化后的规范输入重算，逐字比对。
  const entries = narrowPlanEntries(input.entries);
  const anchors = narrowPlanAnchors(input.anchors);
  if (!entries || !anchors) {
    return err(new BusinessError('E_INVALID_INPUT', '已确认目录或 anchor 形状不正确', 'VALIDATION'));
  }
  const expected = fingerprintTocPlan({
    pageCount: preview.pageCount,
    pdfHashHex: sha256HexBytes(input.bytes),
    entries,
    anchors,
  });
  if (expected !== input.fingerprint) {
    return err(
      new BusinessError(
        'E_TOC_PLAN_STALE',
        '分段预览已过期（目录、anchor 或文件可能已变更），请重新请求预览后再导入',
        'VALIDATION'
      )
    );
  }

  // 七门 gate（fail-closed，不退化）。
  if (preview.diagnostics.unresolvedCount !== 0) {
    return err(new BusinessError('E_INVALID_INPUT', '当前目录不能自动导入；请补充或修正 anchor', 'VALIDATION'));
  }
  if (preview.diagnostics.lessonsWithoutEnd !== 0) {
    return err(new BusinessError('E_INVALID_INPUT', '存在没有终点的课，不能确定导入范围', 'VALIDATION'));
  }
  const lesson = preview.lessons[input.lessonIndex];
  if (!lesson) {
    return err(new BusinessError('E_INVALID_INPUT', '所选条目不存在或不是可导入课', 'VALIDATION'));
  }
  if (lesson.status !== 'mapped' || lesson.physicalStart === null || lesson.physicalEnd === null) {
    return err(new BusinessError('E_INVALID_INPUT', '所选课尚未映射到确定物理范围', 'VALIDATION'));
  }
  const rangeLength = lesson.physicalEnd - lesson.physicalStart + 1;
  if (rangeLength < 1 || rangeLength > TOC_SEGMENT_CHUNK_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `该课共 ${rangeLength} 页（单次导入上限 ${TOC_SEGMENT_CHUNK_PAGES} 页），不能导入`,
        'VALIDATION'
      )
    );
  }
  const lessonChunks = preview.chunks.filter((c) => c.lessonIndex === lesson.lessonIndex);
  if (
    lessonChunks.length !== 1 ||
    lessonChunks[0]?.physicalFrom !== lesson.physicalStart ||
    lessonChunks[0]?.physicalTo !== lesson.physicalEnd
  ) {
    return err(new BusinessError('E_INVALID_INPUT', '所选课不是一个完整 chunk，不能导入', 'VALIDATION'));
  }

  // 仅把 verified range 交给既有 convert 路径（客户端没有任何页范围输入可绕过）。
  const pages = rangePages(lesson.physicalStart, lesson.physicalEnd);
  const converted = deps.convertRange
    ? await deps.convertRange({ userId: input.userId, filename: input.filename, bytes: input.bytes, pages })
    : await convertPdfToAst(
        {
          ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
          ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
        },
        { userId: input.userId, filename: input.filename, bytes: input.bytes, pages }
      );
  if (!isOk(converted)) return converted;
  const book = converted.value.book;
  if (book.lessons.length !== 1) {
    return err(
      new BusinessError(
        'E_TOC_LESSON_SHAPE',
        book.lessons.length === 0
          ? '该范围没有解析出可用课程，已取消导入，未写入任何数据'
          : `该范围解析出 ${book.lessons.length} 课（只允许恰一课），已取消导入，未写入任何数据`,
        'TOOL_EXECUTION'
      )
    );
  }
  const only = book.lessons[0];
  if (!only) {
    return err(new BusinessError('E_TOC_LESSON_SHAPE', '该范围没有解析出可用课程，已取消导入，未写入任何数据', 'TOOL_EXECUTION'));
  }

  // 唯一 canonical 写入口：新 id 服务端生成（杜绝覆盖他人文档），同一事务落库。
  const now = new Date().toISOString();
  const docBase: Omit<DocumentItem, 'astJson'> = {
    id: generateId('doc'),
    userId: input.userId,
    title: titleRaw ? titleRaw.slice(0, 120) : only.title,
    sourceKind: 'user_import',
    language: mapBookLanguage(book.language),
    content: `单课试导入 · 印刷${lesson.printedStart}页 · 物理${lesson.physicalStart}–${lesson.physicalEnd}页`,
    createdAt: now,
    updatedAt: now,
  };
  let saved: DocumentItem;
  try {
    const res = await deps.saveCanonicalAst(docBase, book);
    if (!isOk(res)) return res;
    saved = res.value;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_LESSON_IMPORT:save'));
  }

  // 只记计数：不记标题、folio、anchor、路径、用户。
  logger.warn('[toc-lesson-import] 完成', {
    pages: rangeLength,
    dialogues: only.dialogues.length,
    chunks: 1,
  });
  return ok({
    documentId: saved.id,
    lessonId: only.id,
    lessonTitle: only.title,
    range: { fromPage: lesson.physicalStart, toPage: lesson.physicalEnd },
    pageCount: preview.pageCount,
    stats: { lessons: 1, dialogues: only.dialogues.length, chunks: 1 },
  });
}
