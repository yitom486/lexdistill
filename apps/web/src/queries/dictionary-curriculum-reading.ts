import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import type { HangulItem, HangulScriptType, KanaItem, ReadingPassageSet, NewsTopic } from '@study-studio/protocol';
import { logger } from '@study-studio/shared';
import { apiClient, GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

/** P1-2 拆分：词典/假名/课程阅读/新闻组（自 useLearnerQueries.ts 逐行平移，仅改 import）。 */

/** 五十音全表查询 (依托 Hono RPC 端到端强类型系统) */
export function useCurriculumKanaQuery(type?: string) {
  return useQuery<KanaItem[]>({
    queryKey: [...QUERY_KEYS.KANA, type ?? 'ALL'],
    queryFn: async () => {
      try {
        const res = await apiClient.api.curriculum.kana.$get({
          query: type ? { type } : {},
        });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            return list as KanaItem[];
          }
        }
      } catch (e) {
        logger.debug('[useCurriculumKanaQuery] Hono RPC fallback to local memory', e);
      }
      return [];
    },
    staleTime: 1000 * 60 * 30, // 课程底座几乎不变，长效缓存 30 分钟
  });
}

type AdaptiveKanaQueueScriptType = 'HIRAGANA' | 'KATAKANA' | 'ROMAJI';

interface AdaptiveKanaQueueQueryOptions {
  types?: readonly string[];
  kanaIds?: readonly string[];
  scriptType?: AdaptiveKanaQueueScriptType;
  limit?: number;
  round?: number;
  enabled?: boolean;
}

/** 读取由 Gateway 按用户逐项 FSRS 状态排好的本轮假名题目。 */
export function useAdaptiveKanaQueueQuery(
  options: AdaptiveKanaQueueQueryOptions = {},
  userId = DEFAULT_USER_ID
) {
  const types = options.types ?? [];
  const scriptType = options.scriptType ?? 'HIRAGANA';
  const limit = options.limit ?? 10;
  const round = options.round ?? 0;

  return useQuery<KanaItem[]>({
    queryKey: [...QUERY_KEYS.KANA_ADAPTIVE, userId, types.join(','), scriptType, limit, round, options.kanaIds?.join(',') ?? 'ALL'],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      try {
        const res = await apiClient.api.curriculum.kana.queue[':userId'].$get({
          param: { userId },
          query: {
            types: types.join(','),
            scriptType,
            limit: String(limit),
            ...(options.kanaIds ? { kanaIds: options.kanaIds.join(',') } : {}),
          },
        });
        if (res.ok) {
          const list = await res.json();
          return Array.isArray(list) ? (list as KanaItem[]) : [];
        }
      } catch (e) {
        logger.debug('[useAdaptiveKanaQueueQuery] Failed to load adaptive kana queue', e);
      }
      return [];
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

/** 提交假名练习结果并回写画像 (Hono RPC) */
export function useKanaPracticeMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      kanaId: string;
      isCorrect: boolean;
      scriptType?: 'HIRAGANA' | 'KATAKANA' | 'ROMAJI';
    }) => {
      try {
        const res = await apiClient.api.curriculum.kana.practice[':userId'].$post({
          param: { userId },
          json: {
            kanaId: payload.kanaId,
            isCorrect: payload.isCorrect,
            scriptType: payload.scriptType || 'HIRAGANA',
          },
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        logger.debug('[useKanaPracticeMutation] Failed to post kana practice', e);
      }
      throw new Error('假名练习保存失败，请重试。');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
    },
  });
}

/** 谚文字母全表查询 (Hono RPC，课程底座长效缓存 30 分钟) */
export function useCurriculumHangulQuery(type?: string) {
  return useQuery<HangulItem[]>({
    queryKey: [...QUERY_KEYS.HANGUL, type ?? 'ALL'],
    queryFn: async () => {
      // R09c：失败直接抛出（调用方区分加载中/读取失败/成功空）；key/重试/staleTime 不变
      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        res = await apiClient.api.curriculum.hangul.$get({
          query: type ? { type } : {},
        });
      } catch (e) {
        logger.debug('[useCurriculumHangulQuery] failed to load hangul', e);
        throw new Error('谚文底座读取失败，请重试。');
      }
      if (!res.ok) {
        logger.debug('[useCurriculumHangulQuery] hangul request failed', res.status);
        throw new Error('谚文底座读取失败，请重试。');
      }
      const list = await res.json();
      if (!Array.isArray(list)) {
        logger.debug('[useCurriculumHangulQuery] unexpected hangul payload');
        throw new Error('谚文底座读取失败，请重试。');
      }
      return list as HangulItem[];
    },
    staleTime: 1000 * 60 * 30,
  });
}

/** 提交谚文练习结果并回写画像 (Hono RPC) */
export function useHangulPracticeMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      hangulId: string;
      isCorrect: boolean;
      scriptType?: HangulScriptType;
    }) => {
      // R09c：回写失败直接抛出，不伪装成功；调用方统计失败并在战报中如实说明
      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        res = await apiClient.api.curriculum.hangul.practice[':userId'].$post({
          param: { userId },
          json: {
            hangulId: payload.hangulId,
            isCorrect: payload.isCorrect,
            scriptType: payload.scriptType || 'CONSONANT',
          },
        });
      } catch (e) {
        logger.debug('[useHangulPracticeMutation] Failed to post hangul practice', e);
        throw new Error('练习成绩回写失败，请检查网关后重试。');
      }
      if (!res.ok) {
        logger.debug('[useHangulPracticeMutation] practice request failed', res.status);
        throw new Error('练习成绩回写失败，请检查网关后重试。');
      }
      return (await res.json()) as { success: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}

/** 双源阅读理解篇目查询 (AI 分级篇目 / 真实合规新闻) */
export function useReadingSetsQuery(
  origin?: 'ai' | 'news' | 'user_import',
  lang?: 'JA' | 'EN' | 'KO',
  userId = DEFAULT_USER_ID
) {
  return useQuery<ReadingPassageSet[]>({
    queryKey: [...QUERY_KEYS.READING, userId, origin ?? 'ALL', lang ?? 'ALL'],
    queryFn: async () => {
      // R09b：失败直接抛出（调用方区分加载中/读取失败/成功空）；key/重试/staleTime 不变
      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        const query: Record<string, string> = {};
        if (origin) query.origin = origin;
        if (lang) query.lang = lang;
        res = await apiClient.api.reading.sets[':userId'].$get({
          param: { userId },
          query,
        });
      } catch (e) {
        logger.debug('[useReadingSetsQuery] failed to load sets', e);
        throw new Error('阅读篇目读取失败，请重试。');
      }
      if (!res.ok) {
        logger.debug('[useReadingSetsQuery] sets request failed', res.status);
        throw new Error('阅读篇目读取失败，请重试。');
      }
      const sets = await res.json();
      if (!Array.isArray(sets)) {
        logger.debug('[useReadingSetsQuery] unexpected sets payload');
        throw new Error('阅读篇目读取失败，请重试。');
      }
      return sets as ReadingPassageSet[];
    },
    staleTime: 1000 * 60 * 5, // 5 分钟缓存
  });
}

/** 新闻栏目 SSOT（Gateway / protocol） */
export function useNewsTopicsQuery() {
  return useQuery<NewsTopic[]>({
    queryKey: QUERY_KEYS.NEWS_TOPICS,
    queryFn: async () => {
      try {
        // 连字符路由在 Hono 客户端类型中缺失，此处为显式边界断言（与此前 as any 等价）。
        const readingApi = apiClient.api.reading as unknown as {
          'news-topics': { $get: () => Promise<Response> };
        };
        const res = await readingApi['news-topics'].$get();
        if (res.ok) {
          const topics = await res.json();
          if (Array.isArray(topics) && topics.length > 0) return topics as NewsTopic[];
        }
      } catch (e) {
        logger.debug('[useNewsTopicsQuery] fallback to protocol NEWS_TOPICS', e);
      }
      const { NEWS_TOPICS } = await import('@study-studio/protocol');
      return [...NEWS_TOPICS];
    },
    staleTime: 1000 * 60 * 30,
  });
}

export type PitchLexiconItem = {
  id: string;
  kanji: string;
  kana: string;
  romaji: string;
  meaning: string;
  pitchType: string;
  pitchPattern: Array<'L' | 'H'>;
  moraList: string[];
  contrastPair?: {
    kanji: string;
    kana: string;
    pitchType: string;
    pitchPattern: Array<'L' | 'H'>;
    meaning: string;
  };
  tip: string;
};

export type DictionaryLookupResult = {
  entries: Array<{
    id: string;
    language: 'ja' | 'en' | 'ko';
    headword: string;
    reading?: string;
    romanization?: string;
    meanings: string[];
    pronunciation?: Record<string, unknown>;
    partOfSpeech?: string;
    sourceLabel: string;
    licenseNote: string;
    /** 活用形还原注记（直击中时无） */
    inflectionNote?: string;
    /** 词频（数字越小越常用；无词频数据时无） */
    frequency?: number;
    /** 按来源的词频行（值升序，最多 4 条；无数据时无） */
    frequencies?: Array<{ source: string; value: number }>;
  }>;
  externalLookup?: {
    provider: 'OJAD';
    url: string;
    opensExternally: true;
  };
};

export type DictionaryPackageInfo = {
  id: string;
  language: 'en' | 'ja' | 'ko';
  provider: string;
  version: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  description: string;
  installMode: 'on_demand';
  installed: boolean;
  /** 安装器是否就绪（未就绪显示“即将推出”，不发起安装）。 */
  installerReady?: boolean;
  entryCount?: number;
  installedAt?: string;
  /** 用户开关（默认启用）；排序权重（越大越前）。 */
  enabled?: boolean;
  priority?: number;
};

export type DictionaryEntryCollection = {
  card: {
    id: string;
    userId: string;
    front: string;
    back: string;
    phonetic?: string;
    tags: string[];
  };
  created: boolean;
};

type DictionaryPackagesResponse = { packages: DictionaryPackageInfo[] };

/** 词典包只读取 Gateway 状态；不把大词典内容放入浏览器缓存。 */
export function useDictionaryPackagesQuery(enabled = true) {
  return useQuery<DictionaryPackagesResponse>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'packages'],
    enabled,
    queryFn: async () => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/dictionary/packages`);
      if (!response.ok) throw new Error('暂时无法读取词典包状态。');
      return (await response.json()) as DictionaryPackagesResponse;
    },
    staleTime: 1000 * 30,
  });
}

/** 用户显式确认后才下载词典包；成功后使本地查询结果和包状态同步刷新。 */
export function useInstallDictionaryPackageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (packageId: string) => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/dictionary/packages/${encodeURIComponent(packageId)}/install`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '词典包安装失败，请检查网络后重试。');
      }
      return (await response.json()) as DictionaryPackageInfo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'packages'] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DICTIONARY });
    },
  });
}

/**
 * 自备 Yomitan 词典包安装（bank v3 zip）：本地文件直传，或同机路径/直链。
 * 许可证由用户声明（网关如实标注“未验证”），大 zip 走本地路径避免上传 OOM。
 */
export function useInstallCustomDictionaryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      vars:
        | { file: File; language: 'en' | 'ja' | 'ko' }
        | { filePath: string; language: 'en' | 'ja' | 'ko' }
        | { url: string; language: 'en' | 'ja' | 'ko' }
    ): Promise<DictionaryPackageInfo> => {
      const language = vars.language;
      const response = await ('file' in vars
        ? (async () => {
            const form = new FormData();
            form.append('file', vars.file, vars.file.name);
            form.append('language', language);
            return fetch(`${GATEWAY_BASE_URL}/api/dictionary/packages/custom`, {
              method: 'POST',
              body: form,
            });
          })()
        : fetch(`${GATEWAY_BASE_URL}/api/dictionary/packages/custom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language,
              ...('filePath' in vars ? { filePath: vars.filePath } : {}),
              ...('url' in vars ? { url: vars.url } : {}),
            }),
          }));
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '自备词典安装失败，请检查文件后重试。');
      }
      return (await response.json()) as DictionaryPackageInfo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'packages'] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DICTIONARY });
    },
  });
}

/** 词典包配置（开关 / 排序权重），即时影响查词过滤与排序。 */
export function useUpdateDictionaryPackageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { packageId: string; enabled?: boolean; priority?: number }) => {
      const body: Record<string, boolean | number> = {};
      if (vars.enabled !== undefined) body['enabled'] = vars.enabled;
      if (vars.priority !== undefined) body['priority'] = vars.priority;
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/dictionary/packages/${encodeURIComponent(vars.packageId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(payload?.error?.userMessage ?? '词典配置更新失败。');
      }
      return (await response.json()) as { id: string; enabled: boolean; priority: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'packages'] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DICTIONARY });
    },
  });
}
export function useCollectDictionaryEntryMutation(userIdOverride?: string) {
  const profileUserId = useUserProfileStore(state => state.profile.userId);
  const userId = userIdOverride || profileUserId || DEFAULT_USER_ID;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/vocabulary/${encodeURIComponent(userId)}/entries/${encodeURIComponent(entryId)}/collect`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '暂时无法加入生词本，请稍后重试。');
      }
      return (await response.json()) as DictionaryEntryCollection;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'encountered'] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WORDLISTS });
    },
  });
}

/** 通用本地词典查询；日语未命中时由 Gateway 返回 OJAD 外链，前端不直接请求 OJAD。 */
export function useDictionaryLookupQuery(
  language: 'ja' | 'en' | 'ko',
  query: string,
  /** P3-1 阅读上下文（可选）：透传后 occurrence 带文档归属，无则旧语义。 */
  documentId?: string | undefined
) {
  const normalized = query.trim();
  const profileUserId = useUserProfileStore((s) => s.profile.userId || DEFAULT_USER_ID);
  return useQuery<DictionaryLookupResult>({
    queryKey: [...QUERY_KEYS.DICTIONARY, language, normalized, documentId ?? ''],
    enabled: Boolean(normalized),
    queryFn: async () => {
      const params = new URLSearchParams({
        q: normalized,
        userId: profileUserId,
        ...(documentId ? { documentId, quote: normalized } : {}),
      });
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/dictionary/${language}?${params.toString()}`
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '暂时无法查询本地词典，请稍后重试。');
      }
      return (await response.json()) as DictionaryLookupResult;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export type DictionaryHistoryItem = {
  query: string;
  hitCount: number;
  topEntryId?: string;
  createdAt: string;
};

/** 最近查词（画像信号 + 面板快捷入口）。 */
export function useDictionaryHistoryQuery(language: 'ja' | 'en' | 'ko', limit = 8) {
  const profileUserId = useUserProfileStore((s) => s.profile.userId || DEFAULT_USER_ID);
  return useQuery<DictionaryHistoryItem[]>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'history', language, profileUserId],
    queryFn: async () => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/dictionary/history/${encodeURIComponent(profileUserId)}?lang=${language}&limit=${limit}`
      );
      if (!response.ok) return [];
      const data: unknown = await response.json().catch(() => null);
      return Array.isArray(data) ? (data as DictionaryHistoryItem[]) : [];
    },
    staleTime: 1000 * 30,
  });
}

export type EncounteredTermItem = {
  userId: string;
  language: string;
  termKey: string;
  headword: string;
  reading?: string;
  status: 'new' | 'collected' | 'reviewing' | 'mastered';
  exposureCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  flashcardId?: string;
};

/** 相遇词热力（查词/收藏/阅读“见过”信号聚合，按最近相遇倒序）。 */
export function useEncounteredTermsQuery(language: 'ja' | 'en' | 'ko', limit = 50) {
  const profileUserId = useUserProfileStore((s) => s.profile.userId || DEFAULT_USER_ID);
  return useQuery<EncounteredTermItem[]>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'encountered', language, profileUserId],
    queryFn: async () => {
      // R06：失败直接抛出（调用方区分成功空与读取失败）；其余不变
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/encountered-terms/${encodeURIComponent(profileUserId)}?lang=${language}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error('相遇词读取失败，请重试。');
      }
      const data: unknown = await response.json().catch(() => null);
      if (!Array.isArray(data)) {
        throw new Error('相遇词读取失败，请重试。');
      }
      return (data as Array<Record<string, unknown>>)
        .filter((r) => typeof r.headword === 'string' && typeof r.termKey === 'string')
        .map((r): EncounteredTermItem => ({
          userId: typeof r.userId === 'string' ? r.userId : '',
          language: typeof r.language === 'string' ? r.language : language,
          termKey: r.termKey as string,
          headword: r.headword as string,
          status:
            r.status === 'collected' || r.status === 'reviewing' || r.status === 'mastered'
              ? r.status
              : ('new' as const),
          exposureCount: typeof r.exposureCount === 'number' ? r.exposureCount : 1,
          firstSeenAt: typeof r.firstSeenAt === 'string' ? r.firstSeenAt : '',
          lastSeenAt: typeof r.lastSeenAt === 'string' ? r.lastSeenAt : '',
          ...(typeof r.reading === 'string' ? { reading: r.reading } : {}),
          ...(typeof r.flashcardId === 'string' ? { flashcardId: r.flashcardId } : {}),
        }));
    },
    staleTime: 1000 * 30,
  });
}

/** 查词历史冷启动回填相遇词（幂等；老用户一键点亮热力）。 */
export function useBackfillEncounteredTermsMutation(language: 'ja' | 'en' | 'ko') {
  const queryClient = useQueryClient();
  const profileUserId = useUserProfileStore((s) => s.profile.userId || DEFAULT_USER_ID);
  return useMutation({
    mutationFn: async (): Promise<{ terms: number; occurrences: number }> => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/encountered-terms/${encodeURIComponent(profileUserId)}/backfill?lang=${language}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '回填失败，请稍后重试。');
      }
      const data: unknown = await response.json().catch(() => null);
      const rec = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      return {
        terms: typeof rec.terms === 'number' ? rec.terms : 0,
        occurrences: typeof rec.occurrences === 'number' ? rec.occurrences : 0,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DICTIONARY });
    },
  });
}

export type TermExampleItem = {
  sentence: string;
  translation: string;
  cached: boolean;
};

/**
 * 词条例句（网关缓存优先，未命中且已连模型则生成入库；失败回 null 由调用方隐藏）。
 * queryKey 带词面+读音，staleTime 1 小时（例句永久有效，生成后不再变）。
 */
export function useTermExamplesQuery(
  language: 'ja' | 'en' | 'ko',
  headword: string,
  opts?: { reading?: string; meanings?: string[]; enabled?: boolean }
) {
  const normalized = headword.trim();
  const params = new URLSearchParams({ lang: language, headword: normalized });
  if (opts?.reading) params.set('reading', opts.reading);
  if (opts?.meanings?.length) params.set('meanings', opts.meanings.slice(0, 4).join('；'));
  // 例句生成走所选运行时（缺席走默认 codex-acp；DB 缓存命中时本参数无影响）。
  const runtimeId = usePreferencesStore.getState().agentRuntimeId;
  if (runtimeId) params.set('runtimeId', runtimeId);
  return useQuery<TermExampleItem[] | null>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'examples', language, normalized, opts?.reading ?? ''],
    enabled: Boolean(normalized) && (opts?.enabled ?? true),
    queryFn: async () => {
      try {
        const response = await fetch(
          `${GATEWAY_BASE_URL}/api/dictionary/examples?${params.toString()}`
        );
        if (!response.ok) return null;
        const data: unknown = await response.json().catch(() => null);
        const list =
          typeof data === 'object' && data !== null && 'examples' in data
            ? (data as { examples: unknown }).examples
            : null;
        if (!Array.isArray(list)) return null;
        const out: TermExampleItem[] = [];
        for (const e of list) {
          if (!e || typeof e !== 'object') continue;
          const rec = e as Record<string, unknown>;
          if (typeof rec.sentence !== 'string' || typeof rec.translation !== 'string') continue;
          out.push({ sentence: rec.sentence, translation: rec.translation, cached: rec.cached === true });
        }
        return out;
      } catch (e) {
        logger.debug('[useTermExamplesQuery] failed', e);
        return null;
      }
    },
    staleTime: 1000 * 60 * 60,
  });
}

/** 声调基准词表（Gateway curriculum，非 OJAD） */
export function usePitchLexiconQuery(search = '') {
  return useQuery<PitchLexiconItem[]>({
    queryKey: [...QUERY_KEYS.PITCH, search],
    queryFn: async () => {
      try {
        const qs = search ? `?q=${encodeURIComponent(search)}` : '';
        const res = await fetch(`${GATEWAY_BASE_URL}/api/curriculum/pitch${qs}`);
        if (!res.ok) throw new Error('暂时无法读取声调基准词表，请稍后重试。');
        const data = (await res.json()) as { pitchEntries?: PitchLexiconItem[] };
        if (!Array.isArray(data.pitchEntries)) throw new Error('声调基准词表返回格式异常。');
        return data.pitchEntries;
      } catch (e) {
        logger.debug('[usePitchLexiconQuery] gateway request failed', e);
        throw e instanceof Error ? e : new Error('暂时无法读取声调基准词表。');
      }
    },
    staleTime: 1000 * 60 * 10,
  });
}

/** 动态生成或抓取阅读套题 (Hono RPC) */
export function useGenerateReadingSetMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      origin?: 'ai' | 'news';
      difficulty?: number;
      language?: 'JA' | 'EN' | 'KO';
      topic?: string;
    }) => {
      const res = await apiClient.api.reading.generate[':userId'].$post({
        param: { userId },
        json: {
          origin: payload.origin || 'ai',
          difficulty: payload.difficulty || 2,
          language: payload.language || 'EN',
          topic: payload.topic || 'education and media literacy',
        },
      });
      if (res.ok) {
        return (await res.json()) as ReadingPassageSet;
      }
      throw new Error('生成阅读篇目失败');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.READING });
    },
  });
}

/** 提交阅读理解答题成绩 (Hono RPC) */
export function useSubmitReadingPracticeMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      setId: string;
      score: number;
      totalQuestions: number;
      language?: 'JA' | 'EN' | 'KO';
    }) => {
      const res = await apiClient.api.reading.practice[':userId'].$post({
        param: { userId },
        json: {
          setId: payload.setId,
          score: payload.score,
          totalQuestions: payload.totalQuestions,
          language: payload.language || 'EN',
        },
      });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('提交阅读成绩失败');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
    },
  });
}

export type WritingPromptItem = {
  id: string;
  category: string;
  chinesePrompt: string;
  contextHint: string;
  testedSkillId: string;
  standardAnswer: string;
  grammarFocus: string;
};

export type DictationChallengeItem = {
  id: string;
  sourceLesson: string;
  speaker: string;
  fullJapanese: string;
  chinese: string;
  blankPrompt: string;
  clozeDisplay: string;
  targetWord: string;
  furiganaHint: string;
  categoryTag: string;
  testedSkillId: string;
  grammarExplanation: string;
};

/** 调用 Gateway learning.content 生成写作题干 */
export function useGenerateWritingPromptsMutation(userId = DEFAULT_USER_ID) {
  const language = normalizeTrackLanguage(useUserProfileStore(s => s.profile.targetLanguage));
  return useMutation({
    mutationFn: async (payload: {
      genre?: string;
      difficulty?: number;
      count?: number;
      skillIds?: string[];
      collect?: boolean;
    }) => {
      const res = await apiClient.api.learning.content[':userId'].$post({
        param: { userId },
        json: {
          action: 'generate_writing_prompt',
          genre: payload.genre || 'translation',
          difficulty: payload.difficulty || 3,
          count: payload.count || 3,
          skillIds: payload.skillIds,
          collect: payload.collect ?? true,
          language,
        },
      });
      if (!res.ok) throw new Error('生成写作题干失败');
      const data = (await res.json()) as {
        writingPrompts?: WritingPromptItem[];
        questions?: Array<{
          id: string;
          prompt: string;
          content: string;
          correctAnswer: string;
          explanation: string;
          testedSkillId: string;
        }>;
        collectionId?: string;
      };
      if (data.writingPrompts?.length) return data.writingPrompts;
      return (data.questions ?? []).map((q) => ({
        id: q.id,
        category: 'AI 写作题干',
        chinesePrompt: q.prompt || q.content,
        contextHint: q.explanation,
        testedSkillId: q.testedSkillId,
        standardAnswer: q.correctAnswer,
        grammarFocus: q.explanation,
      }));
    },
  });
}

export type KanaWordItem = {
  id: string;
  /** 词典条目 id（可直接调收集接口转 FSRS 生词卡）。 */
  entryId: string;
  headword: string;
  /** 假名读音（听写播报与作答比对用）。 */
  kana: string;
  meanings: string[];
  /** TTS 朗读文本（即 kana）。 */
  audioText: string;
  sourceLabel: string;
};

/** 调用 Gateway learning.content 生成假名单词（听写/词义巩固，系统随机出题）。 */
export function useGenerateKanaWordsMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (payload?: { count?: number; script?: 'HIRAGANA' | 'KATAKANA' }) => {
      const res = await apiClient.api.learning.content[':userId'].$post({
        param: { userId },
        json: {
          action: 'generate_kana_words',
          count: payload?.count || 8,
          collect: false,
          language: 'ja',
          ...(payload?.script ? { script: payload.script } : {}),
        },
      });
      if (!res.ok) throw new Error('生成假名单词失败');
      const data = (await res.json()) as { kanaWords?: KanaWordItem[] };
      if (!data.kanaWords?.length) throw new Error('假名单词为空');
      return data.kanaWords;
    },
  });
}

/** 韩语词语（听写选词/词义回想，韩语表层形 + 英文释义，无需输入法）。 */
export interface HangulWordItem {
  id: string;
  entryId: string;
  korean: string;
  meanings: string[];
  audioText: string;
  sourceLabel: string;
}

/** 调用 Gateway learning.content 生成韩语单词（词池=已安装韩语词典包，未安装抛错由 UI 显式引导）。 */
export function useGenerateHangulWordsMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (payload?: { count?: number }) => {
      const res = await apiClient.api.learning.content[':userId'].$post({
        param: { userId },
        json: {
          action: 'generate_hangul_words',
          count: payload?.count || 8,
          collect: false,
          language: 'ko',
        },
      });
      if (!res.ok) throw new Error('生成韩语单词失败');
      const data = (await res.json()) as { hangulWords?: HangulWordItem[] };
      if (!Array.isArray(data.hangulWords)) throw new Error('韩语单词内容无法读取，请重试。');
      return data.hangulWords;
    },
  });
}

/** 调用 Gateway learning.content 生成挖词听写 */
export function useGenerateDictationMutation(userId = DEFAULT_USER_ID) {
  const language = normalizeTrackLanguage(useUserProfileStore(s => s.profile.targetLanguage));
  return useMutation({
    mutationFn: async (payload?: { count?: number; skillIds?: string[] }) => {
      const res = await apiClient.api.learning.content[':userId'].$post({
        param: { userId },
        json: {
          action: 'generate_quiz',
          format: 'LISTENING_DICTATION',
          count: payload?.count || 4,
          skillIds: payload?.skillIds,
          collect: true,
          language,
        },
      });
      if (!res.ok) throw new Error('生成听写题失败');
      const data = (await res.json()) as { dictationItems?: DictationChallengeItem[] };
      if (!data.dictationItems?.length) throw new Error('听写题为空');
      return data.dictationItems;
    },
  });
}

/** 卡片模板包（统一交换格式；与 learner-core AnkiCardFormat 同形，Web 侧本地声明避免打包 Node 侧）。 */
export interface AnkiCardFormatInfo {
  id: string;
  name: string;
  entryType: string;
  deckName?: string;
  modelName?: string;
  fields: Record<string, string>;
  frontTemplate: string;
  backTemplate: string;
  css: string;
  templateVersion: number;
  userModified: boolean;
}

export interface CardPreviewResult {
  format: AnkiCardFormatInfo;
  rendered: { fields: Record<string, string>; frontHtml: string; backHtml: string };
  issues: string[];
}

/** 卡片模板列表（含内置懒播种）。 */
export function useCardFormatsQuery(enabled = true) {
  return useQuery<{ formats: AnkiCardFormatInfo[] }>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'card-formats'],
    enabled,
    queryFn: async () => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/formats`);
      if (!response.ok) throw new Error('暂时无法读取卡片模板。');
      return (await response.json()) as { formats: AnkiCardFormatInfo[] };
    },
    staleTime: 1000 * 60,
  });
}

function cacheReturnedCardFormat(queryClient: ReturnType<typeof useQueryClient>, format: AnkiCardFormatInfo) {
  queryClient.setQueryData<{ formats: AnkiCardFormatInfo[] }>([...QUERY_KEYS.DICTIONARY, 'card-formats'], (old) => ({
    formats: old?.formats.some((item) => item.id === format.id)
      ? old.formats.map((item) => item.id === format.id ? format : item)
      : [...(old?.formats ?? []), format],
  }));
  void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'card-formats'] });
}
/** 保存模板（新建或覆盖；网关校验不通过时抛中文错）。 */
export function useSaveCardFormatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (format: AnkiCardFormatInfo) => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/flashcards/formats/${encodeURIComponent(format.id)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(format) }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(payload?.error?.userMessage ?? '模板保存失败。');
      }
      return (await response.json()) as { format: AnkiCardFormatInfo };
    },
    onSuccess: ({ format }) => cacheReturnedCardFormat(queryClient, format),
  });
}

/** 恢复内置版本（仅内置 id）。 */
export function useResetCardFormatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formatId: string) => {
      const response = await fetch(
        `${GATEWAY_BASE_URL}/api/flashcards/formats/${encodeURIComponent(formatId)}/reset`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(payload?.error?.userMessage ?? '恢复内置模板失败。');
      }
      return (await response.json()) as { format: AnkiCardFormatInfo };
    },
    onSuccess: ({ format }) => cacheReturnedCardFormat(queryClient, format),
  });
}

export interface CardPreviewEntry {
  headword: string;
  reading?: string;
  meanings: string[];
  partOfSpeech?: string;
  pitchLabel?: string;
  frequency?: number;
  sentence?: string;
  sourceUrl?: string;
  tags?: string[];
}

/** 预览渲染（草稿只渲染不入库；与工作台防抖调用）。 */
export function usePreviewCardMutation() {  return useMutation({
    mutationFn: async (payload: {
      formatId?: string;
      inlineFormat?: AnkiCardFormatInfo;
      entry: CardPreviewEntry;
    }) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(data?.error?.userMessage ?? '预览渲染失败。');
      }
      return (await response.json()) as CardPreviewResult;
    },
  });
}

/** AnkiConnect 状态（开关 + 端点 + 本机 Anki 探测；默认关闭）。 */
export interface AnkiPushStatus {
  enabled: boolean;
  endpoint: string;
  connected: boolean;
  ankiVersion: number | null;
}

/** 推送结果（noteId 为 Anki 侧笔记 id；无 TTS 凭证时音频留空并明说）。 */
export interface AnkiPushResult {
  noteId: number;
  deckName: string;
  modelName: string;
  formatId: string;
  audioStored: boolean;
  audioSkippedReason?: string;
  ttsWarning?: string;
}

export function useAnkiStatusQuery(enabled = true) {
  return useQuery<AnkiPushStatus>({
    queryKey: [...QUERY_KEYS.DICTIONARY, 'anki-status'],
    enabled,
    queryFn: async () => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/anki/status`);
      if (!response.ok) throw new Error('暂时无法读取 Anki 推送状态。');
      return (await response.json()) as AnkiPushStatus;
    },
    staleTime: 1000 * 30,
  });
}

/** AnkiConnect 开关/端点（endpoint 仅本机回环，网关拒绝远程地址）。 */
export function useSaveAnkiSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { enabled?: boolean; endpoint?: string }) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/anki/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(payload?.error?.userMessage ?? 'Anki 设置保存失败。');
      }
      return (await response.json()) as AnkiPushStatus;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'anki-status'] });
    },
  });
}

export interface AnkiPushTts {
  provider: string;
  baseUrl?: string;
  localBaseUrl?: string;
  localApiKey?: string;
  region?: string;
  apiKey?: string;
  voice?: string;
  model?: string;
  rate?: number;
  gender?: 'FEMALE' | 'MALE';
}

/** 推送生词卡到本机 Anki（TTS 凭证随请求来、网关不落盘；不提供则音频留空）。 */export function usePushToAnkiMutation() {
  return useMutation({
    mutationFn: async (payload: {
      userId?: string;
      cardId: string;
      formatId?: string;
      deckName?: string;
      tts?: AnkiPushTts;
    }) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/anki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, ...payload }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(data?.error?.userMessage ?? '推送到 Anki 失败。');
      }
      return (await response.json()) as AnkiPushResult;
    },
  });
}

/** .apkg 分析结果（只读；模板草稿需用户确认映射后另存）。 */
export interface ApkgModelDraft {
  modelName: string;
  ankiFields: string[];
  front: string;
  back: string;
  css: string;
  fieldMapping: Record<string, string | null>;
  compatIssues: string[];
  exampleNoteCount: number;
}

export interface ApkgAnalysis {
  fileLabel: string;
  noteCount: number;
  cardCount: number;
  decks: Array<{ name: string; noteCount: number }>;
  models: ApkgModelDraft[];
  mediaFileCount: number;
  mediaRefCount: number;
  truncated: boolean;
}

export interface ApkgImportResult {
  created: number;
  skippedDuplicate: number;
  skippedEmpty: number;
  mediaSkipped: number;
  mediaStored: number;
  decks: string[];
  truncated: boolean;
}

/** .apkg 只读分析（牌组/笔记计数 + 模板草稿 + 映射推测；不写库）。 */
export function useAnalyzeApkgMutation() {
  return useMutation({
    mutationFn: async (filePath: string) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/apkg/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(data?.error?.userMessage ?? '.apkg 分析失败。');
      }
      return (await response.json()) as ApkgAnalysis;
    },
  });
}

/** .apkg 导出（自研卡 → Anki 包；二进制下载，移动端同步通道）。 */
export function useExportApkgMutation() {
  return useMutation({
    mutationFn: async (payload: {
      userId?: string;
      language?: 'ja' | 'en' | 'ko';
      deckName?: string;
      formatId?: string;
      maxCards?: number;
    }) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/apkg/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, ...payload }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(data?.error?.userMessage ?? '.apkg 导出失败。');
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : 'cards.apkg';
      const blob = await response.blob();
      return { blob, filename };
    },
  });
}

/** .apkg 笔记搬家（笔记 → FSRS 卡；进度一律 NEW；去重；媒体入库/计数）。 */
export function useImportApkgNotesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      filePath: string;
      userId?: string;
      language: 'ja' | 'en' | 'ko';
      deckNames?: string[];
      maxNotes?: number;
    }) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/flashcards/apkg/import-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, ...payload }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(data?.error?.userMessage ?? '.apkg 导入失败。');
      }
      return (await response.json()) as ApkgImportResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
    },
  });
}
