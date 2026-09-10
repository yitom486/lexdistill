import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { unlink } from 'node:fs/promises';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-05：扫描样例 HTTP 分段导入集成（与验收剧本同构）。
 * 样例只用仓库内 scanned-lesson-dialect.pdf（拷到临时绝对路径测 filePath 直读，测完删除）；
 * :memory: 库，真库零接触；native E2E 永不 skip。
 */
pinProcessToTestRuntime();
await ensurePdfTestRuntime();

const FIXTURE_URL = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);

const repos: DrizzleLearnerRepository[] = [];
const tempFiles: string[] = [];
afterEach(async () => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      /* 已删或从未落盘 */
    }
  }
});

function testApp(repo: DrizzleLearnerRepository) {
  return createApp({ repo, server: {} as never, port: 0 });
}

async function copyFixtureToTemp(): Promise<string> {
  const bytes = await Bun.file(FIXTURE_URL).arrayBuffer();
  expect(bytes.byteLength).toBeGreaterThan(0);
  const tmp = join(tmpdir(), `cmd05-scan-${process.pid}-${Date.now()}.pdf`);
  await Bun.write(tmp, new Uint8Array(bytes));
  expect(isAbsolute(tmp)).toBe(true);
  tempFiles.push(tmp);
  return tmp;
}

async function postJson(
  app: ReturnType<typeof testApp>,
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> };
}

describe('A. 临时 filePath 绝对路径可用；相对路径被拒绝', () => {
  it('绝对路径进 map-pdf；相对路径 4xx', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const tmp = await copyFixtureToTemp();
    const okRes = await postJson(app, '/api/documents/u1/map-pdf', { filePath: tmp });
    expect(okRes.status).toBe(200);
    const bad = await postJson(app, '/api/documents/u1/map-pdf', { filePath: 'relative/scan.pdf' });
    expect(bad.status).not.toBe(200);
    expect((bad.json.error as { code?: string } | undefined)?.code ?? (bad.json as { code?: string }).code).toBe(
      'E_INVALID_INPUT'
    );
  }, 180000);
});

describe('B. map-pdf 有标题候选', () => {
  it('pageCount=3，headings 非空可区分，ocrUsed 合理', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const tmp = await copyFixtureToTemp();
    const res = await postJson(app, '/api/documents/u1/map-pdf', { filePath: tmp });
    expect(res.status).toBe(200);
    const body = res.json as {
      classification: { pageCount: number; ocrUsed: boolean; pagesNeedingOcr: number[] };
      window: number[];
      headings: Array<{ page: number; text: string }>;
      tocEntries: unknown[];
    };
    expect(body.classification.pageCount).toBe(3);
    expect(Array.isArray(body.headings) && body.headings.length).toBeGreaterThan(0);
    expect(new Set(body.headings.map((h) => h.page)).size).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.tocEntries)).toBe(true);
    expect(body.classification.ocrUsed).toBe(true);
    expect(res.json).not.toHaveProperty('azurePages');
  }, 180000);
});

describe('C+D+E. 分段 import → 落库 → append', () => {
  it('仅第 1 页 import-pdf 恰好第1課；append 2-3 页后 3 课、id 不变、行序连续', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const tmp = await copyFixtureToTemp();

    // 仅第 1 页：恰好第1課（会話/練習A 不成课）
    const one = await postJson(app, '/api/documents/u1/import-pdf', {
      filePath: tmp,
      startPage: 1,
      endPage: 1,
    });
    expect(one.status).toBe(200);
    const book1 = (one.json.book ?? null) as { id: string; lessons: Array<{ id: string; title: string }> } | null;
    expect(book1?.lessons.map((l) => l.title)).toEqual(['第1課']);
    expect(one.json).not.toHaveProperty('azurePages');
    const firstLessonId = book1?.lessons[0]?.id;
    expect(typeof firstLessonId).toBe('string');

    // 落库：走 POST /api/documents/:userId 同一教材入口
    const saved = await postJson(app, '/api/documents/u1', {
      title: '扫描课',
      sourceKind: 'user_import',
      language: 'ja',
      content: 'c',
      astJson: book1,
    });
    expect(saved.status).toBe(200);
    const documentId = saved.json.id as string;
    expect(typeof documentId).toBe('string');

    // append 2-3 页：总数 3，标题集合对齐，旧课 id 不变
    const appended = await postJson(app, `/api/documents/u1/${documentId}/append-pdf`, {
      filePath: tmp,
      startPage: 2,
      endPage: 3,
    });
    expect(appended.status).toBe(200);
    expect((appended.json as { totalLessons?: number }).totalLessons).toBe(3);
    expect(appended.json).not.toHaveProperty('azurePages');

    const got = await app.request(`/api/documents/u1/${documentId}`);
    expect(got.status).toBe(200);
    const doc = (await got.json()) as { astJson: string };
    const ast = JSON.parse(doc.astJson) as { lessons: Array<{ id: string; title: string }> };
    expect(ast.lessons.map((l) => l.title)).toEqual(['第1課', '第2課', '復習A42']);
    expect(ast.lessons[0]?.id).toBe(firstLessonId);

    const rows = repo.getRawDb().query(
      'SELECT lesson_id AS id, sort_order AS s FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order'
    ).all(documentId) as Array<{ id: string; s: number }>;
    expect(rows.map((r) => r.s)).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(3);
  }, 180000);

  it('可选：import-pdf 带 CMD-01 classes，课集合不变', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const tmp = await copyFixtureToTemp();
    const res = await postJson(app, '/api/documents/u1/import-pdf', {
      filePath: tmp,
      startPage: 1,
      endPage: 1,
      classes: [
        { text: '第1課', page: 1, kind: 'lesson' },
        { text: '第2課', page: 2, kind: 'lesson' },
        { text: '復習A42', page: 3, kind: 'lesson' },
        { text: '練習A', page: 1, kind: 'noise' },
      ],
    });
    expect(res.status).toBe(200);
    const book = (res.json.book ?? null) as { lessons: Array<{ title: string }> } | null;
    expect(book?.lessons.map((l) => l.title)).toEqual(['第1課']);
  }, 180000);
});
