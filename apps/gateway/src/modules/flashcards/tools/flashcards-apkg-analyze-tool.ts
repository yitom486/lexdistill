import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@lexdistill/shared';
import {
  readApkgFileBytes,
  analyzeApkg,
  type ApkgAnalysis,
} from '../application/apkg-import.js';

export const FlashcardsApkgAnalyzeInputSchema = z.object({
  /** 本机 .apkg 绝对路径（只读分析，不写库）。 */
  filePath: z.string().min(1).max(1024),
});

export type FlashcardsApkgAnalyzeInput = z.infer<typeof FlashcardsApkgAnalyzeInputSchema>;

/**
 * `.apkg` 只读分析 Server Tool（READ）。
 * AI 读用户 Anki 包内容（牌组/笔记/模板草稿/映射推测）前先看结构；搬家另调导入命令。
 */
export class FlashcardsApkgAnalyzeTool
  implements ToolDefinition<FlashcardsApkgAnalyzeInput, ApkgAnalysis>
{
  public readonly name = 'flashcards.apkg_analyze';
  public readonly description =
    '只读分析本机 .apkg（牌组/笔记计数 + 模板草稿 + 字段映射推测 + 兼容性）。不写库。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = FlashcardsApkgAnalyzeInputSchema;

  public async execute(
    input: FlashcardsApkgAnalyzeInput,
    _context: ToolExecutionContext
  ): Promise<Result<ApkgAnalysis, BusinessError>> {
    void _context;
    const bytes = await readApkgFileBytes(input.filePath);
    if (!isOk(bytes)) return bytes;
    const label = input.filePath.split(/[\\/]/).pop() ?? 'package.apkg';
    const result = await analyzeApkg(bytes.value, label);
    if (!isOk(result)) return result;
    return ok(result.value);
  }
}
