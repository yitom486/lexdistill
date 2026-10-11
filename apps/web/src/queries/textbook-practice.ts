import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TextbookExerciseAttemptSchema, TextbookExerciseHistorySchema, TextbookGrowthResponseSchema, type SubmitTextbookExercise } from '@study-studio/protocol';
import { BusinessError, translateToBusinessError } from '@study-studio/shared';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { DEFAULT_USER_ID } from './query-keys.js';

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = typeof body === 'object' && body && 'error' in body ? body.error : undefined;
    const message = typeof error === 'object' && error && 'userMessage' in error && typeof error.userMessage === 'string' ? error.userMessage : '批改服务暂时不可用，请重试';
    throw new BusinessError('E_GRADING_REQUEST_FAILED', message, 'NETWORK', true);
  }
  return body;
}
export const textbookHistoryKey = (userId: string, documentId: string, chapterId: string) => ['textbook-practice', userId, documentId, chapterId] as const;
export function useTextbookExerciseMutation(documentId: string, chapterId: string) {
  const userId = useUserProfileStore(state => state.profile.userId) || DEFAULT_USER_ID;
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitTextbookExercise) => {
      try {
        // 批改走所选运行时（缺席走默认 codex-acp）。
        const runtimeId = usePreferencesStore.getState().agentRuntimeId;
        const response = await fetch(`${GATEWAY_BASE_URL}/api/textbook-practice/${encodeURIComponent(userId)}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...(runtimeId ? { runtimeId } : {}) }) });
        return TextbookExerciseAttemptSchema.parse(await readResponse(response));
      } catch (cause) { throw translateToBusinessError(cause, 'submitTextbookExercise'); }
    },
    retry: false,
    onSuccess: result => { if (!result.temporary) void client.invalidateQueries({ queryKey: textbookHistoryKey(userId, documentId, chapterId) }); },
  });
}
export function useTextbookExerciseHistory(documentId: string, chapterId: string, enabled: boolean) {
  const userId = useUserProfileStore(state => state.profile.userId) || DEFAULT_USER_ID;
  return useQuery({ queryKey: textbookHistoryKey(userId, documentId, chapterId), enabled,
    queryFn: async () => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/textbook-practice/${encodeURIComponent(userId)}/history?${new URLSearchParams({ documentId, chapterId })}`);
      return TextbookExerciseHistorySchema.parse(await readResponse(response));
    } });
}
export function useTextbookGrowth(documentId: string, chapterId: string, enabled: boolean) {
  const userId = useUserProfileStore(state => state.profile.userId) || DEFAULT_USER_ID;
  return useQuery({ queryKey: [...textbookHistoryKey(userId, documentId, chapterId), 'growth'], enabled,
    queryFn: async () => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/textbook-practice/${encodeURIComponent(userId)}/growth?${new URLSearchParams({ documentId, chapterId })}`);
      return TextbookGrowthResponseSchema.parse(await readResponse(response));
    } });
}
