import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@study-studio/shared';
import { parseTextbookAST, type TextbookAST } from '@study-studio/protocol';
import { apiClient, GATEWAY_BASE_URL } from '../lib/api-client.js';
import {
  GatewayRequestError,
  readGatewayErrorCode,
  readGatewayErrorDetails,
  readGatewayUserMessage,
} from '../lib/gateway-error.js';
import type { TextbookBook } from '../models/textbook.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';

/** P1-2 拆分：教材 / 批注组（自 useLearnerQueries.ts 逐行平移，仅改 import）。 */

/**
 * 教材知识树查询（Gateway documents 为 SSOT；空库 / 失败时返回空数组，
 * 由 UI 显式提示导入或等待内置课程种子，不再回退到前端内置教材内容）。
 *
 * QueryKey 豁免说明（G2）：本键不带 track——documents 按 userId 隔离，
 * 教材 Tab 仅在 ja 轨道开放（见 learning-shell allowedTabs），无跨语种串扰；
 * kana 为 JA 唯一底座、news-topics 为语言中立，均同理豁免。
 */
export function useTextbooksQuery(userId = DEFAULT_USER_ID) {
  return useQuery<TextbookBook[]>({
    queryKey: [...QUERY_KEYS.TEXTBOOKS, userId],
    queryFn: async () => {
      try {
        const res = await apiClient.api.documents[':userId'].$get({ param: { userId } });
        if (res.ok) {
          const docs = await res.json();
          if (Array.isArray(docs) && docs.length > 0) {
            const dynamicBooks: TextbookBook[] = [];
            for (const doc of docs) {
              if (doc.astJson) {
                try {
                  const parsed = JSON.parse(doc.astJson);
                  if (parsed && parsed.id && Array.isArray(parsed.lessons)) {
                    dynamicBooks.push({ ...(parsed as TextbookBook), documentId: doc.id });
                  }
                } catch {
                  // ignore corrupt ast
                }
              }
            }
            return dynamicBooks;
          }
        }
      } catch (e) {
        logger.debug('[useTextbooksQuery] failed to load documents from gateway', e);
      }
      return [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** 追加导入教材并持久化至 Gateway SQLite */
export function useImportTextbookMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (book: TextbookBook) => {
      try {
        // TextbookBook 类型无 description；导入 AST 运行时可能携带该字段，兼容读取。
        const bookDescription = (book as { description?: unknown }).description;
        await apiClient.api.documents[':userId'].$post({
          param: { userId },
          json: {
            id: book.id,
            title: book.title,
            sourceKind: 'user_import',
            // E：入库语种跟 AST（JA/EN/KO → ja/en/ko），缺席回退 ja，不写死。
            language: book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja',
            content: (typeof bookDescription === 'string' && bookDescription) || book.title,
            astJson: JSON.stringify(book),
            sourcePublisher: book.publisher || '用户自主导入',
          },
        });
      } catch (e) {
        logger.debug('[useImportTextbookMutation] Hono RPC failed to save textbook to gateway', e);
      }
      return book;
    },
    onSuccess: (book) => {
      queryClient.setQueryData<TextbookBook[]>([...QUERY_KEYS.TEXTBOOKS, userId], (prev = []) => [
        book,
        ...prev.filter((b) => b.id !== book.id),
      ]);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
    },
  });
}

/** 课文划线批注查询 (依托 Hono RPC 端到端强类型系统) */
export function useAnnotationsQuery(documentId: string, userId = DEFAULT_USER_ID) {
  return useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATIONS, userId, documentId],
    queryFn: async () => {
      if (!documentId) return [];
      try {
        const res = await apiClient.api.annotations[':userId'][':documentId'].$get({
          param: { userId, documentId },
        });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) return list;
        }
      } catch (e) {
        logger.debug('[useAnnotationsQuery] Hono RPC failed to load annotations', e);
      }
      return [];
    },
    enabled: Boolean(documentId),
    staleTime: 1000 * 60 * 2,
  });
}

/** 新增课文划线批注 */
export function useAddAnnotationMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      documentId: string;
      kind: 'KEY_POINT' | 'VOCAB' | 'GRAMMAR' | 'EXAM_TRAP' | 'PARAPHRASE';
      quote: string;
      note?: string;
      startOffset?: number;
      endOffset?: number;
    }) => {
      const res = await apiClient.api.annotations[':userId'].$post({
        param: { userId },
        json: input,
      });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('保存批注失败');
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.ANNOTATIONS, userId, variables.documentId],
      });
    },
  });
}

export interface ReadingPositionLocator {
  lessonId?: string;
  page?: number;
  viewMode?: string;
}

/** 阅读位置查询（无记录回 null；documentId 为空时禁用）。 */
export function useReadingPositionQuery(documentId?: string, userId = DEFAULT_USER_ID) {
  return useQuery<ReadingPositionLocator | null>({
    queryKey: [...QUERY_KEYS.DOCUMENTS, 'position', userId, documentId ?? ''],
    queryFn: async () => {
      if (!documentId) return null;
      try {
        const res = await fetch(
          `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(documentId)}/position`
        );
        if (!res.ok) return null;
        const payload: unknown = await res.json().catch(() => null);
        const position =
          typeof payload === 'object' && payload !== null && 'position' in payload
            ? (payload as { position: unknown }).position
            : null;
        if (!position || typeof position !== 'object') return null;
        const locator = (position as { locator?: unknown }).locator;
        if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return null;
        const out: ReadingPositionLocator = {};
        const rec = locator as Record<string, unknown>;
        if (typeof rec.lessonId === 'string') out.lessonId = rec.lessonId;
        if (typeof rec.page === 'number' && Number.isFinite(rec.page)) out.page = rec.page;
        if (typeof rec.viewMode === 'string') out.viewMode = rec.viewMode;
        return out;
      } catch (e) {
        logger.debug('[useReadingPositionQuery] failed', e);
        return null;
      }
    },
    enabled: Boolean(documentId),
    staleTime: 1000 * 60 * 2,
  });
}

/** 阅读位置保存（静默：失败只记 debug，不打扰阅读）。 */
export function useSaveReadingPositionMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { documentId: string; locator: ReadingPositionLocator }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/position`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locator: vars.locator }),
        }
      );
      if (!res.ok) throw new Error(`保存阅读位置失败（HTTP ${res.status}）`);
    },
    onSuccess: (_, vars) => {
      queryClient.setQueryData(
        [...QUERY_KEYS.DOCUMENTS, 'position', userId, vars.documentId],
        vars.locator
      );
    },
    onError: (e) => logger.debug('[useSaveReadingPositionMutation] failed', e),
  });
}

/**
 * 打开课次即记（reading 源）：把该课生词表记为见过，同课同天一次。
 * 词面/读音取自课文 AST（非 NLP），静默失败；返回 { recorded, skipped }。
 */
export function useRecordReadingExposuresMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      documentId: string;
      lessonId: string;
      language: string;
      terms: Array<{ headword: string; reading?: string }>;
    }): Promise<{ recorded: number; skipped: boolean }> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/reading-exposures`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId: vars.lessonId,
            language: vars.language,
            terms: vars.terms.slice(0, 30),
          }),
        }
      );
      if (!res.ok) throw new Error(`记录阅读相遇失败（HTTP ${res.status}）`);
      const payload: unknown = await res.json().catch(() => null);
      const rec = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >;
      return {
        recorded: typeof rec.recorded === 'number' ? rec.recorded : 0,
        skipped: rec.skipped === true,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DICTIONARY });
    },
    onError: (e) => logger.debug('[useRecordReadingExposuresMutation] failed', e),
  });
}

export interface ImportPdfResult {
  book: TextbookAST;
  classification: {
    pdfType: string;
    pageCount: number;
    pagesNeedingOcr: number[];
    ocrUsed: boolean;
    selectedPages: number[];
    /** 云回填命中的页（无云调用时缺席） */
    azurePages?: number[];
    /** CMD-08 全部页夹持：超限未失败而是对首窗转换（无夹持时缺席） */
    clampedFromAll?: boolean;
  };
  stats: {
    lessons: number;
    dialogues: number;
  };
}

/**
 * PDF 上传导入：multipart 发网关 /api/documents/:userId/import-pdf，
 * 网关做分类/提取/结构化后返回 TextbookAST（协议层已验），前端复用既有
 * 确认导入链路（parseTextbookAST → onImportBook → useImportTextbookMutation）入库。
 * 注意：扫描版首次 OCR 会触发网关按需下载运行时（约 80MB，一次性），属正常等待。
 */
export function useImportPdfMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (
      vars:
        | { file: File; startPage?: number; endPage?: number; azure?: PdfAzureCredential; classes?: StructureClassItem[] }
        | { filePath: string; startPage?: number; endPage?: number; azure?: PdfAzureCredential; classes?: StructureClassItem[] }
    ): Promise<ImportPdfResult> => {
      const hasPath = 'filePath' in vars;
      const classes = vars.classes && vars.classes.length > 0 ? vars.classes : undefined;
      const res = hasPath
        ? await fetch(`${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/import-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: vars.filePath,
              ...(vars.startPage !== undefined ? { startPage: vars.startPage } : {}),
              ...(vars.endPage !== undefined ? { endPage: vars.endPage } : {}),
              ...azureBodyFields(vars.azure),
              ...(classes ? { classes } : {}),
            }),
          })
        : await (async () => {
            const form = new FormData();
            form.append('file', vars.file, vars.file.name);
            if (vars.startPage !== undefined) form.append('startPage', String(vars.startPage));
            if (vars.endPage !== undefined) form.append('endPage', String(vars.endPage));
            azureFormFields(form, vars.azure);
            if (classes) form.append('classes', JSON.stringify(classes));
            return fetch(`${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/import-pdf`, {
              method: 'POST',
              body: form,
            });
          })();
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `PDF 导入失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const bookRaw =
        typeof payload === 'object' && payload !== null && 'book' in payload
          ? (payload as { book: unknown }).book
          : null;
      const parsed = parseTextbookAST(bookRaw);
      if (!parsed.ok) throw new Error(parsed.error.userMessage);
      const rest =
        typeof payload === 'object' && payload !== null
          ? (payload as {
              classification?: ImportPdfResult['classification'];
              stats?: ImportPdfResult['stats'];
            })
          : {};
      return {
        book: parsed.value,
        classification: rest.classification ?? {
          pdfType: 'Unknown',
          pageCount: 0,
          pagesNeedingOcr: [],
          ocrUsed: false,
          selectedPages: [],
        },
        stats: rest.stats ?? { lessons: 0, dialogues: 0 },
      };
    },
    onError: (e) => {
      logger.debug('[useImportPdfMutation] pdf import failed', e);
    },
  });
}

export interface ImportDocumentResult {
  documentId: string;
  title: string;
  lessons: number;
}

/**
 * 统一文档导入（EPUB/MOBI/文本/URL 同一命令；PDF 专线另走 import-pdf）。
 * 后端只接受本机绝对路径（filePath）/直传文本/网址，不收浏览器 File 上传——
 * 浏览器 File 无本地路径，EPUB/MOBI 请填本机路径（桌面端）或改走网址/文本。
 */
export function useImportDocumentMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      vars: { filePath: string } | { url: string } | { text: string; filename?: string }
    ): Promise<ImportDocumentResult> => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/library/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...vars }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `文档导入失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const body =
        typeof payload === 'object' && payload !== null
          ? (payload as { documentId?: unknown; title?: unknown; lessons?: unknown })
          : {};
      if (typeof body.documentId !== 'string') throw new Error('导入返回缺少 documentId');
      return {
        documentId: body.documentId,
        title: typeof body.title === 'string' ? body.title : '未命名文档',
        lessons: typeof body.lessons === 'number' ? body.lessons : 0,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
    },
    onError: (e) => {
      logger.debug('[useImportDocumentMutation] document import failed', e);
    },
  });
}

export interface EnrichLessonResult {
  enrichedLessons: number;
  vocabularies: number;
  grammarPoints: number;
  dropped: number;
  draftsProposed: number;
}
/**
 * AI 抽生词：POST /api/documents/:userId/:documentId/enrich { lessonId? }。
 * 网关侧调模型抽取 + 接地校验后写回课文 AST；前端失效教材查询重拉。
 * 无模型连接时网关返回 E_ENRICH_NO_ADAPTER，这里只透出 userMessage。
 */
export function useEnrichLessonMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { documentId: string; lessonId?: string }): Promise<EnrichLessonResult> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/enrich`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vars.lessonId ? { lessonId: vars.lessonId } : {}),
        }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `抽生词失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const p = (payload ?? {}) as Partial<EnrichLessonResult>;
      return {
        enrichedLessons: Number(p.enrichedLessons ?? 0),
        vocabularies: Number(p.vocabularies ?? 0),
        grammarPoints: Number(p.grammarPoints ?? 0),
        dropped: Number(p.dropped ?? 0),
        draftsProposed: Number(p.draftsProposed ?? 0),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
    },
    onError: (e) => {
      logger.debug('[useEnrichLessonMutation] enrich failed', e);
    },
  });
}

export interface AppendPdfResult {
  documentId: string;
  addedLessons: number;
  addedDialogues: number;
  totalLessons: number;
}

export interface TextbookLessonQuizResult {
  questions: Array<Record<string, unknown>>;
  collectionId: string;
  bookTitle: string;
  lessonTitle: string;
}

/**
 * 本课真出题：POST /api/textbook-quiz/:userId { documentId, lessonId, count }。
 * 只消费本课 AST 已有语料（自带习题 → 生词 → 对话），无语料如实报错并指路 AI 抽生词；
 * 题目同步收进练习队列（转卡防线不变），返回给调用方即时开练。
 */
export function useTextbookLessonQuizMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      documentId: string;
      lessonId: string;
      count?: number;
    }): Promise<TextbookLessonQuizResult> => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/textbook-quiz/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `本课出题失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const p = (payload ?? {}) as Record<string, unknown>;
      return {
        questions: Array.isArray(p.questions)
          ? (p.questions as Array<Record<string, unknown>>)
          : [],
        collectionId: typeof p.collectionId === 'string' ? p.collectionId : '',
        bookTitle: typeof p.bookTitle === 'string' ? p.bookTitle : '',
        lessonTitle: typeof p.lessonTitle === 'string' ? p.lessonTitle : '',
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PRACTICE_COLLECTIONS });
    },
    onError: (e) => {
      logger.debug('[useTextbookLessonQuizMutation] quiz failed', e);
    },
  });
}

/**
 * 接力追加：新页段的课接在已有教材后面（大书分段导入）。
 * lessonNumber 由网关按现有最大值续排；课 id 取自新 AST（时间戳前缀不撞号）。
 */
export function useAppendPdfMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      vars: { documentId: string } & (
        | { file: File; startPage?: number; endPage?: number; azure?: PdfAzureCredential }
        | { filePath: string; startPage?: number; endPage?: number; azure?: PdfAzureCredential }
      )
    ): Promise<AppendPdfResult> => {
      const hasPath = 'filePath' in vars;
      const { documentId, ...src } = vars;
      const startPage = (src as { startPage?: number }).startPage;
      const endPage = (src as { endPage?: number }).endPage;
      const azure = (src as { azure?: PdfAzureCredential }).azure;
      const res = hasPath
        ? await fetch(
            `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(documentId)}/append-pdf`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: (src as { filePath: string }).filePath,
                ...(startPage !== undefined ? { startPage } : {}),
                ...(endPage !== undefined ? { endPage } : {}),
                ...azureBodyFields(azure),
              }),
            }
          )
        : await (async () => {
            const f = (src as { file: File }).file;
            const form = new FormData();
            form.append('file', f, f.name);
            if (startPage !== undefined) form.append('startPage', String(startPage));
            if (endPage !== undefined) form.append('endPage', String(endPage));
            azureFormFields(form, azure);
            return fetch(
              `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(documentId)}/append-pdf`,
              { method: 'POST', body: form }
            );
          })();
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `接力追加失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const p = (payload ?? {}) as Partial<AppendPdfResult>;
      return {
        documentId: String(p.documentId ?? documentId),
        addedLessons: Number(p.addedLessons ?? 0),
        addedDialogues: Number(p.addedDialogues ?? 0),
        totalLessons: Number(p.totalLessons ?? 0),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
    },
    onError: (e) => {
      logger.debug('[useAppendPdfMutation] append failed', e);
    },
  });
}

export interface PdfPageHeading {
  page: number;
  level: number;
  text: string;
  /** 版式特征（map-pdf 有解析信号时才带；透传给分类用） */
  relSize?: number;
  bold?: boolean;
  centered?: boolean;
  standalone?: boolean;
  hasNumbering?: boolean;
  structRole?: string;
}

export interface PdfTocEntry {
  label: string;
  lessonNo: string;
  printedPage: number;
}

export interface MapPdfResult {
  classification: {
    pdfType: string;
    pageCount: number;
    pagesNeedingOcr: number[];
    ocrUsed: boolean;
    selectedPages: number[];
    /** 云回填命中的页（无云调用时缺席） */
    azurePages?: number[];
  };
  window: number[];
  headings: PdfPageHeading[];
  tocEntries: PdfTocEntry[];
}

/** 云 OCR 凭据（随请求发网关，内存态用完即弃；不填走纯本地链路）。 */
export interface PdfAzureCredential {
  endpoint: string;
  key: string;
}

function azureBodyFields(azure: PdfAzureCredential | undefined): Record<string, string> {
  if (!azure || !azure.endpoint.trim() || !azure.key.trim()) return {};
  return { azureEndpoint: azure.endpoint.trim(), azureKey: azure.key.trim() };
}

function azureFormFields(form: FormData, azure: PdfAzureCredential | undefined): void {
  const fields = azureBodyFields(azure);
  if (fields.azureEndpoint) form.append('azureEndpoint', fields.azureEndpoint);
  if (fields.azureKey) form.append('azureKey', fields.azureKey);
}

/**
 * PDF 结构预览：扫一个窗口页，返回每页标题 + 目录条目（目录感知导入第一步）。
 * 调用方按标题页选范围，再调 useImportPdfMutation 精确导入。
 */
export function useMapPdfMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (
      vars:
        | { file: File; startPage?: number; endPage?: number; azure?: PdfAzureCredential }
        | { filePath: string; startPage?: number; endPage?: number; azure?: PdfAzureCredential }
    ): Promise<MapPdfResult> => {
      const hasPath = 'filePath' in vars;
      const res = hasPath
        ? await fetch(`${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/map-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: vars.filePath,
              ...(vars.startPage !== undefined ? { startPage: vars.startPage } : {}),
              ...(vars.endPage !== undefined ? { endPage: vars.endPage } : {}),
              ...azureBodyFields(vars.azure),
            }),
          })
        : await (async () => {
            const form = new FormData();
            form.append('file', vars.file, vars.file.name);
            if (vars.startPage !== undefined) form.append('startPage', String(vars.startPage));
            if (vars.endPage !== undefined) form.append('endPage', String(vars.endPage));
            azureFormFields(form, vars.azure);
            return fetch(`${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/map-pdf`, {
              method: 'POST',
              body: form,
            });
          })();
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `结构预览失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const p = (payload ?? {}) as Partial<MapPdfResult>;
      return {
        classification: p.classification ?? {
          pdfType: 'Unknown',
          pageCount: 0,
          pagesNeedingOcr: [],
          ocrUsed: false,
          selectedPages: [],
        },
        window: Array.isArray(p.window) ? p.window : [],
        headings: Array.isArray(p.headings) ? p.headings : [],
        tocEntries: Array.isArray(p.tocEntries) ? p.tocEntries : [],
      };
    },
    onError: (e) => {
      logger.debug('[useMapPdfMutation] map failed', e);
    },
  });
}

/** 批注一键转化为 FSRS 闪卡 */
export function useAnnotationToCardMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      annotationId: string;
      documentId: string;
      front: string;
      back: string;
      tag?: string;
      pos?: string;
      phonetic?: string;
    }) => {
      const res = await apiClient.api.annotations[':userId'][':annotationId']['to-card'].$post({
        param: { userId, annotationId: payload.annotationId },
        json: {
          front: payload.front,
          back: payload.back,
          tag: payload.tag || '课文批注',
          pos: payload.pos || '重点词句',
          phonetic: payload.phonetic,
        },
      });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('转为生词卡失败');
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS });
      queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.ANNOTATIONS, userId, variables.documentId],
      });
    },
  });
}

export type StructureHeading = {
  page: number;
  text: string;
  relSize?: number;
  bold?: boolean;
  centered?: boolean;
  standalone?: boolean;
  hasNumbering?: boolean;
  structRole?: string;
};
export type StructureClassKind = 'lesson' | 'section' | 'toc' | 'noise';
export interface StructureClassItem {
  text: string;
  page: number;
  kind: StructureClassKind;
  lessonNo: string | null;
  skillId: string | null;
}
export interface ClassifyStructureResult {
  classes: StructureClassItem[];
  dropped: number;
  model: string;
  allowedSkillIds: string[];
}
export interface SavedStructure {
  documentId: string;
  headings: StructureHeading[];
  classes: StructureClassItem[];
  model: string;
  effort: string;
  dropped: number;
  createdAt: string;
}

/**
 * 标题结构分类（mini 分流观测）：输入 map 阶段标题候选，瞬时返回判选（不落库）。
 * 模型与 effort 由导入页独立选择后显式传入；网关只透传。
 */
export function useClassifyStructureMutation() {
  return useMutation({
    mutationFn: async (vars: {
      headings: StructureHeading[];
      lang?: string;
      model?: string;
      effort?: string;
    }): Promise<ClassifyStructureResult> => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/structure/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new GatewayRequestError(readGatewayUserMessage(payload, `结构分类失败（HTTP ${res.status}）`), {
          code: readGatewayErrorCode(payload),
          details: readGatewayErrorDetails(payload),
        });
      }
      const p = (payload ?? {}) as Record<string, unknown>;
      const kinds = new Set(['lesson', 'section', 'toc', 'noise']);
      return {
        classes: (Array.isArray(p.classes) ? p.classes : [])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .filter((c) => typeof c.text === 'string' && kinds.has(c.kind as string))
          .map((c) => ({
            text: c.text as string,
            page: typeof c.page === 'number' ? c.page : 0,
            kind: c.kind as StructureClassKind,
            lessonNo: typeof c.lessonNo === 'string' ? c.lessonNo : null,
            skillId: typeof c.skillId === 'string' ? c.skillId : null,
          })),
        dropped: typeof p.dropped === 'number' ? p.dropped : 0,
        model: typeof p.model === 'string' ? p.model : '',
        allowedSkillIds: Array.isArray(p.allowedSkillIds)
          ? (p.allowedSkillIds as unknown[]).filter((s): s is string => typeof s === 'string')
          : [],
      };
    },
    onError: (e) => {
      logger.debug('[useClassifyStructureMutation] classify failed', e);
    },
  });
}

/** 保存已验分类（一文档一行；导入确认后调用）。 */
export function useSaveDocumentStructureMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      documentId: string;
      headings: StructureHeading[];
      classes: StructureClassItem[];
      model: string;
      effort: string;
      dropped: number;
    }): Promise<SavedStructure | null> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/structure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headings: vars.headings,
            classes: vars.classes,
            model: vars.model,
            effort: vars.effort,
            dropped: vars.dropped,
          }),
        }
      );
      if (!res.ok) return null;
      return (await res.json().catch(() => null)) as SavedStructure | null;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.TEXTBOOKS, userId, vars.documentId, 'structure'] });
    },
  });
}

/** 读回已存分类（无记录返回 null，不报错）。 */
export function useDocumentStructureQuery(documentId: string | undefined, userId = DEFAULT_USER_ID) {
  return useQuery<SavedStructure | null>({
    queryKey: [...QUERY_KEYS.TEXTBOOKS, userId, documentId ?? '', 'structure'],
    enabled: Boolean(documentId),
    queryFn: async () => {
      if (!documentId) return null;
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(documentId)}/structure`
      );
      if (!res.ok) return null;
      const payload: unknown = await res.json().catch(() => null);
      if (!payload || typeof payload !== 'object') return null;
      return payload as SavedStructure;
    },
    staleTime: 1000 * 60 * 5,
  });
}
