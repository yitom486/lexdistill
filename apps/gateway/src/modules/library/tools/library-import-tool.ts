import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, err, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { ContentRepository } from '../ports.js';
import { readDocumentFileBytes } from '../application/document-import/document-import-service.js';
import type { ImportTask } from '../persistence/import-tasks.js';

export const LibraryImportInputSchema = z.object({
  userId: z.string().min(1).max(64),
  kind: z.enum(['pdf', 'epub', 'mobi', 'text', 'url']).optional(),
  /** 本机文档绝对路径（只读，不走 HTTP 拷贝；与 url 二选一）。 */
  filePath: z.string().min(1).max(1024).optional(),
  /** 网址（kind=url 时必填，经 SSRF 防护后抓取）。 */
  url: z.string().min(1).max(2048).optional(),
});

export type LibraryImportInput = z.infer<typeof LibraryImportInputSchema>;

export interface LibraryImportOutput {
  task: ImportTask;
  documentId: string;
  title: string;
  lessons: number;
}

/** url 主机名收窄（非法 url 回退通用名，不抛）。 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.slice(0, 64) || '网页';
  } catch {
    return '网页';
  }
}

/**
 * 文档统一导入 Server Tool（WRITE：落库）。
 * PDF/EPUB/文本同一命令；OCR 是能力层，不在本 Tool 内。
 */
export class LibraryImportTool implements ToolDefinition<LibraryImportInput, LibraryImportOutput> {
  public readonly name = 'library.import_document';
  public readonly description =
    '导入本机文档为教材（PDF/EPUB/文本同一入口，落库并返回任务）。AI 帮用户整理资料时调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LibraryImportInputSchema;

  constructor(private readonly learnerRepo: ContentRepository) {}

  public async execute(
    input: LibraryImportInput,
    _context: ToolExecutionContext
  ): Promise<Result<LibraryImportOutput, BusinessError>> {
    void _context;
    if (!input.filePath && !input.url) {
      return err(new BusinessError('E_INVALID_INPUT', '请提供 filePath 或 url（二选一）', 'VALIDATION', false));
    }
    const kind = input.kind ?? 'text';
    let bytes: Uint8Array | undefined;
    if (input.filePath) {
      const read = await readDocumentFileBytes(input.filePath, kind);
      if (!isOk(read)) return read;
      bytes = read.value;
    }
    const filename =
      input.filePath?.split(/[\\/]/).pop() ??
      (input.url ? `网页-${safeHostname(input.url)}` : '未命名');
    const result = await this.learnerRepo.importDocumentFile({
      userId: input.userId,
      kind,
      filename,
      ...(bytes ? { bytes } : {}),
      ...(input.url ? { url: input.url } : {}),
    });
    if (!isOk(result)) return result;
    return ok({
      task: result.value.task,
      documentId: result.value.document.id,
      title: result.value.document.title,
      lessons: result.value.lessons,
    });
  }
}
