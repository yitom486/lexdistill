import { BusinessError, err, ok, type Result } from '@lexdistill/shared';
import {
  MASTERY_UNLOCK_RATIO,
  isVocabularyAllowed,
  jlptIndex,
  unlockedJlptMax,
  type LearnerLevel,
  type VocabMastery,
  unitsForTrack,
  selectCourseWords,
} from '@lexdistill/learner-core';
import type { DailyPickOrder, DailyPickResponse, JlptLevel } from '@lexdistill/protocol';
import { bankJlptLevel, type WordlistGroup } from '@lexdistill/storage-sqlite';

export interface DailyPickDeps {
  getLearnerProfile(userId: string): Promise<Result<{ learnerLevel: LearnerLevel; dailyGoalNewWords: number; wordLevelFilter: string[] | null }, BusinessError>>;
  listWordlists(userId: string, language: string): Promise<Result<WordlistGroup[], BusinessError>>;
  getVocabularyMasteryByJlpt(userId: string, language: string): Promise<Result<Array<{ jlpt: string; total: number; stable: number }>, BusinessError>>;
}

export interface DailyPickInput {
  count: number;
  order: DailyPickOrder;
  bankId: string;
  courseUnitId?: string | undefined;
}

export interface DailyPickLockedInfo {
  requiredJlpt: JlptLevel;
  requiredMastery: number;
  currentMastery: number;
}

export interface DailyPickResult {
  words: DailyPickResponse['words'];
  pick: DailyPickResponse['pick'];
  locked: DailyPickLockedInfo | null;
}

/** 锁库 409 负载（纯函数）：文案口径唯一，路由与测试共用。 */
export function formatLockedPayload(
  result: Pick<DailyPickResult, 'words' | 'pick' | 'locked'> & { locked: DailyPickLockedInfo }
): { status: 409; body: unknown } {
  const locked = result.locked;
  const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
  return {
    status: 409,
    body: {
      ...result,
      error: { code: 'E_BANK_LOCKED', userMessage: `该词库需 ${locked.requiredJlpt} 掌握率 ${percent(locked.requiredMastery)} 解锁，当前 ${percent(locked.currentMastery)}` },
      data: { requiredMastery: locked.requiredMastery, currentMastery: locked.currentMastery },
    },
  };
}
/** Fisher–Yates：无偏洗牌（前端 Math.random 排序有偏，此处唯一的随机实现）。 */
function shuffled<T>(items: readonly T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/**
 * 每日抽词装配（唯一入口）：画像配置 → 词汇门 → 词库抽取。
 * - 未学透优先；全部学透则循环整库（与旧 UI 行为一致，不断活路）。
 * - 整库被门拦下时返回 locked（words 为空），前端只展示横幅，不绕过。
 * - 用户过滤只做减法：显式排除某级只会抽空，不会开锁。
 */
export async function pickDailyWords(
  deps: DailyPickDeps,
  userId: string,
  language: string,
  input: DailyPickInput
): Promise<Result<DailyPickResult, BusinessError>> {
  const count = Math.min(50, Math.max(1, Math.floor(input.count)));
  const profile = await deps.getLearnerProfile(userId);
  if (!profile.ok) return err(profile.error);
  const groups = await deps.listWordlists(userId, language);
  if (!groups.ok) return err(groups.error);
  const unit = input.courseUnitId ? unitsForTrack(language as 'ja' | 'en' | 'ko').find(u => u.id === input.courseUnitId) : undefined;
  if (input.courseUnitId && unit?.evidence.type !== 'words-studied') {
    return err(new BusinessError('E_INVALID_INPUT', '请选择当前语种的词汇单元', 'VALIDATION'));
  }
  const rule = unit?.evidence.type === 'words-studied' ? unit.evidence : undefined;
  const group = groups.value.find(entry => entry.id === (rule?.group ?? input.bankId));
  if (!group) return err(new BusinessError('E_INVALID_INPUT', '请选择有效的词库', 'VALIDATION'));
  const stats = await deps.getVocabularyMasteryByJlpt(userId, language);
  if (!stats.ok) return err(stats.error);
  const mastery: VocabMastery[] = stats.value
    .filter(row => jlptIndex(row.jlpt) >= 0)
    .map(row => ({ jlpt: row.jlpt as VocabMastery['jlpt'], total: row.total, stable: row.stable }));
  const unlockedMax = unlockedJlptMax(profile.value.learnerLevel, mastery);
  const rawBankLevel = bankJlptLevel(group.id);
  const bankLevel = rawBankLevel !== null && jlptIndex(rawBankLevel) >= 0 ? (rawBankLevel as VocabMastery['jlpt']) : null;
  const level = profile.value.learnerLevel;
  const userFilter = profile.value.wordLevelFilter;
  // 逐词等级：词自带有效 jlpt 优先；回落整库等级仅当词来自所请词库（课程跨库取词回落 null=未知放行，来源库锁定已在上游整库预检）。
  const fromRequestedBank = !rule?.entryIds;
  const wordLevel = (word: { jlpt?: string | undefined }): VocabMastery['jlpt'] | null => {
    if (word.jlpt && jlptIndex(word.jlpt) >= 0) return word.jlpt as VocabMastery['jlpt'];
    return fromRequestedBank ? bankLevel : null;
  };
  const gateOpen = bankLevel === null || isVocabularyAllowed(bankLevel, level, mastery);
  if (bankLevel !== null && !gateOpen) {
    const row = mastery.find(entry => entry.jlpt === bankLevel);
    // 展示口径（有意与门判定分离）：空级显示 0%，门内空级按掌握处理（masteryRatio），各自由测试锁定。
    const current = row && row.total > 0 ? row.stable / row.total : 0;
    return ok({
      words: [],
      pick: { bankId: group.id, requested: count, returned: 0, unlockedJlptMax: unlockedMax, skippedLocked: group.words.length },
      locked: { requiredJlpt: bankLevel, requiredMastery: MASTERY_UNLOCK_RATIO, currentMastery: current },
    });
  }
  let scopedWords = group.words;
  if (rule?.entryIds) {
    // 指定词汇可跨入门词库；每个来源仍服从同一词汇门和用户过滤。
    const selectedGroups = groups.value.filter(g => g.words.some(w => rule.entryIds!.includes(w.entryId)));
    for (const source of selectedGroups) {
      const level = bankJlptLevel(source.id);
      if (level && jlptIndex(level) >= 0 && !isVocabularyAllowed(level as VocabMastery['jlpt'], profile.value.learnerLevel, mastery)) {
        return err(new BusinessError('E_BANK_LOCKED', '单元词汇所属词库尚未解锁，请先完成基础学习。', 'VALIDATION'));
      }
    }
    const allowedGroups = selectedGroups.filter(g => {
      const level = bankJlptLevel(g.id);
      return !level || !userFilter || userFilter.includes(level);
    });
    scopedWords = selectCourseWords(unit!, allowedGroups);
  } else if (unit) {
    scopedWords = selectCourseWords(unit, groups.value);
  }
  const pool0 = scopedWords.filter(word => !word.studied);
  const base = pool0.length > 0 ? pool0 : scopedWords;
  const kept = base.filter(word => {
    const wl = wordLevel(word);
    return wl === null || userFilter === null || userFilter.includes(wl);
  });
  const pool = kept.filter(word => isVocabularyAllowed(wordLevel(word), level, mastery));
  const skippedLocked = kept.length - pool.length;
  const ordered = input.order === 'random' ? shuffled(pool) : pool;
  const picked = ordered.slice(0, count);
  return ok({
    words: picked.map(word => {
      const wl = wordLevel(word);
      return {
        entryId: word.entryId,
        headword: word.headword,
        ...(word.reading ? { reading: word.reading } : {}),
        meanings: word.meanings,
        ...(word.partOfSpeech ? { partOfSpeech: word.partOfSpeech } : {}),
        sourceLabel: word.sourceLabel,
        collected: word.collected,
        studied: word.studied,
        ...(wl ? { jlpt: wl } : {}),
      };
    }),
    pick: { bankId: group.id, requested: count, returned: picked.length, unlockedJlptMax: unlockedMax, skippedLocked },
    locked: null,
  });
}
