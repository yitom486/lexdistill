import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BankSubmissionRecord, GenerationTaskSnapshot, GenerationTaskSummary } from '@study-studio/protocol';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { audioChunksToBlob, parsePcmRate } from '../lib/pcm-audio.js';

export interface GenerationStudentPaper {
  paperId: string;
  title: string;
  items: GenerationStudentItem[];
}

export interface GenerationStudentItem {
  id: string;
  language: string;
  category: string;
  targetLevel: string;
  difficultyTier: number;
  prompt: string;
  skillIds: string[];
  materialId: string | null;
  answer: { type: string; options?: Array<{ key: string; text: string }>; chunks?: string[]; targetLanguage?: string; minWords?: number; maxWords?: number };
  material: null | { type: 'READING'; title: string; text: string }
    | { type: 'LISTENING'; title: string; mode: 'DIALOGUE' | 'PASSAGE' | 'NEWS'; withTranscript: boolean; turns?: Array<{ speaker: string; text: string }> };
}

export interface GenerationReviewPaper {
  paperId: string;
  title: string;
  items: Array<{ id: string; reviewed: boolean; question: unknown }>;
}

export interface GenerationRunState {
  taskId: string;
  status: string;
  running: boolean;
  last: unknown;
}

export interface GenerationPreset {
  id: string;
  version: string;
  promptVersion: string;
  name: string;
  description: string;
  categoryCounts: Record<string, number>;
  listeningModes?: Record<string, number> | undefined;
  allowedAnswerTypes: string[];
  objective: string;
}

export interface ResolvedPreset {
  presetId: string;
  presetVersion: string;
  config: GenerationTaskSnapshot['config'];
  blueprint: NonNullable<GenerationTaskSnapshot['blueprint']>;
  objective: string;
  budgetNote: { newQuestionsMax: number; finalPaperItems: number };
}

export interface PresetSuggestion {
  language: string;
  languageBasis: string;
  targetLevel: string;
  targetLevelBasis: string;
  presetId: string;
  presetBasis: string;
  textbookCount: number;
  reasons: string[];
}

/** 版本化预设族（后端单一事实源）。 */
export function useGenerationPresetsQuery() {
  return useQuery<GenerationPreset[]>({
    queryKey: [...QUERY_KEYS.GENERATION_TASKS, 'presets'],
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/presets`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载预设失败'));
      return (await res.json()) as GenerationPreset[];
    },
  });
}

/** 智能建议：只读画像、错题与授权教材，无数据用可见默认值。 */
export function useGenerationSuggestionQuery(userId = DEFAULT_USER_ID, language?: string) {
  return useQuery<PresetSuggestion>({
    queryKey: [...QUERY_KEYS.GENERATION_TASKS, 'suggest', userId, language ?? ''],
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/suggest/${encodeURIComponent(userId)}${language ? `?language=${encodeURIComponent(language)}` : ''}`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载出题建议失败'));
      return (await res.json()) as PresetSuggestion;
    },
  });
}

export interface ResolvePresetInput {
  presetId: string;
  language: string;
  targetLevel: string;
  modelId: string;
  audio?: {
    providerId: string; modelId: string; maleVoice: string; femaleVoice: string;
    narratorVoice: string; speed: number; timeoutMs: number;
  } | undefined;
  categoryCounts?: Record<string, number> | undefined;
  listeningModes?: Record<string, number> | undefined;
}

/** 后端计算并验证预算（预设基线＋用户微调），不创建任务。 */
export function useResolvePresetMutation() {
  return useMutation({
    mutationFn: async (input: ResolvePresetInput) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/presets/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '预算校验失败'));
      return (await res.json()) as ResolvedPreset;
    },
  });
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error?: { userMessage?: string } }).error?.userMessage;
    if (message) return message;
  }
  return fallback;
}

async function postJson<T>(url: string, payload: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), fallback));
  return (await res.json()) as T;
}

/** 任务列表（重开/断开恢复用） */
export function useGenerationTasksQuery(userId = DEFAULT_USER_ID) {
  return useQuery<GenerationTaskSummary[]>({
    queryKey: [...QUERY_KEYS.GENERATION_TASKS, userId],
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载出题任务失败'));
      return (await res.json()) as GenerationTaskSummary[];
    },
  });
}

/** 任务快照；ACTIVE 时轮询直到关闭 */
export function useGenerationTaskQuery(userId = DEFAULT_USER_ID, taskId: string | null) {
  return useQuery<GenerationTaskSnapshot>({
    queryKey: [...QUERY_KEYS.GENERATION_TASK, userId, taskId],
    enabled: Boolean(taskId),
    refetchInterval: (query) => (query.state.data?.status === 'ACTIVE' ? 1500 : false),
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId!)}`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载任务状态失败'));
      return (await res.json()) as GenerationTaskSnapshot;
    },
  });
}

/** 后台运行态；运行时轮询 */
export function useGenerationRunStateQuery(userId = DEFAULT_USER_ID, taskId: string | null) {
  return useQuery<GenerationRunState>({
    queryKey: [...QUERY_KEYS.GENERATION_RUN, userId, taskId],
    enabled: Boolean(taskId),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId!)}/run-state`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载运行状态失败'));
      return (await res.json()) as GenerationRunState;
    },
  });
}

export interface CreateGenerationTaskInput {
  sessionId: string;
  turnId: string;
  config: GenerationTaskSnapshot['config'];
  blueprint?: GenerationTaskSnapshot['blueprint'];
  objective?: string;
}

/** 创建冻结任务 */
export function useCreateGenerationTaskMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGenerationTaskInput) => postJson<{ taskId: string }>(
      `${GATEWAY_BASE_URL}/api/generation/tasks`,
      { userId, sessionId: input.sessionId, turnId: input.turnId, config: input.config, blueprint: input.blueprint, objective: input.objective },
      '创建出题任务失败'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_TASKS, userId] });
    },
  });
}

/** 后台启动出题（202 接受；409 为运行中） */
export function useStartGenerationRunMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
      if (res.status === 202) return (await res.json()) as { accepted: boolean; taskId: string };
      throw new Error(readErrorMessage(await res.json().catch(() => null), '启动出题失败'));
    },
    onSuccess: (_data, taskId) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_TASK, userId, taskId] });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_RUN, userId, taskId] });
    },
  });
}

/** 取消任务（运行中则中断模型与语音） */
export function useCancelGenerationTaskMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => postJson<GenerationTaskSnapshot>(
      `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId)}/cancel`, {}, '取消任务失败'),
    onSuccess: (_data, taskId) => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_TASK, userId, taskId] });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_RUN, userId, taskId] });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_TASKS, userId] });
    },
  });
}

/** 作答/批改后失效同一试卷、复盘、错题与进度的所有读口。 */
export function invalidateBankAnswerQueries(queryClient: QueryClient, userId: string, taskId: string, paperId: string): void {
  void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_SUBMISSIONS, userId, taskId, paperId] });
  void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_PAPER, userId, taskId, paperId] });
  void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_TASK, userId, taskId] });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
}

/** 试卷下用户自己的作答保留（重开恢复用，不含参考答案）。 */
export function useBankSubmissionsQuery(userId = DEFAULT_USER_ID, taskId: string | null, paperId: string | null) {
  return useQuery<BankSubmissionRecord[]>({
    queryKey: [...QUERY_KEYS.GENERATION_SUBMISSIONS, userId, taskId, paperId],
    enabled: Boolean(taskId && paperId),
    queryFn: async () => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId!)}/papers/${encodeURIComponent(paperId!)}/submissions`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载作答记录失败'));
      return (await res.json()) as BankSubmissionRecord[];
    },
  });
}

/** 显式批改：只传模型偏好（可空，用任务冻结模型），不接受客户端分数。 */
export function useGradeBankSubjectiveMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskId: string; paperId: string; submissionId: string; model?: string }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(input.taskId)}/papers/${encodeURIComponent(input.paperId)}/answers/subjective/${encodeURIComponent(input.submissionId)}/grade`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input.model ? { model: input.model } : {}) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readErrorMessage(body, '批改失败'));
      return body as { status: string; isCorrect?: boolean; score?: number; gradingError?: string;
        grading?: { score: number; maxScore: number; feedback: string } };
    },
    onSuccess: (_data, input) => {
      invalidateBankAnswerQueries(queryClient, userId, input.taskId, input.paperId);
    },
  });
}

/** 试卷：作答态学生视图 / 复盘态按已作答逐题释放 */
export function useGenerationPaperQuery(userId = DEFAULT_USER_ID, taskId: string | null, paperId: string | null, review = false) {
  return useQuery<GenerationStudentPaper | GenerationReviewPaper>({
    queryKey: [...QUERY_KEYS.GENERATION_PAPER, userId, taskId, paperId, review ? 'review' : 'attempt'],
    enabled: Boolean(taskId && paperId),
    queryFn: async () => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(taskId!)}/papers/${encodeURIComponent(paperId!)}${review ? '?view=review' : ''}`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载试卷失败'));
      return (await res.json()) as GenerationStudentPaper;
    },
  });
}

export interface BankAnswerInput {
  taskId: string;
  paperId: string;
  questionId: string;
  submissionId: string;
  userAnswer: string;
  timeSpentMs?: number;
}

/** 客观作答：后端权威判分并落同一记录表 */
export function useSubmitBankObjectiveMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BankAnswerInput) => postJson<{ isCorrect: boolean; score: number; correctAnswer: string; explanation: string }>(
      `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(input.taskId)}/papers/${encodeURIComponent(input.paperId)}/answers/objective`,
      { submissionId: input.submissionId, questionId: input.questionId, userAnswer: input.userAnswer, timeSpentMs: input.timeSpentMs ?? 0 },
      '提交答案失败'),
    onSuccess: (_data, input) => {
      invalidateBankAnswerQueries(queryClient, userId, input.taskId, input.paperId);
    },
  });
}

/** 主观作答：短答可精确判对；翻译与写作保存后走显式批改。 */
export function useSubmitBankSubjectiveMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BankAnswerInput) => postJson<{ status: string; isCorrect?: boolean; score?: number }>(
      `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(userId)}/${encodeURIComponent(input.taskId)}/papers/${encodeURIComponent(input.paperId)}/answers/subjective`,
      { submissionId: input.submissionId, questionId: input.questionId, userAnswer: input.userAnswer, timeSpentMs: input.timeSpentMs ?? 0 },
      '提交答案失败'),
    onSuccess: (_data, input) => {
      invalidateBankAnswerQueries(queryClient, userId, input.taskId, input.paperId);
    },
  });
}

export interface GenerationAudioAsset { url: string; mimeType: string; byteLength: number }

/** 听力音频：取字节→按 MIME 拼可播放 Blob（PCM 包 WAV 头，原样复用播放链路） */
export function useGenerationAudioMutation() {
  return useMutation({
    mutationFn: async (input: { userId: string; taskId: string; materialId: string }): Promise<GenerationAudioAsset> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/generation/tasks/${encodeURIComponent(input.userId)}/${encodeURIComponent(input.taskId)}/audio/${encodeURIComponent(input.materialId)}`);
      if (!res.ok) throw new Error(readErrorMessage(await res.json().catch(() => null), '加载听力音频失败'));
      const mimeType = res.headers.get('Content-Type') || 'audio/wav';
      const bytes = new Uint8Array(await res.arrayBuffer());
      const blob = audioChunksToBlob([bytes], mimeType, parsePcmRate(mimeType));
      return { url: URL.createObjectURL(blob), mimeType, byteLength: bytes.byteLength };
    },
  });
}
