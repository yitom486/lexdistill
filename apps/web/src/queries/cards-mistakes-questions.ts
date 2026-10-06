import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateId, logger } from '@study-studio/shared';
import type { FsrsState } from '@study-studio/learner-core';
import type { CardReviewRating } from '@study-studio/protocol';
import { GeneratedQuestionSchema, toUiQuizType } from '@study-studio/protocol';
import { apiClient, GATEWAY_BASE_URL } from '../lib/api-client.js';
import type {
  MistakeNotebookItem,
  QuizQuestionItem,
  StudyCardItem,
} from '../models/learning.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import { readVocabularyResponse } from './vocabulary.js';

/** P1-2 拆分：卡片 / 错题 / 题库组（自 useLearnerQueries.ts 逐行平移，仅改 import）。 */

/** Gateway 行 JSON 的防御性读取（缺字段/类型漂移时回退展示默认值，永不抛）。 */
function rowStr(row: Record<string, unknown>, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : fallback;
}

function rowNum(row: Record<string, unknown>, key: string, fallback: number): number {
  const value = row[key];
  return typeof value === 'number' ? value : fallback;
}

function nthStr(value: unknown, index: number, fallback = ''): string {
  const item = Array.isArray(value) ? value[index] : undefined;
  return typeof item === 'string' && item ? item : fallback;
}

/**
 * FSRS 卡片库查询 (依托 Gateway，带语种作用域隔离)
 */
export function useCardsQuery(userIdOverride?: string, langOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<StudyCardItem[]>({
    queryKey: [...QUERY_KEYS.CARDS, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = `${GATEWAY_BASE_URL}/api/cards/${userId}?lang=${targetLanguage}`;
        const res = await fetch(url);
        if (res.ok) {
          const list = (await res.json()) as unknown;
          if (Array.isArray(list)) {
            return (list as Array<Record<string, unknown>>).map((c) => {
              const fsrs = (c.fsrs ?? {}) as Record<string, unknown>;
              const fsrsState = rowStr(fsrs, 'state');
              return {
                id: rowStr(c, 'id'),
                type: (c.type === 'GRAMMAR'
                  ? 'GRAMMAR'
                  : c.type === 'CONFUSION_PAIR'
                    ? 'CONFUSION'
                    : c.type === 'SENTENCE'
                      ? 'SENTENCE'
                      : 'VOCAB') as StudyCardItem['type'],
                frontWord: rowStr(c, 'front'),
                reading: rowStr(c, 'phonetic'),
                tag: nthStr(c.tags, 0, '核心词汇'),
                pos: rowStr(c, 'partOfSpeech', '词汇'),
                backMeaning: rowStr(c, 'back'),
                exampleJp: Array.isArray(c.examples) && typeof c.examples[0]?.text === 'string' ? c.examples[0].text : '',
                exampleHighlight: rowStr(c, 'exampleHighlight') || rowStr(c, 'front'),
                exampleZh: Array.isArray(c.examples) && typeof c.examples[0]?.translation === 'string' ? c.examples[0].translation : '',
                stability: rowNum(fsrs, 'stability', 1.0),
                reps: rowNum(fsrs, 'reps', 0),
                difficulty: rowNum(fsrs, 'difficulty', 5.0),
                lapses: rowNum(fsrs, 'lapses', 0),
                state:
                  fsrsState === 'LEARNING' ||
                  fsrsState === 'REVIEW' ||
                  fsrsState === 'RELEARNING'
                    ? fsrsState
                    : 'NEW',
                ...(rowStr(fsrs, 'lastReviewedAt')
                  ? { lastReviewedAt: rowStr(fsrs, 'lastReviewedAt') }
                  : {}),
                ...(rowStr(fsrs, 'dueAt') ? { dueAt: rowStr(fsrs, 'dueAt') } : {}),
                ...(rowStr(c, 'studiedAt') ? { studiedAt: rowStr(c, 'studiedAt') } : {}),
                ...(rowStr(c, 'sourceEntryId') ? { sourceEntryId: rowStr(c, 'sourceEntryId') } : {}),
                ...(rowStr(c, 'vocabularyId') ? { vocabularyId: rowStr(c, 'vocabularyId') } : {}),
              };
            });
          }
        }
      } catch (e) {
        logger.debug('[useCardsQuery] failed to load cards', e);
      }
      return [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** 追加 / 批量追加闪卡并经由 Hono RPC 持久化到 Gateway */
export function useAddCardsMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const queryClient = useQueryClient();
  const language = normalizeTrackLanguage(useUserProfileStore(state => state.profile.targetLanguage));

  return useMutation({
    mutationFn: async (cards: StudyCardItem[]) => {
        const payload = cards.map((c) => ({
          id: c.id,
          userId,
          language,
          type: c.type === 'VOCAB' ? 'VOCABULARY' as const : c.type === 'CONFUSION' ? 'CONFUSION_PAIR' as const : c.type,
          front: c.frontWord,
          back: c.backMeaning,
          ...(c.reading ? { phonetic: c.reading } : {}),
          ...(c.sourceEntryId ? { sourceEntryId: c.sourceEntryId } : {}),
          ...(c.vocabularyId ? { vocabularyId: c.vocabularyId } : {}),
          partOfSpeech: c.pos,
          examples: c.exampleJp ? [{ text: c.exampleJp, ...(c.exampleZh ? { translation: c.exampleZh } : {}) }] : [],
          tags: [c.tag].filter(Boolean),
          fsrs: {
            stability: c.stability,
            difficulty: 5.0,
            reps: c.reps,
            lapses: 0,
            dueAt: new Date().toISOString(),
            state: 'NEW',
          },
        }));
        const response = await apiClient.api.cards[':userId'].$post({
          param: { userId },
          json: payload,
        });
        await readVocabularyResponse(response);
      return cards;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
    },
  });
}

/** 复习单张卡片：只提交 rating，FSRS 计算与持久化由 Gateway 完成 (SSOT) */
export function useUpdateCardMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const queryClient = useQueryClient();
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(profileLang);

  return useMutation({
    mutationFn: async (patch: { id: string; rating: CardReviewRating }) => {
      // 网关是卡片状态唯一写入者：前端只传评分，不在本地计算 FSRS。
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/cards/${encodeURIComponent(userId)}/${encodeURIComponent(patch.id)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: patch.rating }),
        }
      );
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        nextFsrs?: FsrsState;
        nextReviewDays?: number;
        error?: { userMessage?: string };
      } | null;
      if (!res.ok || !body?.success || !body.nextFsrs) {
        throw new Error(body?.error?.userMessage ?? '保存闪卡复习状态失败，请稍后重试。');
      }
      return { id: patch.id, rating: patch.rating, nextFsrs: body.nextFsrs, nextReviewDays: body.nextReviewDays };
    },
    onSuccess: (patch) => {
      queryClient.setQueryData<StudyCardItem[]>([
        ...QUERY_KEYS.CARDS,
        userId,
        targetLanguage,
      ], (prev = []) =>
        prev.map((c) =>
          c.id === patch.id
            ? {
                ...c,
                stability: patch.nextFsrs.stability,
                reps: patch.nextFsrs.reps,
                difficulty: patch.nextFsrs.difficulty,
                lapses: patch.nextFsrs.lapses,
                state: patch.nextFsrs.state,
                ...(patch.nextFsrs.lastReviewedAt
                  ? { lastReviewedAt: patch.nextFsrs.lastReviewedAt }
                  : {}),
                dueAt: patch.nextFsrs.dueAt,
              }
            : c
        )
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
    },
  });
}

/** 教材生词 → StudyCardItem */
export function vocabToStudyCard(
  vocab: { front: string; back: string; category: string; prompt: string },
  idx = 0
): StudyCardItem {
  return {
    id: `card_tb_${Date.now()}_${idx}`,
    type: 'VOCAB',
    frontWord: vocab.front,
    reading: '',
    tag: '教材生词',
    pos: '生词',
    backMeaning: vocab.back,
    exampleJp: vocab.prompt,
    exampleHighlight: vocab.front,
    exampleZh: '',
    stability: 1.0,
    reps: 0,
  };
}

/**
 * 错题本查询 (依托 Gateway，带语种作用域隔离)
 */
export function useMistakesQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<MistakeNotebookItem[]>({
    queryKey: [...QUERY_KEYS.MISTAKES, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = `${GATEWAY_BASE_URL}/api/mistakes/${userId}?lang=${targetLanguage}`;
        const res = await fetch(url);
        if (res.ok) {
          const list = (await res.json()) as unknown;
          if (Array.isArray(list)) {
            return (list as Array<Record<string, unknown>>).map((m) => {
              const question = (m.question ?? {}) as Record<string, unknown>;
              const grading = (m.lastGrading ?? {}) as Record<string, unknown>;
              return {
                id: rowStr(m, 'id'),
                categoryTag: rowStr(question, 'category', '薄弱项攻坚'),
                prompt: rowStr(question, 'prompt', '请根据要求作答'),
                sentence: rowStr(question, 'content'),
                userWrongAnswer: rowStr(m, 'lastUserSubmission'),
                correctAnswer: rowStr(grading, 'correctAnswer') || rowStr(question, 'correctAnswer'),
                testedSkillId: rowStr(question, 'testedSkillId'),
                reviewNote: rowStr(grading, 'explanation') || rowStr(question, 'explanation'),
                consecutiveCorrect: rowNum(m, 'consecutiveCorrect', 0),
                isResolved: Boolean(m.isResolved),
              };
            });
          }
        }
      } catch (e) {
        logger.debug('[useMistakesQuery] failed to load mistakes', e);
      }
      return [];
    },
    staleTime: 1000 * 60 * 1,
  });
}

/** 错题两连对攻克状态更新 (Hono RPC 持久化至 SQLite) */
export function useUpdateMistakeMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(profileLang);

  return useMutation({
    mutationFn: async (payload: { mistakeId: string; isCorrect: boolean }) => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/mistakes/${encodeURIComponent(userId)}/retry/${encodeURIComponent(payload.mistakeId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isCorrect: payload.isCorrect }),
        }
      );
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: { userMessage?: string };
        mistakeId?: string;
        consecutiveCorrect?: number;
        isResolved?: boolean;
      };
      if (!response.ok || !result.success) {
        throw new Error(
          result.error?.userMessage || result.message || '更新错题订正状态失败，请稍后重试。'
        );
      }
      return {
        mistakeId: payload.mistakeId,
        consecutiveCorrect: result.consecutiveCorrect ?? 0,
        isResolved: Boolean(result.isResolved),
      };
    },
    onSuccess: ({ mistakeId, consecutiveCorrect, isResolved }) => {
      queryClient.setQueryData<MistakeNotebookItem[]>([
        ...QUERY_KEYS.MISTAKES,
        userId,
        targetLanguage,
      ], (prev = []) =>
        prev.map((m) => {
          if (m.id !== mistakeId) return m;
          return {
            ...m,
            consecutiveCorrect,
            isResolved,
          };
        })
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
    },
  });
}

/** 听力听写/做题错题入库 (Hono RPC 持久化至 Gateway SQLite) */
export function useAddMistakeMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      item: Omit<MistakeNotebookItem, 'id' | 'consecutiveCorrect' | 'isResolved'>
    ) => {
      const mistakeId = generateId('mst_audio');
      try {
        await apiClient.api.mistakes[':userId'].$post({
          param: { userId },
          json: {
            id: mistakeId,
            userId,
            questionId: mistakeId,
            question: {
              id: mistakeId,
              type: 'FILL_IN_BLANK',
              prompt: item.prompt,
              content: item.sentence,
              correctAnswer: item.correctAnswer,
              explanation: item.reviewNote,
              testedSkillId: item.testedSkillId,
              category: item.categoryTag,
            },
            lastUserSubmission: item.userWrongAnswer,
            lastGrading: {
              isCorrect: false,
              score: 0,
              correctAnswer: item.correctAnswer,
              userSubmission: item.userWrongAnswer,
              explanation: item.reviewNote,
            },
            recordedAt: new Date().toISOString(),
            retryCount: 1,
            consecutiveCorrect: 0,
            isResolved: false,
          },
        });
      } catch (e) {
        logger.debug('[useAddMistakeMutation] Hono RPC failed to save mistake to gateway', e);
      }
      return { item, id: mistakeId };
    },
    onSuccess: ({ item, id }) => {
      const entry: MistakeNotebookItem = {
        ...item,
        id,
        consecutiveCorrect: 0,
        isResolved: false,
      };
      queryClient.setQueryData<MistakeNotebookItem[]>([...QUERY_KEYS.MISTAKES, userId], (prev = []) => [
        entry,
        ...prev,
      ]);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES });
    },
  });
}

/**
 * 自适应题库查询 (依托 Gateway，带语种作用域隔离)
 */
export function useQuestionsQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<QuizQuestionItem[]>({
    queryKey: [...QUERY_KEYS.QUESTIONS, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = `${GATEWAY_BASE_URL}/api/questions/${userId}?lang=${targetLanguage}`;
        const res = await fetch(url);
        if (res.ok) {
          const dynamicQuestions = (await res.json()) as unknown;
          if (Array.isArray(dynamicQuestions)) {
            return (dynamicQuestions as Array<Record<string, unknown>>).filter(q =>
              ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER', 'CHOICE', 'FILL_BLANK', 'REORDER'].includes(rowStr(q, 'type'))
            ).map((q) => {
              const optionList = Array.isArray(q.options)
                ? q.options.map((opt: unknown, i: number) => {
                    if (typeof opt === 'string') {
                      return { key: String.fromCharCode(65 + i), text: opt };
                    }
                    const obj = (opt ?? {}) as Record<string, unknown>;
                    return {
                      ...(typeof opt === 'object' && opt !== null ? opt : {}),
                      key: rowStr(obj, 'key', String.fromCharCode(65 + i)),
                      text: rowStr(obj, 'text'),
                    };
                  })
                : undefined;
              const chunkList: string[] | undefined = Array.isArray(q.chunks) ? q.chunks
                : toUiQuizType(rowStr(q, 'type')) === 'REORDER' ? rowStr(q, 'content').split(/\s+/).filter(Boolean) : undefined;
              const reading = GeneratedQuestionSchema.shape.reading.safeParse(q.reading);
              return {
                id: rowStr(q, 'id'),
                type: toUiQuizType(rowStr(q, 'type') || 'MULTIPLE_CHOICE'),
                category: rowStr(q, 'category') || 'AI 靶向攻坚',
                prompt: rowStr(q, 'prompt') || '选择最恰当的选项：',
                content: rowStr(q, 'content'),
                ...(optionList ? { options: optionList } : {}),
                ...(chunkList ? { chunks: chunkList } : {}),
                ...(reading.success && reading.data ? { reading: reading.data } : {}),
                correctAnswer: rowStr(q, 'correctAnswer'),
                explanation: rowStr(q, 'explanation'),
                testedSkill:
                  rowStr(q, 'testedSkillId') || rowStr(q, 'testedSkill') || 'adaptive_skill',
              };
            });
          }
        }
      } catch (e) {
        logger.debug('[useQuestionsQuery] failed to load questions', e);
        throw e;
      }
      throw new Error('题库读取失败，请重试。');
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** 前置插入自适应题目并经由 Hono RPC 持久化到 SQLite */
export function usePrependQuestionMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (question: QuizQuestionItem) => {
      const response = await apiClient.api.questions[':userId'].$post({
          param: { userId },
          json: {
            id: question.id,
            userId,
            type: question.type,
            category: question.category,
            prompt: question.prompt,
            content: question.content,
            options: question.options,
            chunks: question.chunks,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            testedSkillId: question.testedSkill,
            difficulty: 3,
            createdAt: new Date().toISOString(),
          },
        });
      if (!response.ok) {
        throw new Error('保存自适应题目失败');
      }
      return question;
    },
    onSuccess: (question) => {
      queryClient.setQueryData<QuizQuestionItem[]>([...QUERY_KEYS.QUESTIONS, userId], (prev = []) => [
        question,
        ...prev,
      ]);
    },
  });
}

// 双传输收敛：HTTP 版 useSubmitQuizMutation（仅记足迹，曾有同名 WS 版）已删除——
// 唯一消费是 AdaptiveQuizWorkbench 使用 useAgentMutations 的 WS 版；答题足迹由
// Gateway WS CLIENT_QUIZ_SUBMIT 落库路径统一累计。

/** 标记讲透（M2 学习门；幂等，成功后失效卡片库）。 */
export function useMarkCardStudiedMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cardId: string): Promise<{ cardId: string; studiedAt: string }> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/cards/${encodeURIComponent(userId)}/${encodeURIComponent(cardId)}/studied`,
        { method: 'POST' }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof payload === 'object' && payload !== null && 'userMessage' in payload
            ? String((payload as { userMessage: unknown }).userMessage)
            : `标记讲透失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
      return payload as { cardId: string; studiedAt: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WORDLISTS });
    },
    onError: (e) => {
      logger.debug('[useMarkCardStudiedMutation] failed', e);
    },
  });
}
