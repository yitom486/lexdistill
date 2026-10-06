import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PracticeBlockSpec, PracticeItemAttempt, PracticePlanRun, PracticePlanTemplate } from '@study-studio/protocol';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

/** P1-2 拆分：练习计划组（自 useLearnerQueries.ts 逐行平移，仅改 import）。 */

// ===================== P5：可配置练习计划 =====================

/** 练习计划模板列表 */
export function usePracticeTemplatesQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);
  return useQuery<PracticePlanTemplate[]>({
    queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId, targetLanguage],
    queryFn: async () => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/practice/templates/${userId}?lang=${targetLanguage}&includeDisabled=1`
      );
      if (!res.ok) throw new Error('加载练习计划模板失败');
      return (await res.json()) as PracticePlanTemplate[];
    },
  });
}

/** 保存（新建/更新）模板；成功后失效模板列表 */
export function useSavePracticeTemplateMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: PracticePlanTemplate) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '保存模板失败');
      }
      return (await res.json()) as PracticePlanTemplate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId] });
    },
  });
}

/** 删除模板 */
export function useDeletePracticeTemplateMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/practice/templates/${userId}/${encodeURIComponent(templateId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('删除模板失败');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId] });
    },
  });
}

/** P5-E2：启用/停用模板（仅改 enabled，不递增 revision） */
export function useTogglePracticeTemplateMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { templateId: string; enabled: boolean }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/practice/templates/${userId}/${encodeURIComponent(params.templateId)}/enabled`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: params.enabled }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '更新模板状态失败');
      }
      return (await res.json()) as PracticePlanTemplate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId] });
    },
  });
}

/** P5-E2：复制模板（新 id、revision 重置、默认停用） */
export function useCopyPracticeTemplateMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/practice/templates/${userId}/${encodeURIComponent(templateId)}/copy`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '复制模板失败');
      }
      return (await res.json()) as PracticePlanTemplate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId] });
    },
  });
}

/** 开始一次练习运行（从模板冻结或一次性自定义块） */
export function useStartPracticeRunMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { language: 'en' | 'ja' | 'ko'; templateId?: string; blocks?: PracticeBlockSpec[] }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...params }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '开始练习失败');
      }
      return (await res.json()) as PracticePlanRun;
    },
    onSuccess: (run) => {
      queryClient.setQueryData([...QUERY_KEYS.PRACTICE_RUN, userId, run.id], { run, attempts: [] });
      // P5-E3：新开 run 立即出现在今日计划（幂等追加练习计划步骤）
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DAILY_PLAN, userId] });
    },
  });
}

/** 读取运行 + 其尝试 */
export function usePracticeRunQuery(runId: string | null, userId = DEFAULT_USER_ID) {
  return useQuery<{ run: PracticePlanRun | null; attempts: PracticeItemAttempt[] }>({
    queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/${userId}/${runId}`);
      if (!res.ok) throw new Error('加载练习运行失败');
      return (await res.json()) as { run: PracticePlanRun | null; attempts: PracticeItemAttempt[] };
    },
    staleTime: 1000 * 5,
  });
}

/** 保存草稿（主观题写到一半） */
export function useSavePracticeDraftMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { runId: string; itemId: string; userAnswer: string }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...params }),
      });
      if (!res.ok) throw new Error('保存草稿失败');
      return (await res.json()) as PracticeItemAttempt;
    },
    onSuccess: (attempt) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, attempt.runId] });
    },
  });
}

/** 提交客观题（即时自动判定） */
export function useSubmitObjectiveMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      runId: string;
      itemId: string;
      userAnswer: string;
      isCorrect?: boolean;
      score?: number;
      testedSkillId?: string;
      timeSpentMs?: number;
    }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/submit-objective`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...params }),
      });
      if (!res.ok) throw new Error('提交客观题失败');
      return (await res.json()) as PracticeItemAttempt;
    },
    onSuccess: (attempt) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, attempt.runId] });
    },
  });
}

/** 提交主观题（已由 learning.assess 批改） */
export function useSubmitSubjectiveMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      runId: string;
      itemId: string;
      userAnswer: string;
      gradingResult: Record<string, unknown>;
      timeSpentMs?: number;
    }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/submit-subjective`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...params }),
      });
      if (!res.ok) throw new Error('提交主观题失败');
      return (await res.json()) as PracticeItemAttempt;
    },
    onSuccess: (attempt) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, attempt.runId] });
    },
  });
}

/** 批量提交（用 learning.assess.grade_batch 的结果） */
export function useSubmitBatchMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      runId: string;
      items: Array<{ itemId: string; userAnswer: string; gradingResult: Record<string, unknown>; timeSpentMs?: number }>;
    }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/submit-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...params }),
      });
      if (!res.ok) throw new Error('批量提交失败');
      return (await res.json()) as { attempts: PracticeItemAttempt[]; batchSummary: { total: number; graded: number; correct: number } };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, variables.runId] });
    },
  });
}

/** 完成运行（原子写学习统计） */
export function useFinalizePracticeRunMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, runId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '完成练习失败');
      }
      return (await res.json()) as PracticePlanRun;
    },
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, run.id] });
      void useUserProfileStore.getState().fetchProfile(userId);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ACTIVITY_HISTORY });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LEARNING_ANALYSIS });
    },
  });
}

/** 批量主观题评测（复用 learning.assess HTTP 路由，action=grade_batch） */
export interface AssessBatchResult {
  results: Array<{ itemId: string; grading: Record<string, unknown> }>;
  summary: { total: number; correct: number; averageScore: number; commonIssues: string[] };
}
export function useGradeBatchMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (items: Array<{
      itemId: string;
      prompt: string;
      standardAnswer: string;
      userSubmission: string;
      testedSkillId?: string;
      language?: 'en' | 'ja' | 'ko';
    }>) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/learning/assess/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grade_batch', items }),
      });
      if (!res.ok) throw new Error('批量评测失败');
      return (await res.json()) as AssessBatchResult;
    },
  });
}

/** P5-E5：单题即时评测（learning.assess action=grade，AI_IMMEDIATE 块用） */
export interface AssessSingleResult {
  isCorrect: boolean;
  score: number;
  accuracyRate?: number;
  grammarFeedback: string;
  nativeNuanceAdvice: string;
  refinementSuggestion: string;
  mistakeDetected: boolean;
  negativeTransferTag?: string;
}
export function useGradeSingleMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (input: {
      prompt: string;
      standardAnswer: string;
      userSubmission: string;
      testedSkillId?: string;
      language: 'en' | 'ja' | 'ko';
    }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/learning/assess/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grade', ...input }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        throw new Error(body?.error?.userMessage ?? '单题批改失败');
      }
      return (await res.json()) as AssessSingleResult;
    },
  });
}

/** 装配运行题目（按块从既有资产装配到 practice_collections） */
export function useAssemblePracticeRunMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/${userId}/${runId}/assemble`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('装配练习题目失败');
      return (await res.json()) as {
        run: PracticePlanRun;
        blocks: Array<{ blockId: string; collectionId: string; itemCount: number }>;
        totalItems: number;
        skippedBlocks?: Array<{ blockId: string; kind: string; reason?: string }>;
      };
    },
    onSuccess: (_data, runId) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, runId] });
    },
  });
}

/** 读取运行的所有题目（按 block 聚合） */
export interface PracticeRunnerItemDTO {
  itemId: string;
  blockId: string;
  gradingMode: 'AUTO_IMMEDIATE' | 'AI_IMMEDIATE' | 'AI_BATCH';
  question: import('@study-studio/protocol').GeneratedQuestion;
}
export function usePracticeRunItemsQuery(runId: string | null, userId = DEFAULT_USER_ID) {
  return useQuery<PracticeRunnerItemDTO[]>({
    queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, runId, 'items'],
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/${userId}/${runId}/items`);
      if (!res.ok) throw new Error('加载练习题目失败');
      return (await res.json()) as PracticeRunnerItemDTO[];
    },
  });
}

/** P5-PhaseD：AI 计划建议草案 */
export interface PracticeProposalDTO {
  proposalId: string;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  suggestedName: string;
  blocks: PracticeBlockSpec[];
  createdAt: string;
  expiresAt: string;
}
export function useProposeTemplateMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (language: 'en' | 'ja' | 'ko') => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/templates/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, language }),
      });
      if (!res.ok) throw new Error('生成计划建议失败');
      return (await res.json()) as PracticeProposalDTO;
    },
  });
}

/** P5-PhaseD：用户确认式 apply（校验一次性令牌后保存模板） */
export function useApplyProposalMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposalId: string; name?: string; blocks?: PracticeBlockSpec[] }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/templates/apply-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...input }),
      });
      if (!res.ok) throw new Error('应用建议草案失败');
      return (await res.json()) as PracticePlanTemplate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.PRACTICE_TEMPLATES, userId] });
    },
  });
}

/** P5-PhaseD：运行汇总与下次建议 */
export interface RunSummaryDTO {
  runId: string;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  source: 'ai' | 'local';
  summary: string;
  totalItems: number;
  submittedCount: number;
  gradedCount: number;
  correctCount: number;
  averageScore: number;
  commonIssues: string[];
  nextPlanSuggestions: string[];
  generatedAt: string;
  failureReason?: string;
}
export function usePracticeRunSummaryQuery(runId: string | null, userId = DEFAULT_USER_ID) {
  return useQuery<RunSummaryDTO>({
    queryKey: [...QUERY_KEYS.PRACTICE_RUN, userId, runId, 'summary'],
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/practice/runs/${userId}/${runId}/summary`);
      if (!res.ok) throw new Error('加载运行汇总失败');
      return (await res.json()) as RunSummaryDTO;
    },
  });
}

// ===================== 定级考（跳级通道） =====================

export type PlacementLevel = 'NOVICE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface PlacementExamInfo {
  id: string;
  targetLevel: PlacementLevel;
  runId: string;
  status: 'pending' | 'passed' | 'failed';
  accuracy?: number;
}

export interface PlacementFinishInfo {
  passed: boolean;
  accuracy: number;
  graded: number;
  level: PlacementLevel;
  blueprintVersion?: string;
  groups?: Array<{
    key: string;
    label: string;
    items: number;
    distinct: number;
    graded: number;
    correct: number;
    minCorrect: number;
    thin: boolean;
    met: boolean;
  }>;
  uncoveredGroups?: string[];
  failReasons?: string[];
  distinctItems?: number;
}

function placementError(payload: unknown, fallback: string): Error {
  const msg =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(
          ((payload as { error: unknown }).error as { userMessage?: unknown })?.userMessage ??
            fallback
        )
      : typeof payload === 'object' && payload !== null && 'userMessage' in payload
        ? String((payload as { userMessage: unknown }).userMessage)
        : fallback;
  return new Error(msg);
}

/** 开考：目标档须高于当前档；ja/ko 字母量不够会被拒绝并指路字母工作室。 */
export function useStartPlacementMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (vars: {
      language: 'ja' | 'en' | 'ko';
      targetLevel: PlacementLevel;
    }): Promise<{ exam: PlacementExamInfo; runId: string }> => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/placement/${encodeURIComponent(userId)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw placementError(payload, '开考失败');
      const body = (payload ?? {}) as { exam?: PlacementExamInfo; runId?: unknown };
      if (!body.exam || typeof body.runId !== 'string') throw new Error('开考返回异常');
      return { exam: body.exam, runId: body.runId };
    },
  });
}

/** 交卷：按准确率+字母线判定，过线写档（可重考）。 */
export function useFinishPlacementMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { examId: string }): Promise<PlacementFinishInfo> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/placement/${encodeURIComponent(userId)}/${encodeURIComponent(vars.examId)}/finish`,
        { method: 'POST' }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw placementError(payload, '交卷失败');
      const body = (payload ?? {}) as Partial<PlacementFinishInfo>;
      if (typeof body.passed !== 'boolean' || typeof body.accuracy !== 'number') {
        throw new Error('交卷返回异常');
      }
      return {
        passed: body.passed,
        accuracy: body.accuracy,
        graded: typeof body.graded === 'number' ? body.graded : 0,
        level: body.level ?? 'NOVICE',
        ...(typeof body.blueprintVersion === 'string' ? { blueprintVersion: body.blueprintVersion } : {}),
        ...(Array.isArray(body.groups)
          ? { groups: body.groups as NonNullable<PlacementFinishInfo['groups']> }
          : {}),
        ...(Array.isArray(body.uncoveredGroups)
          ? { uncoveredGroups: (body.uncoveredGroups as unknown[]).map((g) => String(g)) }
          : {}),
        ...(Array.isArray(body.failReasons)
          ? { failReasons: (body.failReasons as unknown[]).map((g) => String(g)) }
          : {}),
        ...(typeof body.distinctItems === 'number'
          ? { distinctItems: body.distinctItems }
          : {}),
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}

