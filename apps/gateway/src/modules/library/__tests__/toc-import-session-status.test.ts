import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import type { PdfAstOutput } from '../application/pdf-import/pdf-import-service.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
} from '../application/pdf-import/toc-segment-preview.js';
import { prepareTocImport } from '../application/pdf-import/toc-import-prepare.js';
import { executeTocImportFirst } from '../application/pdf-import/toc-import-execute.js';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * CMD-LINGUA-P5D2D 会话只读摘要端点（:memory: 真库）。
 * 纯 DB 读：owner 隔离、零写、白名单字段、与执行结果一致。
 */

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-session-status');
}

const ENTRIES = [
  { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
  { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
];

const ANCHORS = [
  { printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const },
  { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed' as const },
];

function planFingerprint(): string {
  return fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: ENTRIES, anchors: ANCHORS });
}

function oneLessonBook(): TextbookAST {
  return {
    id: 'book-status-1',
    language: 'JA',
    title: '状态书',
    shortTitle: '状态书',
    level: 'N5',
    lessons: [
      {
        id: 'lesson-status-1',
        lessonNumber: 1,
        title: '第1課',
        vocabularies: [],
        grammarPoints: [],
        dialogues: [{ speaker: 'A', japanese: 'こんにちは', chinese: '你好' }],
        exercises: [],
      },
    ],
  };
}

function mockInspector(): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 100, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async () => ({ markdown: '', pages: [] }),
  };
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

async function preparedSessionId(repo: DrizzleLearnerRepository): Promise<string> {
  const prepared = await prepareTocImport(
    {
      loadInspector: async () => mockInspector(),
      prepareSession: (p) => repo.prepareTocImportSession(p),
    },
    { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: ENTRIES, anchors: ANCHORS, fingerprint: planFingerprint() }
  );
  if (!isOk(prepared)) throw new Error(`prepare failed: ${prepared.error.code}`);
  return prepared.value.session.id;
}

function tableCount(repo: DrizzleLearnerRepository, table: string): number {
  const row = repo.getRawDb().query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('P5D2D GET toc-import-sessions/:sessionId（:memory:）', () => {
  it('白名单字段；只读零写', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const sessionId = await preparedSessionId(repo);
    const sessionsBefore = tableCount(repo, 'toc_import_sessions');
    const chunksBefore = tableCount(repo, 'toc_import_chunks');
    const res = await app.request(`/api/documents/u1/toc-import-sessions/${sessionId}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['chunks', 'completedChunks', 'documentId', 'next', 'sessionId', 'status', 'totalChunks'].sort()
    );
    expect(body.sessionId).toBe(sessionId);
    expect(body.status).toBe('prepared');
    expect(body.documentId).toBeNull();
    expect(body.totalChunks).toBe(2);
    expect(body.completedChunks).toBe(0);
    const chunks = body.chunks as Array<Record<string, unknown>>;
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) {
      expect(Object.keys(chunk).sort()).toEqual(
        ['attempts', 'lessonIndex', 'lessonTitle', 'ordinal', 'range', 'status'].sort()
      );
    }
    const next = body.next as Record<string, unknown>;
    expect(next.ordinal).toBe(0);
    const dumped = JSON.stringify(body);
    for (const secret of ['fingerprint', 'pdfSha', 'requestKey', 'ast_json', 'folio', 'anchor']) {
      expect(dumped).not.toContain(secret);
    }
    // 只读：行数不变
    expect(tableCount(repo, 'toc_import_sessions')).toBe(sessionsBefore);
    expect(tableCount(repo, 'toc_import_chunks')).toBe(chunksBefore);
  });

  it('owner 隔离：他人/不存在 404 且零写', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const sessionId = await preparedSessionId(repo);
    const sessionsBefore = tableCount(repo, 'toc_import_sessions');
    const foreign = await app.request(`/api/documents/u2/toc-import-sessions/${sessionId}`, { method: 'GET' });
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as { error?: { code?: string } };
    expect(foreignBody.error?.code).toBe('E_NOT_FOUND');
    const ghost = await app.request('/api/documents/u1/toc-import-sessions/ghost', { method: 'GET' });
    expect(ghost.status).toBe(404);
    expect(tableCount(repo, 'toc_import_sessions')).toBe(sessionsBefore);
  });

  it('与 D2B 执行结果一致：running/绑定/completedChunks/next 后移', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const sessionId = await preparedSessionId(repo);
    const book = oneLessonBook();
    const executed = await executeTocImportFirst(
      {
        loadInspector: async () => mockInspector(),
        getSession: async (uid, sid) => {
          const found = await repo.getTocImportSessionById(sid);
          if (!found || found.session.userId !== uid) return undefined;
          return found;
        },
        getDocument: (id) => repo.getDocumentById(id),
        commitFirstChunk: (c) => repo.commitTocFirstChunk(c),
        recordChunkFailure: (f) => repo.recordTocChunkFailure(f),
        convertRange: async () => ({
          ok: true as const,
          value: {
            book,
            markdown: '',
            classification: { pdfType: 'TextBased', pageCount: 100, pagesNeedingOcr: [], ocrUsed: false, selectedPages: [] },
            stats: { lessons: 1, dialogues: 1 },
          } satisfies PdfAstOutput,
        }),
      },
      {
        userId: 'u1',
        sessionId,
        filename: 't.pdf',
        bytes: mockBytes(),
        entries: ENTRIES,
        anchors: ANCHORS,
        fingerprint: planFingerprint(),
      }
    );
    expect(isOk(executed)).toBe(true);
    if (!isOk(executed)) return;
    const res = await app.request(`/api/documents/u1/toc-import-sessions/${sessionId}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      documentId: string | null;
      completedChunks: number;
      next: { ordinal: number } | null;
      chunks: Array<{ ordinal: number; status: string }>;
    };
    expect(body.status).toBe('running');
    expect(body.documentId).toBe(executed.value.documentId);
    expect(body.completedChunks).toBe(1);
    expect(body.next?.ordinal).toBe(1);
    expect(body.chunks.find((c) => c.ordinal === 0)?.status).toBe('completed');
    expect(body.chunks.find((c) => c.ordinal === 1)?.status).toBe('prepared');
  });
});
