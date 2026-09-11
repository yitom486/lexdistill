import { describe, expect, it, afterEach } from 'bun:test';
import {
  requestDiscoverToc,
  requestExecuteSessionChunk,
  requestExtractTocBaseline,
  requestFolioCandidates,
  requestImportTocLesson,
  requestPrepareSession,
  requestPreviewTocSegments,
  requestReviewToc,
  requestSessionStatus,
} from '../textbooks-annotations.js';

/**
 * CMD-LINGUA-P4C：三只读端点请求层（无私人 PDF、无真实网关）。
 * 全局 fetch 桩按 URL 路由回 canned 负载，并记录每次调用的方法/地址/体，
 * 验证请求次数、参数形态与错误 userMessage 透传。
 */

interface RecordedCall {
  url: string;
  method: string;
  contentType: string | null;
  jsonBody: Record<string, unknown> | null;
  formFields: Record<string, string> | null;
}

const calls: RecordedCall[] = [];
let nextResponse: { status: number; payload: unknown } = { status: 200, payload: {} };

const originalFetch = globalThis.fetch;

function installFetchStub(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    let jsonBody: Record<string, unknown> | null = null;
    let formFields: Record<string, string> | null = null;
    const body = init?.body;
    if (typeof body === 'string') {
      try {
        jsonBody = JSON.parse(body) as Record<string, unknown>;
      } catch {
        jsonBody = null;
      }
    } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
      formFields = {};
      for (const [key, value] of body.entries()) {
        formFields[key] = typeof value === 'string' ? value : (value as File).name;
      }
    }
    calls.push({ url, method, contentType: headers.get('content-type'), jsonBody, formFields });
    return new Response(JSON.stringify(nextResponse.payload), {
      status: nextResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
  nextResponse = { status: 200, payload: {} };
});

const DISCOVER_PAYLOAD = {
  status: 'found',
  candidates: [{ fromPage: 2, toPage: 4, score: 12 }],
  pageCount: 100,
  pagesScanned: [1, 2, 3],
  ocrPages: [1, 2],
  embedded: false,
};

const BASELINE_PAYLOAD = {
  status: 'ok',
  range: { fromPage: 2, toPage: 4 },
  pageCount: 100,
  entries: [{ title: '第1課', printedPage: 12, level: 1, source: 'text-fallback', kind: 'lesson' }],
  diagnostics: {
    pagesRequested: 3,
    pagesOcr: 3,
    linesConsidered: 10,
    linesDroppedWash: 1,
    entriesAccepted: 1,
    entriesRejected: 0,
  },
  embedded: false,
};

const REVIEW_PAYLOAD = {
  embedded: false,
  range: { fromPage: 2, toPage: 4 },
  pageCount: 100,
  baseline: BASELINE_PAYLOAD,
  draft: {
    entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' }],
    warnings: [],
  },
  diagnostics: { pagesRequested: 3, pagesRendered: 3, baselineEntries: 1, draftEntries: 1 },
};

describe('P4C 只读三专线请求层', () => {
  it('discover：filePath 走 JSON，一次请求到 discover-toc', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: DISCOVER_PAYLOAD };
    const res = await requestDiscoverToc('u1', { filePath: 'C:\\book\\a.pdf' });
    expect(res.status).toBe('found');
    expect(res.candidates).toEqual([{ fromPage: 2, toPage: 4, score: 12 }]);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/api/documents/u1/discover-toc');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.jsonBody).toMatchObject({ filePath: 'C:\\book\\a.pdf' });
    expect(calls[0]?.jsonBody).not.toHaveProperty('startPage');
  });

  it('extract/review：File 走 multipart，范围参数齐备', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: BASELINE_PAYLOAD };
    const file = new File(['%PDF-mock'], 'toc.pdf', { type: 'application/pdf' });
    const baseline = await requestExtractTocBaseline('u1', { file }, { startPage: 2, endPage: 4 });
    expect(baseline.entries.length).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/extract-toc');
    expect(calls[0]?.formFields).toMatchObject({ startPage: '2', endPage: '4' });
    expect(typeof calls[0]?.formFields?.file).toBe('string');

    nextResponse = { status: 200, payload: REVIEW_PAYLOAD };
    const review = await requestReviewToc('u1', { filePath: 'C:\\book\\a.pdf' }, { startPage: 2, endPage: 4 });
    expect(review.draft?.entries.length).toBe(1);
    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toContain('/review-toc');
    expect(calls[1]?.jsonBody).toMatchObject({ filePath: 'C:\\book\\a.pdf', startPage: 2, endPage: 4 });
  });

  it('后端错误：userMessage 原样透传，不抛原始栈', async () => {
    installFetchStub();
    nextResponse = {
      status: 400,
      payload: { success: false, error: { code: 'E_INVALID_INPUT', userMessage: '确认范围超出本书（本书共 100 页）', category: 'VALIDATION', retryable: false } },
    };
    const err = await requestExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, { startPage: 1, endPage: 2 }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err instanceof Error).toBe(true);
    expect((err as Error).message).toBe('确认范围超出本书（本书共 100 页）');
    expect((err as Error).message).not.toContain('HTTP 400');
  });

  it('畸形 200 负载：中性错误，不崩溃', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: { bogus: true } };
    const err = await requestDiscoverToc('u1', { filePath: 'C:\\x.pdf' }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err instanceof Error).toBe(true);
    expect((err as Error).message).toBe('识别目录返回异常，请稍后重试');
  });

  it('三专线零写：URL 永不含写端点', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: DISCOVER_PAYLOAD };
    await requestDiscoverToc('u1', { filePath: 'C:\\x.pdf' });
    nextResponse = { status: 200, payload: BASELINE_PAYLOAD };
    await requestExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, { startPage: 1, endPage: 2 });
    nextResponse = { status: 200, payload: REVIEW_PAYLOAD };
    await requestReviewToc('u1', { filePath: 'C:\\x.pdf' }, { startPage: 1, endPage: 2 });
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call.url).not.toContain('/import');
      expect(call.url).not.toContain('/append');
      expect(call.url).not.toContain('/save');
      expect(call.url).not.toContain('/structure');
    }
    const bodies = JSON.stringify(calls.map((c) => c.jsonBody));
    expect(bodies).not.toContain('base64');
    expect(bodies).not.toContain('data:image');
  });
});

const FOLIO_PAYLOAD = {
  pageCount: 100,
  pages: [
    {
      physicalPage: 26,
      candidates: [
        { raw: '18', normalized: { kind: 'arabic', value: 18 }, location: 'footer', source: 'native', confidence: 'medium' },
      ],
    },
  ],
  diagnostics: { pagesRequested: 1, nativePages: 1, ocrPages: 0, candidatesFound: 1 },
};

const PREVIEW_PAYLOAD = {
  pageCount: 100,
  lessons: [
    { lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: 30, status: 'mapped', reason: 'verified-interval', regionId: 'verified:5:12-30', offsetUsed: 5 },
  ],
  regions: [{ id: 'verified:5:12-30', offset: 5, printedFrom: 12, printedTo: 30, verified: true, anchorCount: 2 }],
  chunks: [{ lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 }],
  diagnostics: { lessonCount: 1, mappedCount: 1, unresolvedCount: 0, regionCount: 1, chunksPlanned: 1, lessonsWithoutEnd: 0 },
  fingerprint: 'fp-mutation-test',
};

describe('P5C folio/preview 请求层', () => {
  it('folio：pages 数组随请求发出，一次请求', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: FOLIO_PAYLOAD };
    const res = await requestFolioCandidates('u1', { filePath: 'C:\\book\\a.pdf' }, [26, 31]);
    expect(res.pages.length).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/folio-candidates');
    expect(calls[0]?.jsonBody).toMatchObject({ filePath: 'C:\\book\\a.pdf', pages: [26, 31] });
  });

  it('preview：entries + anchors 随请求发出', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: PREVIEW_PAYLOAD };
    const vars = {
      source: { filePath: 'C:\\book\\a.pdf' } as const,
      entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const }],
      anchors: [{ printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const }],
    };
    const res = await requestPreviewTocSegments('u1', vars);
    expect(res.lessons.length).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/preview-toc-segments');
    const sent = calls[0]?.jsonBody as { entries?: unknown[]; anchors?: unknown[] } | null;
    expect(sent?.entries?.length).toBe(1);
    expect(sent?.anchors).toEqual([{ printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' }]);
  });

  it('后端错误 userMessage 透传；畸形负载中性错误', async () => {
    installFetchStub();
    nextResponse = {
      status: 400,
      payload: { success: false, error: { code: 'E_INVALID_INPUT', userMessage: 'anchor 超出本书（本书共 100 页）', category: 'VALIDATION', retryable: false } },
    };
    const err = await requestPreviewTocSegments('u1', {
      source: { filePath: 'C:\\x.pdf' },
      entries: [],
      anchors: [],
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('anchor 超出本书（本书共 100 页）');

    nextResponse = { status: 200, payload: { bogus: 1 } };
    const malformed = await requestFolioCandidates('u1', { filePath: 'C:\\x.pdf' }, [1]).then(
      () => null,
      (e: unknown) => e
    );
    expect((malformed as Error).message).toBe('folio 候选返回异常，请稍后重试');
  });

  it('零写 URL：不含写端点', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: FOLIO_PAYLOAD };
    await requestFolioCandidates('u1', { filePath: 'C:\\x.pdf' }, [1]);
    nextResponse = { status: 200, payload: PREVIEW_PAYLOAD };
    await requestPreviewTocSegments('u1', { source: { filePath: 'C:\\x.pdf' }, entries: [], anchors: [] });
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.url).not.toContain('/import');
      expect(call.url).not.toContain('/append');
      expect(call.url).not.toContain('/save');
    }
  });
});

const IMPORT_PAYLOAD = {
  documentId: 'doc_abc',
  lessonId: 'l1',
  lessonTitle: '第1課',
  range: { fromPage: 17, toPage: 30 },
  pageCount: 100,
  stats: { lessons: 1, dialogues: 2, chunks: 1 },
};

describe('P5D1 import 请求层', () => {
  it('只发 entries/anchors/lessonIndex/fingerprint/docTitle，不发页范围', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: IMPORT_PAYLOAD };
    const res = await requestImportTocLesson('u1', {
      source: { filePath: 'C:\\book\\a.pdf' },
      entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
      anchors: [{ printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' }],
      lessonIndex: 0,
      fingerprint: 'fp-1',
      docTitle: '试导入课',
    });
    expect(res.documentId).toBe('doc_abc');
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/import-toc-lesson');
    expect(calls[0]?.url).not.toContain('/append');
    const sent = calls[0]?.jsonBody as Record<string, unknown>;
    expect(sent.lessonIndex).toBe(0);
    expect(sent.fingerprint).toBe('fp-1');
    expect(sent.docTitle).toBe('试导入课');
    expect(sent).not.toHaveProperty('pages');
    expect(sent).not.toHaveProperty('startPage');
    expect(sent).not.toHaveProperty('endPage');
  });

  it('后端错误 userMessage 透传', async () => {
    installFetchStub();
    nextResponse = {
      status: 400,
      payload: { success: false, error: { code: 'E_TOC_PLAN_STALE', userMessage: '分段预览已过期', category: 'VALIDATION', retryable: false } },
    };
    const err = await requestImportTocLesson('u1', {
      source: { filePath: 'C:\\x.pdf' },
      entries: [],
      anchors: [],
      lessonIndex: 0,
      fingerprint: 'stale',
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('分段预览已过期');
  });
});

const SESSION_STATUS_PAYLOAD = {
  sessionId: 's1',
  status: 'running',
  documentId: 'doc_1',
  totalChunks: 2,
  completedChunks: 1,
  chunks: [
    { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 }, status: 'completed', attempts: 1 },
    { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 }, status: 'prepared', attempts: 0 },
  ],
  next: { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 } },
};

describe('P5D2D session 请求层', () => {
  it('prepare：entries/anchors/fingerprint 发出，无页范围', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: { session: { id: 's1', status: 'prepared' }, chunks: [], reused: false, pageCount: 100 } };
    const res = await requestPrepareSession('u1', {
      source: { filePath: 'C:\\book\\a.pdf' },
      entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
      anchors: [{ printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' }],
      fingerprint: 'fp-1',
      docTitle: '试书',
    });
    expect(res.sessionId).toBe('s1');
    expect(res.reused).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/prepare-toc-import');
    const sent = calls[0]?.jsonBody as Record<string, unknown>;
    expect(sent.fingerprint).toBe('fp-1');
    expect(sent.docTitle).toBe('试书');
    expect(sent).not.toHaveProperty('pages');
    expect(sent).not.toHaveProperty('lessonIndex');
  });

  it('status：GET 无请求体', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: SESSION_STATUS_PAYLOAD };
    const res = await requestSessionStatus('u1', 's1');
    expect(res.next?.ordinal).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/toc-import-sessions/s1');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.jsonBody).toBeNull();
  });

  it('execute-first/next：按 first 选端点，entries 透传、无页范围', async () => {
    installFetchStub();
    const execPayload = {
      documentId: 'doc_1', lessonId: 'l1', lessonTitle: '第1課',
      range: { fromPage: 17, toPage: 30 }, pageCount: 100, stats: { lessons: 1, dialogues: 2, chunks: 1 },
    };
    const vars = {
      sessionId: 's1',
      source: { filePath: 'C:\\book\\a.pdf' } as const,
      entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const }],
      anchors: [{ printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const }],
      fingerprint: 'fp-1',
    };
    nextResponse = { status: 200, payload: execPayload };
    await requestExecuteSessionChunk('u1', vars, true);
    expect(calls[0]?.url).toContain('/execute-first');
    nextResponse = { status: 200, payload: execPayload };
    await requestExecuteSessionChunk('u1', vars, false);
    expect(calls[1]?.url).toContain('/execute-next');
    expect(calls.length).toBe(2);
    for (const call of calls) {
      const sent = call.jsonBody as Record<string, unknown>;
      expect(sent).not.toHaveProperty('pages');
      expect(sent).not.toHaveProperty('lessonIndex');
    }
  });

  it('错误 userMessage 透传', async () => {
    installFetchStub();
    nextResponse = {
      status: 400,
      payload: { success: false, error: { code: 'E_TOC_PLAN_STALE', userMessage: '分段预览已过期', category: 'VALIDATION', retryable: false } },
    };
    const err = await requestPrepareSession('u1', {
      source: { filePath: 'C:\\x.pdf' }, entries: [], anchors: [], fingerprint: 'stale',
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('分段预览已过期');
  });
});
