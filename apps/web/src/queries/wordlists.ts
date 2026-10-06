import { useQuery } from '@tanstack/react-query';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

export interface WordlistWord {
  entryId: string;
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  sourceLabel: string;
  collected: boolean;
  studied: boolean;
  jlpt?: string | undefined;
}

export interface WordlistGroup {
  id: string;
  title: string;
  subtitle: string;
  words: WordlistWord[];
}

function toWord(row: Record<string, unknown>): WordlistWord {
  const meaningsRaw = Array.isArray(row.meanings) ? row.meanings : [];
  return {
    entryId: typeof row.entryId === 'string' ? row.entryId : '',
    headword: typeof row.headword === 'string' ? row.headword : '',
    ...(typeof row.reading === 'string' ? { reading: row.reading } : {}),
    meanings: meaningsRaw.map((m) => String(m)),
    ...(typeof row.partOfSpeech === 'string' ? { partOfSpeech: row.partOfSpeech } : {}),
    sourceLabel: typeof row.sourceLabel === 'string' ? row.sourceLabel : '',
    collected: row.collected === true,
    studied: row.studied === true,
    ...(typeof row.jlpt === 'string' ? { jlpt: row.jlpt } : {}),
  };
}

/** 零基础单词表（开箱词包 + N5 核心，含已收/已学透态；失败返回空数组，UI 显式空态）。 */
export function useWordlistsQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);
  return useQuery<WordlistGroup[]>({
    queryKey: [...QUERY_KEYS.WORDLISTS, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = `${GATEWAY_BASE_URL}/api/wordlists/${userId}?lang=${targetLanguage}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const list = (await res.json()) as unknown;
        if (!Array.isArray(list)) return [];
        return (list as Array<Record<string, unknown>>).map((g) => ({
          id: typeof g.id === 'string' ? g.id : '',
          title: typeof g.title === 'string' ? g.title : '',
          subtitle: typeof g.subtitle === 'string' ? g.subtitle : '',
          words: Array.isArray(g.words)
            ? (g.words as Array<Record<string, unknown>>).map(toWord)
            : [],
        }));
      } catch {
        return [];
      }
    },
    staleTime: 1000 * 60,
  });
}
