import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { isOk } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
} from '../application/pdf-import/toc-segment-preview.js';
import { prepareTocImport } from '../application/pdf-import/toc-import-prepare.js';
import {
  computeTocRequestKey,
  fingerprintTocChunk,
} from '../persistence/toc-import-sessions.js';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';
import { Database } from 'bun:sqlite';
import { initSchema, runMigrations } from '../../../infrastructure/db/ddl.js';

/**
 * CMD-LINGUA-P5D2A 整书导入 prepare（mock inspector + :memory: 真库）。
 * 只建 session/chunk 计划行：不建 documents，不调 converter/shred；
 * chunk 恒 prepared（执行归 D2B，本轮无执行路径）。
 */

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-import-prepare');
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

function mockInspector(pageCount: number, calls: { classify: number; ocr: number }): PdfInspectorLike {
  return {
    processPdf: () => {
      calls.classify++;
      return { pdfType: 'TextBased', pageCount, markdown: '', pagesNeedingOcr: [] };
    },
    processPdfWithOcr: async () => {
      calls.ocr++;
      return { markdown: '', pages: [] };
    },
  };
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function serviceInput(extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    filename: 't.pdf',
    bytes: mockBytes(),
    entries: ENTRIES,
    anchors: ANCHORS,
    fingerprint: planFingerprint(),
    docTitle: '试导入书',
    ...extra,
  };
}

function countRows(repo: DrizzleLearnerRepository, table: string): number {
  const row = repo.getRawDb().query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('P5D2A prepareTocImport（mock + :memory:）', () => {
  it('首次 prepare：一个 session + 完整 prepared chunks，不建 document', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const calls = { classify: 0, ocr: 0 };
    const docsBefore = countRows(repo, 'documents');
    const res = await prepareTocImport(
      {
        loadInspector: async () => mockInspector(100, calls),
        prepareSession: (prepared) => repo.prepareTocImportSession(prepared),
      },
      serviceInput()
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reused).toBe(false);
    expect(res.value.session.status).toBe('prepared');
    expect(res.value.session.lessonCount).toBe(2);
    expect(res.value.session.chunkCount).toBe(2);
    expect(res.value.session.docTitle).toBe('试导入书');
    expect(res.value.session.id.startsWith('tocimport_')).toBe(true);
    // 第1課 [17,34]、第2課 [35,35]，全部 prepared，ordinal 连续
    expect(res.value.chunks.map((c) => [c.ordinal, c.lessonIndex, c.physicalStart, c.physicalEnd, c.status])).toEqual([
      [0, 0, 17, 34, 'prepared'],
      [1, 1, 35, 35, 'prepared'],
    ]);
    for (const chunk of res.value.chunks) {
      expect(chunk.documentId).toBeUndefined();
      expect(chunk.attempts).toBe(0);
      // chunk 指纹可独立重算（D2B 执行前重验同一函数）
      expect(chunk.chunkFingerprint).toBe(
        fingerprintTocChunk({
          requestKey: res.value.session.requestKey,
          ordinal: chunk.ordinal,
          lessonIndex: chunk.lessonIndex,
          physicalStart: chunk.physicalStart,
          physicalEnd: chunk.physicalEnd,
        })
      );
    }
    expect(res.value.pageCount).toBe(100);
    // 只探针，无 OCR；零内容写（documents 行数不变，无 textbook 行）
    expect(calls.classify).toBe(1);
    expect(calls.ocr).toBe(0);
    expect(countRows(repo, 'documents')).toBe(docsBefore);
    expect(countRows(repo, 'textbook_lessons')).toBe(0);
  });

  it('相同请求重试：同 sessionId、零重复 chunk', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const deps = {
      loadInspector: async () => mockInspector(100, { classify: 0, ocr: 0 }),
      prepareSession: (prepared: Parameters<DrizzleLearnerRepository['prepareTocImportSession']>[0]) =>
        repo.prepareTocImportSession(prepared),
    };
    const first = await prepareTocImport(deps, serviceInput());
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const chunksBefore = countRows(repo, 'toc_import_chunks');
    const second = await prepareTocImport(deps, serviceInput());
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.reused).toBe(true);
    expect(second.value.session.id).toBe(first.value.session.id);
    expect(second.value.chunks).toEqual(first.value.chunks);
    expect(countRows(repo, 'toc_import_sessions')).toBe(1);
    expect(countRows(repo, 'toc_import_chunks')).toBe(chunksBefore);
  });

  it('并发模拟：已存在同 key 行直接复用，不抛不增', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const deps = {
      loadInspector: async () => mockInspector(100, { classify: 0, ocr: 0 }),
      prepareSession: (prepared: Parameters<DrizzleLearnerRepository['prepareTocImportSession']>[0]) =>
        repo.prepareTocImportSession(prepared),
    };
    // 模拟并发赢家已写入（同 key 同计划）
    const winner = await prepareTocImport(deps, serviceInput());
    expect(isOk(winner)).toBe(true);
    if (!isOk(winner)) return;
    const retry = await prepareTocImport(deps, serviceInput());
    expect(isOk(retry)).toBe(true);
    if (!isOk(retry)) return;
    expect(retry.value.reused).toBe(true);
    expect(retry.value.session.id).toBe(winner.value.session.id);
    // UNIQUE 约束本身存在：裸重插同 key 必失败（幂等底线在库里）
    const dup = await repo
      .getRawDb()
      .query('SELECT COUNT(*) AS n FROM sqlite_master WHERE type = ? AND name = ?')
      .get('index', 'idx_toc_import_sessions_user_key');
    expect((dup as { n: number }).n).toBe(1);
  });

  it('换 PDF / 换 anchor / 换 entries / 旧指纹：明确失败，零 session', async () => {
    const otherBytes = new TextEncoder().encode('%PDF-1.4 other-bytes');
    const otherAnchors = [{ printedPage: 12, physicalPage: 18, evidence: 'human-confirmed' as const }];
    const otherEntries = [{ title: '第1課改', printedPage: 12, level: 1, kind: 'lesson' as const }, ENTRIES[1]];
    const cases: Array<{ input: Record<string, unknown>; code: string }> = [
      { input: { bytes: otherBytes }, code: 'E_TOC_PLAN_STALE' },
      { input: { anchors: otherAnchors, fingerprint: planFingerprint() }, code: 'E_TOC_PLAN_STALE' },
      { input: { entries: otherEntries, fingerprint: planFingerprint() }, code: 'E_TOC_PLAN_STALE' },
      { input: { fingerprint: 'deadbeef' }, code: 'E_TOC_PLAN_STALE' },
      { input: { entries: 'nope', fingerprint: planFingerprint() }, code: 'E_INVALID_INPUT' },
    ];
    for (const item of cases) {
      const repo = new DrizzleLearnerRepository(':memory:');
      repos.push(repo);
      const res = await prepareTocImport(
        {
          loadInspector: async () => mockInspector(100, { classify: 0, ocr: 0 }),
          prepareSession: (prepared: Parameters<DrizzleLearnerRepository['prepareTocImportSession']>[0]) =>
            repo.prepareTocImportSession(prepared),
        },
        serviceInput(item.input)
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe(item.code);
      expect(countRows(repo, 'toc_import_sessions')).toBe(0);
      expect(countRows(repo, 'toc_import_chunks')).toBe(0);
    }
  });

  it('unresolved / 无 end / 空计划：零 session 零 chunk', async () => {
    const conflictEntries = [
      ...ENTRIES,
      { title: '第3課', printedPage: 35, level: 1, kind: 'lesson' as const },
    ];
    const conflictAnchors = [
      ...ANCHORS,
      { printedPage: 40, physicalPage: 40, evidence: 'human-confirmed' as const },
    ];
    const conflictFp = fingerprintTocPlan({
      pageCount: 100,
      pdfHashHex: sha256HexBytes(mockBytes()),
      entries: conflictEntries,
      anchors: conflictAnchors,
    });
    const singleFp = fingerprintTocPlan({
      pageCount: 100,
      pdfHashHex: sha256HexBytes(mockBytes()),
      entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const }],
      anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' as const }],
    });
    const cases: Array<Record<string, unknown>> = [
      { entries: conflictEntries, anchors: conflictAnchors, fingerprint: conflictFp },
      {
        entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const }],
        anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' as const }],
        fingerprint: singleFp,
      },
      { entries: [], anchors: [], fingerprint: 'x' },
    ];
    for (const item of cases) {
      const repo = new DrizzleLearnerRepository(':memory:');
      repos.push(repo);
      const res = await prepareTocImport(
        {
          loadInspector: async () => mockInspector(100, { classify: 0, ocr: 0 }),
          prepareSession: (prepared: Parameters<DrizzleLearnerRepository['prepareTocImportSession']>[0]) =>
            repo.prepareTocImportSession(prepared),
        },
        serviceInput(item)
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(countRows(repo, 'toc_import_sessions')).toBe(0);
      expect(countRows(repo, 'toc_import_chunks')).toBe(0);
    }
  });

  it('request_key 确定且隔离：同输入同 key，不同用户不同 session', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const deps = {
      loadInspector: async () => mockInspector(100, { classify: 0, ocr: 0 }),
      prepareSession: (prepared: Parameters<DrizzleLearnerRepository['prepareTocImportSession']>[0]) =>
        repo.prepareTocImportSession(prepared),
    };
    const mine = await prepareTocImport(deps, serviceInput());
    const other = await prepareTocImport(deps, serviceInput({ userId: 'u2' }));
    expect(isOk(mine) && isOk(other)).toBe(true);
    if (!isOk(mine) || !isOk(other)) return;
    expect(mine.value.session.requestKey).not.toBe(other.value.session.requestKey);
    expect(mine.value.session.id).not.toBe(other.value.session.id);
    expect(countRows(repo, 'toc_import_sessions')).toBe(2);
    // key 可独立重算
    expect(mine.value.session.requestKey).toBe(
      computeTocRequestKey({ userId: 'u1', pdfSha256: sha256HexBytes(mockBytes()), planFingerprint: planFingerprint() })
    );
  });
});

function buildPdf(objects: string[]): Uint8Array {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefAt = Buffer.byteLength(parts.join(''));
  const n = objects.length + 1;
  parts.push(`xref\n0 ${n}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i < n; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

function syntheticBlankPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

const tempFiles: string[] = [];
afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      /* 已删或从未落盘 */
    }
  }
});

describe('P5D2A POST prepare-toc-import（真探针 + 自造 PDF）', () => {
  it('有效输入 200 建 session；缺指纹 400；DB 无内容写', async () => {
    pinProcessToTestRuntime();
    await ensurePdfTestRuntime();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const tmp = join(tmpdir(), `p5d2a-prep-${process.pid}-${Date.now()}.pdf`);
    await Bun.write(tmp, syntheticBlankPdf());
    tempFiles.push(tmp);
    const docsBefore = countRows(repo, 'documents');
    const entries = [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' }];
    const anchors = [
      { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' },
      { printedPage: 2, physicalPage: 2, evidence: 'human-confirmed' },
    ];
    // 先取预览指纹（与 UI 同路径）
    const previewRes = await app.request('/api/documents/u1/preview-toc-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp, entries, anchors }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { fingerprint: string };
    expect(typeof preview.fingerprint).toBe('string');

    const okRes = await app.request('/api/documents/u1/prepare-toc-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp, entries, anchors, fingerprint: preview.fingerprint, docTitle: '试书' }),
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      reused: boolean;
      session: { id: string; status: string; chunkCount: number };
      chunks: Array<{ status: string; documentId: string | null }>;
    };
    expect(body.reused).toBe(false);
    expect(body.session.status).toBe('prepared');
    expect(body.chunks.length).toBe(body.session.chunkCount);
    for (const chunk of body.chunks) {
      expect(chunk.status).toBe('prepared');
      expect(chunk.documentId ?? null).toBeNull();
    }
    // 重试复用
    const retryRes = await app.request('/api/documents/u1/prepare-toc-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp, entries, anchors, fingerprint: preview.fingerprint }),
    });
    const retryBody = (await retryRes.json()) as { reused: boolean; session: { id: string } };
    expect(retryBody.reused).toBe(true);
    expect(retryBody.session.id).toBe(body.session.id);

    const missing = await app.request('/api/documents/u1/prepare-toc-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp, entries, anchors }),
    });
    expect(missing.status).not.toBe(200);

    expect(countRows(repo, 'documents')).toBe(docsBefore);
    expect(countRows(repo, 'textbook_lessons')).toBe(0);
  }, 300000);
});

describe('P5D2A migration v19（新库一次建成 + 旧库升级重放）', () => {
  it('initSchema 即含新表且登记 v19；删表删登记后重跑升级恢复且可重放', () => {
    const db = new Database(':memory:');
    try {
      initSchema(db);
      const recorded = db
        .query('SELECT name AS n FROM schema_migrations WHERE version = 19')
        .get() as { n: string } | null;
      expect(recorded?.n).toBe('toc-import-sessions');
      // 模拟旧库：删表 + 删登记 → 重跑升级
      db.run('DROP TABLE toc_import_chunks');
      db.run('DROP TABLE toc_import_sessions');
      db.run('DELETE FROM schema_migrations WHERE version = 19');
      const res = runMigrations(db);
      expect(res.applied).toContain(19);
      const tables = db
        .query("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'toc_import_%'")
        .all() as Array<{ n: string }>;
      expect(tables.map((t) => t.n).sort()).toEqual(['toc_import_chunks', 'toc_import_sessions']);
      // 升级后唯一约束生效
      db.run(
        `INSERT INTO toc_import_sessions (id, user_id, request_key, plan_fingerprint, pdf_sha256, page_count, lesson_count, chunk_count, status, created_at, updated_at) VALUES ('s1','u1','k','fp','pdf',10,1,1,'prepared','t','t')`
      );
      expect(() =>
        db.run(
          `INSERT INTO toc_import_sessions (id, user_id, request_key, plan_fingerprint, pdf_sha256, page_count, lesson_count, chunk_count, status, created_at, updated_at) VALUES ('s2','u1','k','fp','pdf',10,1,1,'prepared','t','t')`
        )
      ).toThrow();
      // 可重放：再跑无新应用
      expect(runMigrations(db).applied).toEqual([]);
    } finally {
      db.close();
    }
  });
});
