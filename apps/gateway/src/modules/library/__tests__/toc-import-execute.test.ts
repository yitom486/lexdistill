import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import type { PdfAstOutput } from '../application/pdf-import/pdf-import-service.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
} from '@study-studio/content';
import { executeTocImportFirst } from '../application/pdf-import/toc-import-execute.js';
import { prepareTocImport } from '../application/pdf-import/toc-import-prepare.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { runDoctor } from '@study-studio/storage-sqlite';

/**
 * CMD-LINGUA-P5D2B 首 chunk 执行（mock converter + :memory: 真库）。
 * 只执行 ordinal=0；第二个 chunk 永不执行（无执行路径）。
 * 真库只用 :memory:。
 */

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-import-execute');
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
    id: 'book-exec-1',
    language: 'JA',
    title: '执行书',
    shortTitle: '执行书',
    level: 'N5',
    lessons: [
      {
        id: 'lesson-exec-1',
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

function astOutput(book: TextbookAST): PdfAstOutput {
  return {
    book,
    markdown: '',
    classification: { pdfType: 'TextBased', pageCount: 100, pagesNeedingOcr: [], ocrUsed: false, selectedPages: [] },
    stats: { lessons: book.lessons.length, dialogues: 1 },
  };
}

interface ConvertCall {
  pages: number[];
}

function mockInspector(pageCount: number): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async () => ({ markdown: '', pages: [] }),
  };
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

interface Harness {
  repo: DrizzleLearnerRepository;
  sessionId: string;
  converted: ConvertCall[];
}

async function prepareHarness(): Promise<Harness> {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  const prepared = await prepareTocImport(
    {
      loadInspector: async () => mockInspector(100),
      prepareSession: (p) => repo.prepareTocImportSession(p),
    },
    { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: ENTRIES, anchors: ANCHORS, fingerprint: planFingerprint(), docTitle: '试书' }
  );
  if (!isOk(prepared)) throw new Error(`prepare failed: ${prepared.error.code}`);
  return { repo, sessionId: prepared.value.session.id, converted: [] };
}

function executeInput(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    sessionId,
    filename: 't.pdf',
    bytes: mockBytes(),
    entries: ENTRIES,
    anchors: ANCHORS,
    fingerprint: planFingerprint(),
    docTitle: '试书',
    ...extra,
  };
}

async function executeWith(
  h: Harness,
  convert: (vars: { pages: number[] }) => Promise<{ ok: true; value: PdfAstOutput }>,
  extra: Record<string, unknown> = {}
) {
  return executeTocImportFirst(
    {
      loadInspector: async () => mockInspector(100),
      getSession: async (uid, sid) => {
        const found = await h.repo.getTocImportSessionById(sid);
        if (!found || found.session.userId !== uid) return undefined;
        return found;
      },
      getDocument: (id) => h.repo.getDocumentById(id),
      commitFirstChunk: (c) => h.repo.commitTocFirstChunk(c),
      recordChunkFailure: (f) => h.repo.recordTocChunkFailure(f),
      convertRange: async (vars) => {
        h.converted.push({ pages: vars.pages });
        return convert(vars);
      },
    },
    executeInput(h.sessionId, extra)
  );
}

function countRows(repo: DrizzleLearnerRepository, table: string, where = ''): number {
  const row = repo
    .getRawDb()
    .query(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`)
    .get() as { n: number };
  return row.n;
}

async function documentCount(repo: DrizzleLearnerRepository, userId: string): Promise<number> {
  const res = await repo.listDocuments(userId);
  if (!isOk(res)) throw new Error('listDocuments failed');
  return res.value.length;
}

describe('P5D2B executeTocImportFirst（mock converter + :memory:）', () => {
  it('首次成功：恰一 document，绑定+completed+running，页窗精确，chunk 无持有', async () => {
    const h = await prepareHarness();
    const docsBefore = await documentCount(h.repo, 'u1');
    const res = await executeWith(h, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // converter 精确收到 verified range [17,34]
    expect(h.converted).toEqual([{ pages: Array.from({ length: 18 }, (_, i) => 17 + i) }]);
    expect(res.value.range).toEqual({ fromPage: 17, toPage: 34 });
    expect(res.value.lessonId).toBe('lesson-exec-1');
    expect(res.value.sessionId).toBe(h.sessionId);
    // 恰一个新 document
    expect(await documentCount(h.repo, 'u1')).toBe(docsBefore + 1);
    const session = await h.repo.getTocImportSessionById(h.sessionId);
    expect(session?.session.documentId).toBe(res.value.documentId);
    expect(session?.session.status).toBe('running');
    const first = session?.chunks.find((c) => c.ordinal === 0);
    expect(first?.status).toBe('completed');
    expect(first?.attempts).toBe(1);
    expect(first?.documentId).toBeUndefined();
    // 第二 chunk 纹丝不动（本轮不执行）
    const second = session?.chunks.find((c) => c.ordinal === 1);
    expect(second?.status).toBe('prepared');
    // AST / shred / FTS 一致
    const got = await h.repo.getDocumentById(res.value.documentId);
    expect(isOk(got) && got.value !== null).toBe(true);
    if (!isOk(got) || !got.value) return;
    const ast = JSON.parse(got.value.astJson ?? '{}') as { lessons?: unknown[] };
    expect(ast.lessons?.length).toBe(1);
    expect(countRows(h.repo, 'textbook_lessons', `document_id = '${res.value.documentId}'`)).toBe(1);
    expect(countRows(h.repo, 'textbook_lines', `document_id = '${res.value.documentId}'`)).toBeGreaterThan(0);
    expect(countRows(h.repo, 'textbook_fts', `document_id = '${res.value.documentId}'`)).toBeGreaterThan(0);
  });

  it('重复执行：同一 document，completed 后 converter/save 零调用', async () => {
    const h = await prepareHarness();
    const first = await executeWith(h, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }));
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const callsAfterFirst = h.converted.length;
    const docsAfterFirst = await documentCount(h.repo, 'u1');
    const second = await executeWith(h, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }));
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.documentId).toBe(first.value.documentId);
    expect(second.value.lessonId).toBe(first.value.lessonId);
    // 幂等快道：已完成即读档，不探页数（classify 不增）、不 convert、不 save
    expect(h.converted.length).toBe(callsAfterFirst);
    expect(await documentCount(h.repo, 'u1')).toBe(docsAfterFirst);
  });

  it('并发模拟：Promise.all 双调最终只有一个 document', async () => {
    const h = await prepareHarness();
    const docsBefore = await documentCount(h.repo, 'u1');
    const convert = async () => ({ ok: true as const, value: astOutput(oneLessonBook()) });
    const [a, b] = await Promise.all([executeWith(h, convert), executeWith(h, convert)]);
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value.documentId).toBe(b.value.documentId);
    expect(await documentCount(h.repo, 'u1')).toBe(docsBefore + 1);
  });

  it('回滚：stale/越权/坏会话/多 chunk/0 课/多课均零残留', async () => {
    // stale 指纹
    {
      const h = await prepareHarness();
      const before = await documentCount(h.repo, 'u1');
      const res = await executeWith(h, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }), {
        fingerprint: 'deadbeef',
      });
      expect(isOk(res)).toBe(false);
      if (isOk(res)) return;
      expect(res.error.code).toBe('E_TOC_PLAN_STALE');
      expect(await documentCount(h.repo, 'u1')).toBe(before);
    }
    // 越权 + 坏会话
    {
      const h = await prepareHarness();
      const before = await documentCount(h.repo, 'u1');
      const foreign = await executeTocImportFirst(
        {
          loadInspector: async () => mockInspector(100),
          getSession: async () => undefined,
          getDocument: (id) => h.repo.getDocumentById(id),
          commitFirstChunk: (c) => h.repo.commitTocFirstChunk(c),
          recordChunkFailure: (f) => h.repo.recordTocChunkFailure(f),
          convertRange: async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }),
        },
        executeInput(h.sessionId, { userId: 'u2' })
      );
      expect(isOk(foreign)).toBe(false);
      const ghost = await executeTocImportFirst(
        {
          loadInspector: async () => mockInspector(100),
          getSession: async () => undefined,
          getDocument: (id) => h.repo.getDocumentById(id),
          commitFirstChunk: (c) => h.repo.commitTocFirstChunk(c),
          recordChunkFailure: (f) => h.repo.recordTocChunkFailure(f),
          convertRange: async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }),
        },
        executeInput('ghost-session', {})
      );
      expect(isOk(ghost)).toBe(false);
      expect(await documentCount(h.repo, 'u1')).toBe(before);
    }
    // 多 chunk lesson（31 页拆两段）拒绝
    {
      const repo = new DrizzleLearnerRepository(':memory:');
      repos.push(repo);
      const longEntries = [
        { title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const },
        { title: '第2課', printedPage: 32, level: 1, kind: 'lesson' as const },
      ];
      const longAnchors = [
        { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' as const },
        { printedPage: 100, physicalPage: 100, evidence: 'human-confirmed' as const },
      ];
      const fp = fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: longEntries, anchors: longAnchors });
      const prepared = await prepareTocImport(
        {
          loadInspector: async () => mockInspector(100),
          prepareSession: (p) => repo.prepareTocImportSession(p),
        },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: longEntries, anchors: longAnchors, fingerprint: fp }
      );
      expect(isOk(prepared)).toBe(true);
      if (!isOk(prepared)) return;
      const before = await documentCount(repo, 'u1');
      let converted = 0;
      const res = await executeTocImportFirst(
        {
          loadInspector: async () => mockInspector(100),
          getSession: async (uid, sid) => {
            const found = await repo.getTocImportSessionById(sid);
            if (!found || found.session.userId !== uid) return undefined;
            return found;
          },
          getDocument: (id) => repo.getDocumentById(id),
          commitFirstChunk: (c) => repo.commitTocFirstChunk(c),
          recordChunkFailure: (f) => repo.recordTocChunkFailure(f),
          convertRange: async (vars) => {
            converted++;
            return { ok: true as const, value: astOutput(oneLessonBook()) };
          },
        },
        {
          userId: 'u1',
          sessionId: prepared.value.session.id,
          filename: 't.pdf',
          bytes: mockBytes(),
          entries: longEntries,
          anchors: longAnchors,
          fingerprint: fp,
        }
      );
      expect(isOk(res)).toBe(false);
      expect(converted).toBe(0);
      expect(await documentCount(repo, 'u1')).toBe(before);
    }
    // converter 0 课 / 多课：记失败计数，session 保持 prepared，零文档
    for (const lessons of [[], [oneLessonBook().lessons[0], oneLessonBook().lessons[0]]] as Array<TextbookAST['lessons']>) {
      const h = await prepareHarness();
      const before = await documentCount(h.repo, 'u1');
      const book = { ...oneLessonBook(), lessons: [...lessons] };
      const res = await executeWith(h, async () => ({ ok: true as const, value: astOutput(book as TextbookAST) }));
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_TOC_LESSON_SHAPE');
      expect(await documentCount(h.repo, 'u1')).toBe(before);
      const session = await h.repo.getTocImportSessionById(h.sessionId);
      expect(session?.session.status).toBe('prepared');
      expect(session?.session.documentId).toBeUndefined();
      expect(session?.chunks.find((c) => c.ordinal === 0)?.attempts).toBe(1);
    }
  });

  it('删除：成功后 deleteDocument 使 session 进 target_deleted，doctor 绿', async () => {
    const h = await prepareHarness();
    const res = await executeWith(h, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const deleted = await h.repo.deleteDocument(res.value.documentId, 'u1');
    expect(isOk(deleted)).toBe(true);
    const session = await h.repo.getTocImportSessionById(h.sessionId);
    expect(session?.session.status).toBe('target_deleted');
    expect(session?.session.documentId).toBe(res.value.documentId);
    const report = runDoctor(h.repo.getRawDb());
    expect(report.findings.filter((f) => f.rule.startsWith('toc-import:') && f.level === 'FAIL')).toEqual([]);
  });
});
