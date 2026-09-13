import type { CardSourceEntry } from '@study-studio/flashcard-core';

/**
 * M7-11 自 Gateway `flashcards/application/card-source.ts` 迁入（映射逻辑逐行一致）。
 *
 * 生词卡 → CardSourceEntry：根据卡片和词典来源组装推送/导出共用的词条上下文。
 * 只依赖最小 port（结构化数据行，不泄漏数据库行类型）；不连 Gateway 业务
 * SQLite、不引 Drizzle、不新增迁移。
 *
 * 行为铁律（逐项保留）：
 * - 无 sourceEntryId / 词条不存在 → 回退卡片自身前后端；
 * - meaningsJson 非法或空数组 → 回退卡片 back；
 * - reading 优先级 entry.reading → entry.romanization → card.phonetic；
 * - pitch label / positions 安全收窄；仅 reading 与有效 positions 同时在场
 *   才写 pitchPositions（不臆造图形）；
 * - 词频查询失败不影响主流程；多个数值取最小；
 * - 不臆造词典数据。
 */

export interface ResolvableCard {
  front: string;
  back: string;
  phonetic?: string | null | undefined;
  sourceEntryId?: string | null | undefined;
}

export interface ResolvedCardSource {
  source: CardSourceEntry;
  sourceLabel?: string | undefined;
}

/** port 视角的词典来源条目（结构化映射行，与业务表解耦）。 */
export interface CardSourceEntryRow {
  headword: string;
  reading: string | null;
  romanization: string | null;
  meaningsJson: string;
  partOfSpeech: string | null;
  pronunciationJson: string | null;
  sourceLabel: string;
}

/** 来源解析所需的最小读取能力（Gateway 用 Drizzle 实现）。 */
export interface CardSourcePorts {
  /** 按 sourceEntryId 查询词典来源条目（不存在返回 undefined）。 */
  findEntryById(sourceEntryId: string): Promise<CardSourceEntryRow | undefined>;
  /** 按 headword 查询词频候选（失败由用例吞掉，不影响主流程）。 */
  findFrequenciesByHeadword(headword: string): Promise<number[]>;
}

/** pronunciation_json → 声调 label（结构不对返回 undefined，不抛）。 */
function pitchOfPronunciation(raw: string | null): { label?: string; positions?: number[] } {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const pitch: unknown = (parsed as Record<string, unknown>)['pitch'];
    if (typeof pitch !== 'object' || pitch === null) return {};
    const rec = pitch as Record<string, unknown>;
    const out: { label?: string; positions?: number[] } = {};
    if (typeof rec['label'] === 'string' && rec['label']) out.label = rec['label'];
    if (Array.isArray(rec['positions'])) {
      const positions = rec['positions'].filter(
        (p): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0
      );
      if (positions.length > 0) out.positions = positions;
    }
    return out;
  } catch {
    return {};
  }
}

export async function resolveCardSource(
  ports: CardSourcePorts,
  card: ResolvableCard
): Promise<ResolvedCardSource> {
  let source: CardSourceEntry = { headword: card.front, meanings: [card.back] };
  let sourceLabel: string | undefined;
  if (!card.sourceEntryId) return { source };
  const entry = await ports.findEntryById(card.sourceEntryId);
  if (!entry) return { source };
  let meanings: string[] = [];
  try {
    const parsed: unknown = JSON.parse(entry.meaningsJson);
    if (Array.isArray(parsed)) {
      meanings = parsed.filter((m): m is string => typeof m === 'string');
    }
  } catch {
    meanings = [];
  }
  source = {
    headword: entry.headword,
    meanings: meanings.length > 0 ? meanings : [card.back],
  };
  const reading = entry.reading ?? entry.romanization ?? card.phonetic ?? undefined;
  if (reading) source.reading = reading;
  if (entry.partOfSpeech) source.partOfSpeech = entry.partOfSpeech;
  const pitch = pitchOfPronunciation(entry.pronunciationJson);
  if (pitch.label) source.pitchLabel = pitch.label;
  // 阶梯图需要读音 + 核位置同时在场；缺一即不生成（不臆造图形）。
  if (pitch.positions && source.reading) source.pitchPositions = pitch.positions;
  sourceLabel = entry.sourceLabel;
  try {
    const freqs = await ports.findFrequenciesByHeadword(entry.headword);
    if (freqs.length > 0) source.frequency = Math.min(...freqs);
  } catch {
    // 词频缺失不影响下游（频次徽标缺省隐藏）
  }
  return { source, sourceLabel };
}
