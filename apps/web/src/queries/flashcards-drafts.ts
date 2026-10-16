import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@lexdistill/shared';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';

/** 生词草稿箱组：提议由网关/AI 侧写入；前端只读列表、逐字段改、接受入库、驳回。 */

export interface CardDraftItem {
  id: string;
  language: string;
  termKey: string;
  headword: string;
  reading: string;
  meanings: string[];
  partOfSpeech: string;
  source: string;
  sourceRef: string;
  kind: 'word' | 'sentence';
  cardType: string;
  status: string;
  editedFields: string[];
  createdAt: string;
  updatedAt: string;
}

function rowStr(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function rowStrArray(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is string => typeof m === 'string');
}

function toDraftItem(raw: unknown): CardDraftItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.headword !== 'string') return null;
  return {
    id: row.id,
    language: rowStr(row, 'language'),
    termKey: rowStr(row, 'termKey'),
    headword: row.headword,
    reading: rowStr(row, 'reading'),
    meanings: rowStrArray(row, 'meanings'),
    partOfSpeech: rowStr(row, 'partOfSpeech'),
    source: rowStr(row, 'source'),
    sourceRef: rowStr(row, 'sourceRef'),
    kind: rowStr(row, 'kind') === 'sentence' ? 'sentence' : 'word',
    cardType: rowStr(row, 'cardType'),
    status: rowStr(row, 'status'),
    editedFields: rowStrArray(row, 'editedFields'),
    createdAt: rowStr(row, 'createdAt'),
    updatedAt: rowStr(row, 'updatedAt'),
  };
}

export function useCardDraftsQuery(userIdOverride?: string, langOverride?: string) {
  const profile = useUserProfileStore(state => state.profile);
  const userId = userIdOverride || profile.userId || DEFAULT_USER_ID;
  const language = normalizeTrackLanguage(langOverride || profile.targetLanguage);
  return useQuery<CardDraftItem[]>({
    queryKey: [...QUERY_KEYS.DRAFTS, userId, language],
    queryFn: async () => {
      try {
        const res = await fetch(
          `${GATEWAY_BASE_URL}/api/flashcards/drafts/${encodeURIComponent(userId)}?lang=${language}`
        );
        if (!res.ok) throw new Error('生词草稿读取失败，请重试。');
        const payload: unknown = await res.json().catch(() => null);
        const list =
          typeof payload === 'object' && payload !== null && 'drafts' in payload
            ? (payload as { drafts: unknown }).drafts
            : null;
        if (!Array.isArray(list)) return [];
        const out: CardDraftItem[] = [];
        for (const d of list) {
          const item = toDraftItem(d);
          if (item) out.push(item);
        }
        return out;
      } catch (e) {
        logger.debug('[useCardDraftsQuery] failed to load drafts', e);
        throw e instanceof Error ? e : new Error('生词草稿读取失败，请重试。');
      }
    },
    staleTime: 1000 * 30,
  });
}

function useInvalidateDrafts() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DRAFTS });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY });
  };
}

export function useUpdateCardDraftMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const invalidate = useInvalidateDrafts();
  return useMutation({
    mutationFn: async (vars: {
      draftId: string;
      patch: { headword?: string; reading?: string; meanings?: string[]; partOfSpeech?: string };
    }): Promise<CardDraftItem> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/flashcards/drafts/${encodeURIComponent(userId)}/${encodeURIComponent(vars.draftId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vars.patch),
        }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof payload === 'object' && payload !== null && 'userMessage' in payload
            ? String((payload as { userMessage: unknown }).userMessage)
            : `草稿更新失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
      const draft =
        typeof payload === 'object' && payload !== null && 'draft' in payload
          ? toDraftItem((payload as { draft: unknown }).draft)
          : null;
      if (!draft) throw new Error('草稿更新返回异常');
      return draft;
    },
    onSuccess: () => invalidate(),
    onError: (e) => logger.debug('[useUpdateCardDraftMutation] failed', e),
  });
}

export function useAcceptCardDraftMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const invalidate = useInvalidateDrafts();
  return useMutation({
    mutationFn: async (vars: { draftId: string }): Promise<{ cardId: string }> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/flashcards/drafts/${encodeURIComponent(userId)}/${encodeURIComponent(vars.draftId)}/accept`,
        { method: 'POST' }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof payload === 'object' && payload !== null && 'userMessage' in payload
            ? String((payload as { userMessage: unknown }).userMessage)
            : `草稿入库失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
      const cardId =
        typeof payload === 'object' && payload !== null && 'cardId' in payload
          ? (payload as { cardId: unknown }).cardId
          : null;
      if (typeof cardId !== 'string') throw new Error('草稿入库返回异常');
      return { cardId };
    },
    onSuccess: () => invalidate(),
    onError: (e) => logger.debug('[useAcceptCardDraftMutation] failed', e),
  });
}

export function useDismissCardDraftMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const invalidate = useInvalidateDrafts();
  return useMutation({
    mutationFn: async (vars: { draftId: string }): Promise<void> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/flashcards/drafts/${encodeURIComponent(userId)}/${encodeURIComponent(vars.draftId)}/dismiss`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const msg =
          typeof payload === 'object' && payload !== null && 'userMessage' in payload
            ? String((payload as { userMessage: unknown }).userMessage)
            : `草稿驳回失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
    },
    onSuccess: () => invalidate(),
    onError: (e) => logger.debug('[useDismissCardDraftMutation] failed', e),
  });
}

export interface ProposeDraftVars {
  language: string;
  headword: string;
  reading?: string;
  meanings: string[];
  partOfSpeech?: string;
  source: 'ai-enrich' | 'agent' | 'import';
  sourceRef?: string;
  kind?: 'word' | 'sentence';
  cardType?: 'VOCABULARY' | 'GRAMMAR' | 'CONFUSION_PAIR' | 'SENTENCE';
}

/** 提议草稿（课文收句子/助手整理用；幂等去重，重复返回空数组）。 */
export function useProposeCardDraftMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { drafts: ProposeDraftVars[] }): Promise<CardDraftItem[]> => {
      const drafts = vars.drafts.slice(0, 10).map((d) => ({ userId, ...d }));
      const res = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/drafts/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof payload === 'object' && payload !== null && 'userMessage' in payload
            ? String((payload as { userMessage: unknown }).userMessage)
            : `草稿提议失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
      const list =
        typeof payload === 'object' && payload !== null && 'drafts' in payload
          ? (payload as { drafts: unknown }).drafts
          : null;
      if (!Array.isArray(list)) return [];
      const out: CardDraftItem[] = [];
      for (const d of list) {
        const item = toDraftItem(d);
        if (item) out.push(item);
      }
      return out;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DRAFTS });
    },
    onError: (e) => logger.debug('[useProposeCardDraftMutation] failed', e),
  });
}
