import {
  ok,
  type Result,
  type BusinessError,
} from '@lexdistill/shared';
import {
  guessFieldMapping,
  analyzeTemplateCompat,
  type FieldMarker,
} from './render/index.js';
import type { ParsedApkg } from './integrations/index.js';

/**
 * M7-12 自 Gateway `flashcards/application/apkg-import.ts` 迁入只读分析
 * （统计与草稿逻辑逐行一致；实际导入落库仍归 Gateway）。
 *
 * 基于 ParsedApkg 生成分析结果：模型草稿、牌组统计、媒体计数、字段映射、
 * 模板兼容性分析。纯逻辑：不引入时钟、数据库、文件读写、SQLite、Drizzle、
 * Gateway、Agent 或 Web 依赖。
 */

export interface ApkgModelDraft {
  modelName: string;
  ankiFields: string[];
  front: string;
  back: string;
  css: string;
  fieldMapping: Record<string, FieldMarker | null>;
  compatIssues: string[];
  exampleNoteCount: number;
}

export interface ApkgDeckSummary {
  name: string;
  noteCount: number;
}

export interface ApkgAnalysis {
  fileLabel: string;
  noteCount: number;
  cardCount: number;
  decks: ApkgDeckSummary[];
  models: ApkgModelDraft[];
  mediaFileCount: number;
  mediaRefCount: number;
  truncated: boolean;
}

/**
 * 只读分析（牌组/笔记计数 + 模板草稿 + 映射推测 + 兼容性；不写库）。
 * - 每个 model 统计示例笔记数；deck 与 model 均按计数降序；
 * - fieldMapping 经 guessFieldMapping，compatIssues 经 analyzeTemplateCompat；
 * - truncated 恒为 false（本用例不做截断，截断口径归导入流程）。
 */
export function analyzeParsedApkg(
  parsed: ParsedApkg,
  fileLabel: string
): Result<ApkgAnalysis, BusinessError> {
  // 无内部 try/catch：guessFieldMapping / analyzeTemplateCompat 的意外异常
  // 自然冒泡，由 Gateway analyzeApkg 的 translateToBusinessError 统一翻译。
  const modelNoteCounts = new Map<string, number>();
  for (const n of parsed.notes) {
    modelNoteCounts.set(n.mid, (modelNoteCounts.get(n.mid) ?? 0) + 1);
  }
  const models: ApkgModelDraft[] = [];
  for (const [mid, m] of parsed.models) {
    models.push({
      modelName: m.name,
      ankiFields: m.fields,
      front: m.front,
      back: m.back,
      css: m.css,
      fieldMapping: guessFieldMapping(m.fields),
      compatIssues: analyzeTemplateCompat(m.front, m.back, m.css),
      exampleNoteCount: modelNoteCounts.get(mid) ?? 0,
    });
  }
  models.sort((a, b) => b.exampleNoteCount - a.exampleNoteCount);
  return ok({
    fileLabel,
    noteCount: parsed.notes.length,
    cardCount: parsed.cardCount,
    decks: [...parsed.decks.entries()]
      .map(([name, noteCount]) => ({ name, noteCount }))
      .sort((a, b) => b.noteCount - a.noteCount),
    models,
    mediaFileCount: parsed.mediaFileCount,
    mediaRefCount: parsed.mediaRefCount,
    truncated: false,
  });
}
