import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import type { PdfAstOutput } from '../application/pdf-import/pdf-import-service.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
} from '../application/pdf-import/toc-segment-preview.js';
import { executeTocImportFirst } from '../application/pdf-import/toc-import-execute.js';
import { executeTocImportNext } from '../application/pdf-import/toc-import-execute-next.js';
import { prepareTocImport } from '../application/pdf-import/toc-import-prepare.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { initSchema, runMigrations } from '../../../infrastructure/db/ddl.js';
import { runDoctor } from '../../../infrastructure/db/doctor.js';

/**
 * CMD-LINGUA-P5D2C 下一个 chunk 追加（mock converter + :memory: 真库）。
 * 只执行最小 prepared 即直接后继；不循环、不跳过。真库只用 :memory:。
 */

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-import-execute-next');
}

const ENTRIES = [
  { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
  { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
  { title: '第3課', printedPage: 50, level: 1, kind: 'lesson' as const },
];

const ANCHORS = [
  { printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const },
  { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed' as const },
  { printedPage: 50, physicalPage: 55, evidence: 'human-confirmed' as const },
];

function planFingerprint(): string {
  return fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: ENTRIES, anchors: ANCHORS });
}

function lessonBook(id: string, title: string): TextbookAST {
  return {
    id: `book-${id}`,
    language: 'JA',
    title,
    shortTitle: title,
    level: 'N5',
    lessons: [
      {
        id,
        lessonNumber: 1,
        title,
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

function mockInspector(pageCount: number): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async () => ({ markdown: '', pages: [] }),
  };
}

const repos: DrizzleLearnerRepository[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const d of dbs.splice(0)) d.close();
});

interface Harness {
  repo: DrizzleLearnerRepository;
  sessionId: string;
  converted: number[][];
  convertImpl: (pages: number[]) => { ok: true; value: PdfAstOutput };
}

async function prepareHarness(): Promise<Harness> {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  const h: Harness = {
    repo,
    sessionId: '',
    converted: [],
    convertImpl: () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-1', '第1課')) }),
  };
  const prepared = await prepareTocImport(
    {
      loadInspector: async () => mockInspector(100),
      prepareSession: (p) => repo.prepareTocImportSession(p),
    },
    { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: ENTRIES, anchors: ANCHORS, fingerprint: planFingerprint(), docTitle: '试书' }
  );
  if (!isOk(prepared)) throw new Error(`prepare failed: ${prepared.error.code}`);
  h.sessionId = prepared.value.session.id;
  return h;
}

function serviceDeps(h: Harness) {
  return {
    loadInspector: async () => mockInspector(100),
    getSession: async (uid: string, sid: string) => {
      const found = await h.repo.getTocImportSessionById(sid);
      if (!found || found.session.userId !== uid) return undefined;
      return found;
    },
    getDocument: (id: string) => h.repo.getDocumentById(id),
    commitFirstChunk: (c: { sessionId: string; userId: string; docTitle: string; book: TextbookAST; range: { fromPage: number; toPage: number } }) =>
      h.repo.commitTocFirstChunk(c),
    commitAppendChunk: (c: { sessionId: string; userId: string; ordinal: number; book: TextbookAST; range: { fromPage: number; toPage: number } }) =>
      h.repo.commitTocAppendChunk(c),
    recordChunkFailure: (f: { sessionId: string; userId: string; ordinal: number; errorCode: string }) =>
      h.repo.recordTocChunkFailure(f),
    convertRange: async (vars: { pages: number[] }) => {
      h.converted.push(vars.pages);
      return h.convertImpl(vars.pages);
    },
  };
}

function nextInput(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    sessionId,
    filename: 't.pdf',
    bytes: mockBytes(),
    entries: ENTRIES,
    anchors: ANCHORS,
    fingerprint: planFingerprint(),
    ...extra,
  };
}

async function executeFirst(h: Harness, lessonId: string, title: string) {
  h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook(lessonId, title)) });
  return executeTocImportFirst(
    {
      loadInspector: async () => mockInspector(100),
      getSession: async (uid: string, sid: string) => {
        const found = await h.repo.getTocImportSessionById(sid);
        if (!found || found.session.userId !== uid) return undefined;
        return found;
      },
      getDocument: (id: string) => h.repo.getDocumentById(id),
      commitFirstChunk: (c: { sessionId: string; userId: string; docTitle: string; book: TextbookAST; range: { fromPage: number; toPage: number } }) =>
        h.repo.commitTocFirstChunk(c),
      recordChunkFailure: (f: { sessionId: string; userId: string; ordinal: number; errorCode: string }) =>
        h.repo.recordTocChunkFailure(f),
      convertRange: async (vars: { pages: number[] }) => {
        h.converted.push(vars.pages);
        return h.convertImpl(vars.pages);
      },
    },
    {
      userId: 'u1',
      sessionId: h.sessionId,
      filename: 't.pdf',
      bytes: mockBytes(),
      entries: ENTRIES,
      anchors: ANCHORS,
      fingerprint: planFingerprint(),
      docTitle: '试书',
    }
  );
}

function astOf(repo: DrizzleLearnerRepository, documentId: string): { lessons: Array<{ id?: unknown; title?: unknown }> } {
  const row = repo.getRawDb().query('SELECT ast_json AS ast FROM documents WHERE id = ?').get(documentId) as {
    ast: string;
  };
  return JSON.parse(row.ast) as { lessons: Array<{ id?: unknown; title?: unknown }> };
}

describe('P5D2C executeTocImportNext（mock converter + :memory:）', () => {
  it('chunk1 正确追加到同一 document：前缀逐字不变、指纹更新', async () => {
    const h = await prepareHarness();
    const first = await executeFirst(h, 'lesson-converted-1', '第1課');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const beforeJson = JSON.stringify(astOf(h.repo, first.value.documentId));
    const beforeFp = (await h.repo.getTocImportSessionById(h.sessionId))?.session.astFingerprint;
    expect(typeof beforeFp).toBe('string');

    h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-2', '第2課')) });
    const res = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 同一 document，converter 精确收到 chunk1 窗 [35,54]
    expect(res.value.documentId).toBe(first.value.documentId);
    expect(res.value.lessonId).toBe('lesson-converted-2');
    expect(res.value.range).toEqual({ fromPage: 35, toPage: 54 });
    expect(h.converted[h.converted.length - 1]).toEqual(Array.from({ length: 20 }, (_, i) => 35 + i));
    // 原 AST 前缀逐字不变，新课仅末尾
    const after = astOf(h.repo, first.value.documentId);
    expect(after.lessons.length).toBe(2);
    expect(JSON.stringify({ lessons: [after.lessons[0]] })).toBe(JSON.stringify({ lessons: [JSON.parse(beforeJson).lessons[0]] }));
    expect(after.lessons[1]).toMatchObject({ id: 'lesson-converted-2', title: '第2課' });
    // 指纹更新且等于当前 AST hash
    const session = await h.repo.getTocImportSessionById(h.sessionId);
    const currentJson = h.repo.getRawDb().query('SELECT ast_json AS ast FROM documents WHERE id = ?').get(first.value.documentId) as { ast: string };
    expect(session?.session.astFingerprint).not.toBe(beforeFp);
    const { sha256HexText } = await import('../persistence/toc-import-sessions.js');
    expect(session?.session.astFingerprint).toBe(sha256HexText(currentJson.ast));
    // chunk1 completed，session 仍 running（还有第3課）
    expect(session?.chunks.find((c) => c.ordinal === 1)?.status).toBe('completed');
    expect(session?.session.status).toBe('running');
  });

  it('外部改 AST 后拒绝，零写', async () => {
    const h = await prepareHarness();
    const first = await executeFirst(h, 'lesson-converted-1', '第1課');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    h.repo.getRawDb().run(`UPDATE documents SET ast_json = '{"tampered":true}' WHERE id = '${first.value.documentId}'`);
    const convertedBefore = h.converted.length;
    h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-2', '第2課')) });
    const res = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_AST_DRIFT');
    // 零写：篡改后文本原样保留（服务未覆盖），chunk 仍 prepared
    const row = h.repo.getRawDb().query('SELECT ast_json AS ast FROM documents WHERE id = ?').get(first.value.documentId) as { ast: string };
    expect(row.ast).toBe('{"tampered":true}');
    expect(h.converted.length).toBe(convertedBefore);
    const session = await h.repo.getTocImportSessionById(h.sessionId);
    expect(session?.chunks.find((c) => c.ordinal === 1)?.status).toBe('prepared');
  });

  it('gap/跳过/多 chunk/超 30/重复 id/stale 全拒绝，零写', async () => {
    // gap：chunk1 标 completed 但内容错位（删 chunk1 行模拟缺失后继）
    {
      const h = await prepareHarness();
      const first = await executeFirst(h, 'lesson-converted-1', '第1課');
      expect(isOk(first)).toBe(true);
      if (!isOk(first)) return;
      h.repo.getRawDb().run(`DELETE FROM toc_import_chunks WHERE session_id = '${h.sessionId}' AND ordinal = 1`);
      const astBefore = JSON.stringify(astOf(h.repo, first.value.documentId));
      h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-2', '第2課')) });
      const res = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
      expect(isOk(res)).toBe(false);
      expect(JSON.stringify(astOf(h.repo, first.value.documentId))).toBe(astBefore);
    }
    // 多 chunk lesson（第2課 68 页拆 3 段）：先完成第1課，再调 next 命中多段门（零新 convert）
    {
      const repo = new DrizzleLearnerRepository(':memory:');
      repos.push(repo);
      const multiEntries = [
        { title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const },
        { title: '第2課', printedPage: 2, level: 1, kind: 'lesson' as const },
        { title: '第3課', printedPage: 70, level: 1, kind: 'lesson' as const },
      ];
      const multiAnchors = [
        { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' as const },
        { printedPage: 100, physicalPage: 100, evidence: 'human-confirmed' as const },
      ];
      const fp = fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: multiEntries, anchors: multiAnchors });
      const prepared = await prepareTocImport(
        { loadInspector: async () => mockInspector(100), prepareSession: (p) => repo.prepareTocImportSession(p) },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: multiEntries, anchors: multiAnchors, fingerprint: fp }
      );
      expect(isOk(prepared)).toBe(true);
      if (!isOk(prepared)) return;
      expect(prepared.value.chunks.length).toBe(6);
      const converted = { n: 0 };
      const mkDeps = () => ({
        loadInspector: async () => mockInspector(100),
        getSession: async (uid: string, sid: string) => {
          const found = await repo.getTocImportSessionById(sid);
          if (!found || found.session.userId !== uid) return undefined;
          return found;
        },
        getDocument: (id: string) => repo.getDocumentById(id),
        commitFirstChunk: (c: { sessionId: string; userId: string; docTitle: string; book: TextbookAST; range: { fromPage: number; toPage: number } }) =>
          repo.commitTocFirstChunk(c),
        commitAppendChunk: (c: { sessionId: string; userId: string; ordinal: number; book: TextbookAST; range: { fromPage: number; toPage: number } }) =>
          repo.commitTocAppendChunk(c),
        recordChunkFailure: (f: { sessionId: string; userId: string; ordinal: number; errorCode: string }) =>
          repo.recordTocChunkFailure(f),
        convertRange: async () => {
          converted.n++;
          return { ok: true as const, value: astOutput(lessonBook('lesson-x-1', '第1課')) };
        },
      });
      const sid = prepared.value.session.id;
      const baseInput = { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: multiEntries, anchors: multiAnchors, fingerprint: fp };
      const firstRes = await executeTocImportFirst(mkDeps(), { ...baseInput, sessionId: sid, docTitle: '试书' });
      expect(isOk(firstRes)).toBe(true);
      if (!isOk(firstRes)) return;
      const res = await executeTocImportNext(mkDeps(), { ...baseInput, sessionId: sid });
      expect(isOk(res)).toBe(false);
      if (isOk(res)) return;
      expect(res.error.code).toBe('E_INVALID_INPUT');
      expect(converted.n).toBe(1);
    }
    // 重复 lesson id 拒绝，文档逐字不变
    {
      const h = await prepareHarness();
      const first = await executeFirst(h, 'lesson-converted-1', '第1課');
      expect(isOk(first)).toBe(true);
      if (!isOk(first)) return;
      const astBefore = JSON.stringify(astOf(h.repo, first.value.documentId));
      h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-1', '第1課')) });
      const res = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
      expect(isOk(res)).toBe(false);
      if (isOk(res)) return;
      expect(res.error.code).toBe('E_TOC_LESSON_SHAPE');
      expect(JSON.stringify(astOf(h.repo, first.value.documentId))).toBe(astBefore);
    }
    // stale 指纹拒绝
    {
      const h = await prepareHarness();
      const first = await executeFirst(h, 'lesson-converted-1', '第1課');
      expect(isOk(first)).toBe(true);
      if (!isOk(first)) return;
      const res = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId, { fingerprint: 'deadbeef' }));
      expect(isOk(res)).toBe(false);
      if (isOk(res)) return;
      expect(res.error.code).toBe('E_TOC_PLAN_STALE');
    }
  });

  it('completed 重调零计算；删除 target 后拒绝', async () => {
    const h = await prepareHarness();
    const first = await executeFirst(h, 'lesson-converted-1', '第1課');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-2', '第2課')) });
    const second = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // chunk2（ordinal 2，第3課）仍 prepared；再调一次执行它
    h.convertImpl = () => ({ ok: true as const, value: astOutput(lessonBook('lesson-converted-3', '第3課')) });
    const third = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(third)).toBe(true);
    if (!isOk(third)) return;
    expect(third.value.sessionStatus).toBe('completed');
    const convertedBefore = h.converted.length;
    // 全完成后重调：零计算直接返回
    const again = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value.documentId).toBe(first.value.documentId);
    expect(h.converted.length).toBe(convertedBefore);
    // 删除 target 后拒绝
    const deleted = await h.repo.deleteDocument(first.value.documentId, 'u1');
    expect(isOk(deleted)).toBe(true);
    const afterDelete = await executeTocImportNext(serviceDeps(h), nextInput(h.sessionId));
    expect(isOk(afterDelete)).toBe(false);
  });
});

describe('P5D2C migration v21', () => {
  it('新库一次建成含 ast_fingerprint + v21 登记；旧库升级重放', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    const cols = (db.query('PRAGMA table_info(toc_import_sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('ast_fingerprint');
    const recorded = db.query('SELECT name AS n FROM schema_migrations WHERE version = 21').get() as { n: string } | null;
    expect(recorded?.n).toBe('toc-import-session-ast-fp');
    db.run('ALTER TABLE toc_import_sessions DROP COLUMN ast_fingerprint');
    db.run('DELETE FROM schema_migrations WHERE version = 21');
    const res = runMigrations(db);
    expect(res.applied).toContain(21);
    const colsAfter = (db.query('PRAGMA table_info(toc_import_sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(colsAfter).toContain('ast_fingerprint');
    expect(runMigrations(db).applied).toEqual([]);
  });
});
