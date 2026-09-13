import { ok, err, isOk, type Result, BusinessError, generateId } from '@study-studio/shared';
import type { Flashcard, GeneratedQuestion, PracticeBlockSpec, PracticePlanRun, LearnerLevel } from '@study-studio/protocol';
import { isLessonLocked, isQuestionAllowed, resolveStudyGate, tierCapForLevel } from '@study-studio/learner-core';
import type { AssessmentBlueprint } from '@study-studio/learning';
import type { LearningRepository } from '../ports.js';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { ContentRepository } from '../../library/ports.js';
import type { PersistableQuestion } from '../persistence/questions.js';
import type { LearningContentInput, LearningContentOutput } from '../../../transport/tools/learning-content-tool.js';
import {
  acceptedDbTypesForBlock,
  buildVocabQuestionsFromCards,
  buildTranslationQuestionsFromCards,
  buildReadingQuestions,
  mapPoolQuestion,
  type PoolQuestionRow,
} from '@study-studio/learning';

/**
 * M7-16 题构造兼容出口：实现已迁入练习核心包（经 learning 统一入口转出），
 * 此处重出以保持测试与调用点不动；编排/仓储/门控/模板/跨块去重仍归本文件。
 */
export {
  acceptedDbTypesForBlock,
  buildVocabQuestionsFromCards,
  buildTranslationQuestionsFromCards,
} from '@study-studio/learning';

/**
 * P5：练习运行题目装配。
 *
 * 按块语义装配到 practice_collections（关联 plan_run_id/block_id/grading_mode）。
 * P5-E7 块语义链（差距 7 核心）：
 * 1. VOCAB_REVIEW/VOCAB_NEW → 从 FSRS 闪卡装配词义选择题（到期卡优先 / 新卡优先），不复制 FSRS 状态；
 * 2. QUIZ/TRANSLATION/DICTATION/WRITING → 先按题型（+难度）从 quiz_questions 池精选；
 * 3. 池不足 → 经 learning.content `generate_for_block` 模板驱动补齐（不调 LLM，语种模板缺失则跳过）；
 * 4. 仍不足 → 回退同语种任意可用题；
 * 5. 全链为空 → 记入 skippedBlocks 显式上报（不再静默跳块）。
 * 6. 跨块去重：同一 run 内同一道题不重复装入。
 *
 * READING 块 v1 仍回退客观题（阅读篇目套题链路另行接入）。
 */

export interface AssembledBlock {
  blockId: string;
  collectionId: string;
  itemCount: number;
}

export interface AssembleResult {
  run: PracticePlanRun;
  blocks: AssembledBlock[];
  totalItems: number;
  /** 因题池为空而未能装配的块（显式上报，UI 据此提示） */
  skippedBlocks: Array<{ blockId: string; kind: string; reason?: string }>;
}

/** learning.content 工具的结构化最小契约（避免装配层依赖完整 ToolDefinition）。 */
export type ContentToolLike = {
  execute(
    input: LearningContentInput,
    context: { userId: string; sessionId: string }
  ): Promise<Result<LearningContentOutput, BusinessError>>;
};

const isVocabBlock = (block: PracticeBlockSpec) =>
  block.kind === 'VOCAB_REVIEW' || block.kind === 'VOCAB_NEW';

/** PersistableQuestion → 包结构化输入（仅取映射所需字段；持久化方言解耦）。 */
function toPoolQuestionRow(q: PersistableQuestion): PoolQuestionRow {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    content: q.content,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    testedSkill: q.testedSkill,
    testedSkillId: q.testedSkillId,
    difficulty: q.difficulty,
    dictation: q.dictation,
  };
}

/** 内容去重键（跨来源同一道题去重；考试防重复刷分，练习防重复体验）。 */
function questionContentKey(q: { content?: unknown; correctAnswer?: unknown }): string {
  return `${String(q.content ?? '')}||${String(q.correctAnswer ?? '')}`;
}

/**
 * 定级考蓝图组卷：按组从池（skillIds 精选）+ 模板（逐技能）取数，内容去重。
 * 取不满的组自然 thin（判分时报告，判线不强制）；绝不拿重复题凑数判升级。
 * 定级考豁免档位/讲义门（使命就是往上探），但沿用跨块去重。
 */
async function collectBlueprintItems(
  repo: LearningRepository,
  userId: string,
  language: 'en' | 'ja' | 'ko',
  blueprint: AssessmentBlueprint,
  need: number,
  seenIds: Set<string>,
  seenContent: Set<string>
): Promise<GeneratedQuestion[]> {
  const out: GeneratedQuestion[] = [];
  // 注意：seenIds/seenContent 只读不写（注册归 pushFresh 统一做，避免双重注册吞题）。
  const localContent = new Set<string>();
  const dup = (q: GeneratedQuestion): boolean =>
    seenIds.has(q.id) ||
    seenContent.has(questionContentKey(q)) ||
    localContent.has(questionContentKey(q));
  // 重考轮换：按该目标档已完成场次偏移候选顺序（题池有余量时换题面；
  // 无余量时同一套，不伪装成平行卷，distinct 可见）。
  // M1-2：计数走 LearningRepository 能力，不再内联 SQL/碰 raw 句柄。
  const rotation = await repo.countPlacementAttempts(userId, blueprint.targetLevel);
  const rotateBy = <T>(arr: T[]): T[] => {
    if (arr.length === 0 || rotation === 0) return arr;
    const k = rotation % arr.length;
    return [...arr.slice(k), ...arr.slice(0, k)];
  };
  for (const group of blueprint.groups) {
    if (out.length >= need) break;
    const groupPool: GeneratedQuestion[] = [];
    // 池：按组技能精选
    try {
      const poolRes = await repo.getQuestions(userId, group.items * 4 + 8, language, {
        skillIds: group.skillIds,
      });
      if (isOk(poolRes)) {
        for (const q of (poolRes.value ?? []).map((row) => mapPoolQuestion(toPoolQuestionRow(row)))) {
          groupPool.push(q);
        }
      }
    } catch {
      // 池失败走模板，不挡整组
    }
    // 模板：逐技能取 generate_quiz 行（审校现货）
    for (const skill of group.skillIds) {
      try {
        const tpls = await repo.listContentTemplates({
          action: 'generate_quiz',
          language,
          skillId: skill,
        });
        if (!isOk(tpls)) continue;
        for (const row of tpls.value ?? []) {
          const raw = (row.payload ?? {}) as { question?: Record<string, unknown> };
          const base = raw.question;
          if (!base || typeof base !== 'object') continue;
          groupPool.push({
            ...(base as Record<string, unknown>),
            id: generateId('q_bp'),
            testedSkillId:
              typeof base.testedSkillId === 'string' && base.testedSkillId
                ? base.testedSkillId
                : skill,
            difficultyTier:
              typeof base.difficultyTier === 'number'
                ? base.difficultyTier
                : typeof row.difficulty === 'number'
                  ? row.difficulty
                  : 3,
          } as GeneratedQuestion);
        }
      } catch {
        // 单技能模板失败不挡整组
      }
    }
    // 轮换 + 去重后取本组份
    const groupPicks: GeneratedQuestion[] = [];
    for (const q of rotateBy(groupPool)) {
      if (groupPicks.length >= group.items) break;
      if (dup(q)) continue;
      if (groupPicks.some((g) => questionContentKey(g) === questionContentKey(q))) continue;
      groupPicks.push(q);
    }
    for (const q of groupPicks) {
      out.push(q);
      localContent.add(questionContentKey(q));
      if (out.length >= need) break;
    }
  }
  // 机动题：同语种审校模板优先（组外技能也行），内容去重；仍不够由旧链兜底。
  if (out.length < need) {
    try {
      const tpls = await repo.listContentTemplates({ action: 'generate_quiz', language });
      if (isOk(tpls)) {
        for (const row of tpls.value ?? []) {
          if (out.length >= need) break;
          const raw = (row.payload ?? {}) as { question?: Record<string, unknown> };
          const base = raw.question;
          if (!base || typeof base !== 'object') continue;
          const skill = typeof base.testedSkillId === 'string' ? base.testedSkillId : '';
          const q = {
            ...(base as Record<string, unknown>),
            id: generateId('q_bp'),
            ...(skill ? {} : { testedSkillId: 'review' }),
            difficultyTier:
              typeof base.difficultyTier === 'number'
                ? base.difficultyTier
                : typeof row.difficulty === 'number'
                  ? row.difficulty
                  : 3,
          } as GeneratedQuestion;
          if (dup(q)) continue;
          if (out.some((g) => questionContentKey(g) === questionContentKey(q))) continue;
          out.push(q);
          localContent.add(questionContentKey(q));
        }
      }
    } catch {
      // 模板失败由旧链兜底
    }
  }
  return out;
}

export async function assemblePracticeRun(
  repo: LearningRepository & LearnerRepository & Pick<ContentRepository, 'listReadingSets'>,
  userId: string,
  runId: string,
  contentTool?: ContentToolLike | undefined
): Promise<Result<AssembleResult, BusinessError>> {
  const runRes = await repo.getPracticePlanRun(userId, runId);
  if (!isOk(runRes)) return err(runRes.error);
  if (!runRes.value) {
    return err(new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE'));
  }
  const run = runRes.value;

  const blocks: AssembledBlock[] = [];
  const skippedBlocks: Array<{ blockId: string; kind: string; reason?: string }> = [];
  // 同一 run 内跨块去重：同一道题不重复装入
  const usedQuestionIds = new Set<string>();
  const usedContentKeys = new Set<string>();
  let totalItems = 0;
  // 定级考：读冻结蓝图（组卷与判分认同一版；无蓝图老卷走旧链）。
  const placementExam = repo.isPlacementRun(runId) ? await repo.getPlacementByRunId(runId) : null;
  const examBlueprint = placementExam?.blueprint;

  // 出题门（教学-first）：定级考豁免（使命就是往上探）；自家卡
  // （VOCAB/TRANSLATION 均来自用户已讲透资产）豁免；池 / 模板 / 兜底 / 阅读一律过门
  // （档位 + 讲义锁）。快照读不到不过门（fail-open，不挡装配）。
  let gateLevel: LearnerLevel | null = null;
  let gateCompleted = new Set<string>();
  let gateLessons = new Set<string>();
  if (!repo.isPlacementRun(runId)) {
    const gate = await resolveStudyGate(repo, userId, run.language, null);
    // 定级考已在分支外豁免；快照降级（空讲义集）即纯档位门，行为不变。
    gateLevel = gate.level;
    gateCompleted = gate.completed;
    gateLessons = gate.lessons;
  }
  const gateView = () => ({ completed: gateCompleted, lessons: gateLessons });
  let gatedOutLevel = 0;
  let gatedOutLesson = 0;
  const applyGate = (qs: GeneratedQuestion[]): GeneratedQuestion[] => {
    const lv = gateLevel;
    if (!lv) return qs;
    const view = gateView();
    return qs.filter((q) => {
      if (isLessonLocked(q.testedSkillId, view)) {
        gatedOutLesson += 1;
        return false;
      }
      const keep = isQuestionAllowed(q.testedSkillId, q.difficultyTier, lv, view);
      if (!keep) gatedOutLevel += 1;
      return keep;
    });
  };

  for (const block of run.blocks) {
    const candidates: GeneratedQuestion[] = [];
    // 定级考严格去重（内容相同算同一道，防重复刷分；空 content 的阅读题只按 id 去重）。
    const strictDedupe = examBlueprint != null;
    const pushFresh = (list: GeneratedQuestion[]) => {
      for (const q of list) {
        if (usedQuestionIds.has(q.id)) continue;
        const hasContent = String(q.content ?? '').trim().length > 0;
        if (strictDedupe && hasContent) {
          const key = questionContentKey(q);
          if (usedContentKeys.has(key)) continue;
          usedContentKeys.add(key);
        }
        candidates.push(q);
      }
    };

    // 1) VOCAB 块：从 FSRS 闪卡装配（REVIEW→到期卡优先；NEW→新卡优先）
    // M2 学习门：NEW 块只吃讲透过的卡（studiedAt 非空）；没讲透的不硬凑，
    // 记 NEED_STUDY 由 UI 指路讲透，未讲透绝不进练习池。
    if (isVocabBlock(block)) {
      const cardsRes = await repo.getDueCards(userId, block.count * 4 + 8, {
        language: run.language,
        dueOnly: block.kind === 'VOCAB_REVIEW',
      });
      let cards = isOk(cardsRes) ? (cardsRes.value ?? []) : [];
      if (block.kind === 'VOCAB_NEW') {
        cards = cards.filter((c) => c.fsrs.state === 'NEW' && c.studiedAt);
        if (cards.length === 0) {
          skippedBlocks.push({ blockId: block.id, kind: block.kind, reason: 'NEED_STUDY' });
          continue;
        }
      }
      pushFresh(buildVocabQuestionsFromCards(cards, block.count, run.language));
    }

    // 1b) READING 块：从最近阅读套题装配（篇目随题携带；超纲篇目不过门）
    if (block.kind === 'READING') {
      pushFresh(
        applyGate(
          await buildReadingQuestions(
            {
              listReadingSets: (input) => repo.listReadingSets(input.userId, undefined, input.language),
              getTierCap: async () =>
                tierCapForLevel((await resolveStudyGate(repo, userId, run.language, null)).level),
            },
            userId,
            block,
            run.language
          )
        )
      );
    }

    // 1c) TRANSLATION 块：优先吃讲透句子卡；不够再走池/模板链（不断旧行为）。
    if (block.kind === 'TRANSLATION') {
      const sentRes = await repo.getDueCards(userId, block.count * 4 + 8, {
        language: run.language,
      });
      const studied = isOk(sentRes) ? (sentRes.value ?? []) : [];
      pushFresh(buildTranslationQuestionsFromCards(studied, block.count, run.language));
    }

    // 2a) 定级考蓝图组卷优先（按组取数；不够的组判分时标 thin）
    if (examBlueprint && candidates.length < block.count) {
      const picks = await collectBlueprintItems(
        repo,
        userId,
        run.language,
        examBlueprint,
        block.count - candidates.length,
        usedQuestionIds,
        usedContentKeys
      );
      pushFresh(picks);
    }

    // 2) 题型（+难度）池精选
    if (candidates.length < block.count) {
      const wantedTypes = acceptedDbTypesForBlock(block);
      const fetchLimit = block.count * 4 + 8;
      const typedRes = await repo.getQuestions(userId, fetchLimit, run.language, {
        types: wantedTypes,
        difficulty: block.difficulty,
      });      let pool = isOk(typedRes) ? (typedRes.value ?? []) : [];
      // 难度过严 → 放宽难度，保留题型
      if (pool.length < block.count && typeof block.difficulty === 'number') {
        const relaxedRes = await repo.getQuestions(userId, fetchLimit, run.language, {
          types: wantedTypes,
        });
        if (isOk(relaxedRes)) {
          const relaxedPool = relaxedRes.value ?? [];
          if (relaxedPool.length > pool.length) pool = relaxedPool;
        }
      }
      pushFresh(applyGate(pool.map((row) => mapPoolQuestion(toPoolQuestionRow(row)))));
    }

    // 3) 模板驱动生成补齐（不调 LLM；模板缺失自动跳过）
    if (candidates.length < block.count && contentTool && !isVocabBlock(block)) {
      const genRes = await contentTool.execute(
        { action: 'generate_for_block', language: run.language, blocks: [block] },
        { userId, sessionId: 'practice_assembly' }
      );
      if (isOk(genRes)) {
        const first = genRes.value.perBlock?.[0];
        pushFresh(applyGate(first?.questions ?? []));
      }
    }

    // 4) 同语种任意题兜底（同样过门：兜底不是法外之地）
    if (candidates.length < block.count) {
      const anyRes = await repo.getQuestions(userId, block.count * 4 + 8, run.language);
      if (isOk(anyRes)) pushFresh(applyGate((anyRes.value ?? []).map((row) => mapPoolQuestion(toPoolQuestionRow(row)))));
    }

    const selected = candidates.slice(0, block.count);
    if (selected.length === 0) {
      skippedBlocks.push({
        blockId: block.id,
        kind: block.kind,
        // 指路优先级：讲义锁（去学讲义）> 档位门（先跟带路升级）。
        ...(gateLevel && gatedOutLesson > 0
          ? { reason: 'NEED_LESSON' as const }
          : gateLevel && gatedOutLevel > 0
            ? { reason: 'LEVEL_GATE' as const }
            : {}),
      });
      continue;
    }
    for (const q of selected) usedQuestionIds.add(q.id);

    const collectRes = await repo.collectPracticeQuestions({
      userId,
      title: `练习运行 ${runId.slice(-6)} · ${block.kind}`,
      intent: 'GENERATE_QUIZ',
      questions: selected,
      planRunId: runId,
      blockId: block.id,
      gradingMode: block.gradingMode,
    });
    if (!isOk(collectRes)) continue;

    blocks.push({
      blockId: block.id,
      collectionId: collectRes.value.collection.id,
      itemCount: collectRes.value.items.length,
    });
    totalItems += collectRes.value.items.length;
  }

  return ok({ run, blocks, totalItems, skippedBlocks });
}
