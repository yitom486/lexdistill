import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { VocabularyEntrySchema, VocabularyCollectionSchema, type VocabularyScope } from '@study-studio/protocol';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

const ErrorSchema = z.object({ error: z.object({ userMessage: z.string() }) });
export async function readVocabularyResponse(response: { ok: boolean; json(): Promise<unknown> }): Promise<unknown> {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const parsed = ErrorSchema.safeParse(raw);
    throw new Error(parsed.success ? parsed.data.error.userMessage : '词汇操作失败，请重试');
  }
  return raw;
}
export function useVocabularyQuery(language?: string, scope: VocabularyScope = {}, enabled = true) {
  const profile = useUserProfileStore(state => state.profile);
  const userId = profile.userId || DEFAULT_USER_ID;
  const lang = normalizeTrackLanguage(language || profile.targetLanguage);
  return useQuery({ queryKey: [...QUERY_KEYS.VOCABULARY, userId, lang, scope.documentId ?? '', scope.chapterId ?? ''], enabled,
    queryFn: async () => {
      const query = new URLSearchParams({ lang });
      if (scope.documentId) query.set('documentId', scope.documentId);
      if (scope.chapterId) query.set('chapterId', scope.chapterId);
      const raw = await readVocabularyResponse(await fetch(`${GATEWAY_BASE_URL}/api/vocabulary/${encodeURIComponent(userId)}?${query}`));
      const parsed = z.array(VocabularyEntrySchema).safeParse(raw);
      if (!parsed.success) throw new Error('词汇数据格式不正确，请重新加载');
      return parsed.data;
    },
  });
}
export function useCollectVocabularyMutation() {
  const client = useQueryClient();
  const userId = useUserProfileStore(state => state.profile.userId) || DEFAULT_USER_ID;
  return useMutation({
    mutationFn: async ({ vocabularyId, ...scope }: VocabularyScope & { vocabularyId: string }) => {
      const raw = await readVocabularyResponse(await fetch(`${GATEWAY_BASE_URL}/api/vocabulary/${encodeURIComponent(userId)}/${encodeURIComponent(vocabularyId)}/collect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope),
      }));
      const parsed = VocabularyCollectionSchema.safeParse(raw);
      if (!parsed.success) throw new Error('收藏回执不完整，请重新加载确认');
      return parsed.data;
    },
    onSuccess: async () => {
      await Promise.all([QUERY_KEYS.VOCABULARY, QUERY_KEYS.CARDS, QUERY_KEYS.WORDLISTS, QUERY_KEYS.DAILY_PLAN]
        .map(queryKey => client.invalidateQueries({ queryKey })));
    },
  });
}
