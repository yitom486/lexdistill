import { describe, expect, it, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { isOk } from '@study-studio/shared';
import { logger } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { createLibraryRoutes } from '../modules/library/http/library-routes.js';
import { summarizeReconciliation, reconcileLessons } from '../modules/library/lesson-reconciliation.js';

/**
 * P1-C0.8：ownership 边界 + authorized replacement shadow（只观察）。
 * - 未授权 private 读写 → E_NOT_FOUND，零 shadow、零写入；
 * - owner 覆盖：same-AST 无有意义 shadow；变化才有 shadow；incoming id 原样保存；
 * - shadow/日志故障不阻断保存；payload 无正文/token/用户 id；position 只读不动。
 */
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function testApp(repo: DrizzleLearnerRepository): Hono {
  return createLibraryRoutes({ repo, server: {} as never, port: 0 });
}

let lessonSeq = 0;
function L(id: string, title: string, lines: string[]): Record<string, unknown> {
  lessonSeq += 1;
  return {
    id, title,
    lessonNumber: lessonSeq,
    dialogues: lines.map((japanese, i) => ({ speaker: i % 2 === 0 ? 'A' : 'B', japanese, chinese: '' })),
    vocabularies: [], grammarPoints: [], exercises: [],
  };
}

const JA = ['はじめまして。わたしはアキです。', 'こちらこそよろしくおねがいします。'];
const JB = ['すみません、えきはどこですか。', 'あの信号を右に曲がると見えますよ。'];
const JC = ['この料理はとてもおいしいですね。', 'ええ、母の味がします。'];
const JR = ['復習しましょう。', 'もう一度言ってください。'];

function book(lessons: Record<string, unknown>[]): Record<string, unknown> {
  return { id: 'b1', language: 'JA', title: 'B', shortTitle: 'B', lessons };
}

async function postDoc(
  app: Hono, userId: string, body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(`/api/documents/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getDoc(app: Hono, userId: string, docId: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(`/api/documents/${userId}/${docId}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** 捕获 logger.info 的 shadow 事件（用完恢复）。 */
async function captureShadow<T>(fn: () => Promise<T>): Promise<{ result: T; events: unknown[] }> {
  const events: unknown[] = [];
  const orig = logger.info;
  logger.info = ((...args: unknown[]) => {
    if (args[0] === '[lesson-reconcile-shadow]') events.push(args[1]);
  }) as typeof logger.info;
  try {
    const result = await fn();
    return { result, events };
  } finally {
    logger.info = orig;
  }
}

function seedBook(): Record<string, unknown>[] {
  return [
    L('o1', '第1課', JA),
    L('o2', '第2課', JB),
    L('o3', '第3課', JC),
  ] as Record<string, unknown>[];
}

describe('ownership 边界（Task 0）', () => {
  it('陌生人读他人 private 文档 → E_NOT_FOUND（不泄露存在性）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'owner', { id: 'priv1', title: 'P', sourceKind: 'user_import', language: 'ja', content: 'c' });
    const got = await getDoc(app, 'stranger', 'priv1');
    expect(got.status).toBe(404);
    expect((got.json.error as { code: string }).code).toBe('E_NOT_FOUND');
    const own = await getDoc(app, 'owner', 'priv1');
    expect(own.status).toBe(200);
  });

  it('陌生人覆盖他人 private 文档 → E_NOT_FOUND 且零写入零 shadow', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'owner', { id: 'priv2', title: 'P', sourceKind: 'user_import', language: 'ja', content: 'c' });
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'stranger', { id: 'priv2', title: 'HACK', sourceKind: 'user_import', language: 'ja', content: 'x' })
    );
    expect(result.status).toBe(404);
    expect(events).toEqual([]);
    const back = await getDoc(app, 'owner', 'priv2');
    expect((back.json as { title: string }).title).toBe('P');
  });

  it('公共种子对陌生人可读、不可覆盖', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'seed-user', { id: 'seed1', title: 'S', sourceKind: 'curriculum_textbook', language: 'ja', content: 'c' });
    const got = await getDoc(app, 'stranger', 'seed1');
    expect(got.status).toBe(200);
    const over = await postDoc(app, 'stranger', { id: 'seed1', title: 'HACK', sourceKind: 'curriculum_textbook', language: 'ja', content: 'x' });
    expect(over.status).toBe(404);
    const back = await getDoc(app, 'seed-user', 'seed1');
    expect((back.json as { title: string }).title).toBe('S');
  });
});

describe('authorized replacement shadow（只观察）', () => {
  it('owner 同 AST 覆盖：保存语义不变，无有意义 shadow', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const body = { id: 'doc-same', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) };
    expect((await postDoc(app, 'u1', body)).status).toBe(200);
    const { result, events } = await captureShadow(() => postDoc(app, 'u1', body));
    expect(result.status).toBe(200);
    expect(events).toEqual([]);
    const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get('doc-same') as { n: number };
    expect(n.n).toBe(3);
  });

  it('Insert：AUTO A/B/C + ADDED Review；incoming id 原样保存（不继承旧 id）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'u1', { id: 'doc-ins', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) });
    const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'u1', { id: 'doc-ins', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(next)) })
    );
    expect(result.status).toBe(200);
    expect(events).toHaveLength(1);
    const ev = events[0] as Record<string, unknown>;
    expect(ev).toMatchObject({ event: 'lesson-reconcile-shadow', documentId: 'doc-ins', oldLessonCount: 3, newLessonCount: 4, auto: 3 });
    expect((ev.autoPairs as Array<{ oldLessonId: string }>).map((p) => p.oldLessonId)).toEqual(['o1', 'o2', 'o3']);
    // 保存的是 incoming 原样：新课仍是 provisional id，未被改写成旧 id
    const got = await repo.getDocumentById('doc-ins');
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) return;
    const saved = JSON.parse(got.value?.astJson as string) as { lessons: Array<{ id: string }> };
    expect(saved.lessons.map((l) => l.id)).toEqual(['n1', 'nR', 'n2', 'n3']);
    // payload 无正文/token/用户 id
    const blob = JSON.stringify(ev);
    expect(blob).not.toContain('はじめまして');
    expect(blob).not.toContain('第1課');
    expect(blob).not.toContain('u1');
  });

  it('Delete：REMOVED 摘要正确且不阻断保存', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const withReview = [...seedBook().slice(0, 1), L('oR', '復習A', JR), ...seedBook().slice(1)] as Record<string, unknown>[];
    await postDoc(app, 'u1', { id: 'doc-del', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(withReview)) });
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'u1', { id: 'doc-del', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) })
    );
    expect(result.status).toBe(200);
    expect(events).toHaveLength(1);
    const ev = events[0] as Record<string, unknown>;
    expect(ev).toMatchObject({ auto: 3, removed: 1 });
  });

  it('position 指向 REMOVED 旧 id：risk>0 且 position 原样不动', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const withReview = [...seedBook().slice(0, 1), L('oR', '復習A', JR), ...seedBook().slice(1)] as Record<string, unknown>[];
    await postDoc(app, 'u1', { id: 'doc-risk', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(withReview)) });
    expect(isOk(await repo.saveReadingPosition('u1', 'doc-risk', { lessonId: 'oR' }))).toBe(true);
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'u1', { id: 'doc-risk', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) })
    );
    expect(result.status).toBe(200);
    const ev = events[0] as Record<string, unknown>;
    expect(ev.durableRefAtRiskCount).toBe(1);
    expect(ev.riskyOldLessonIds).toEqual(['oR']);
    const pos = await repo.getReadingPosition('u1', 'doc-risk');
    expect(isOk(pos)).toBe(true);
    if (!isOk(pos)) return;
    expect(pos.value?.locator).toEqual({ lessonId: 'oR' });
  });

  it('新 document 与 questions 不触发 shadow', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const { events: e1 } = await captureShadow(() =>
      postDoc(app, 'u1', { id: 'doc-new', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) })
    );
    expect(e1).toEqual([]);
    const { events: e2 } = await captureShadow(() =>
      postDoc(app, 'u1', { id: 'doc-q', title: 'Q', sourceKind: 'news', language: 'ja', content: 'c', astJson: JSON.stringify({ id: 'r', questions: [] }) })
    );
    expect(e2).toEqual([]);
  });

  it('logger 故障时合法保存仍成功（shadow 被隔离）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'u1', { id: 'doc-fault', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(seedBook())) });
    const origInfo = logger.info;
    const origWarn = logger.warn;
    logger.info = (() => { throw new Error('log down'); }) as typeof logger.info;
    let warned = 0;
    logger.warn = ((..._a: unknown[]) => { warned++; }) as typeof logger.warn;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const res = await postDoc(app, 'u1', { id: 'doc-fault', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(next)) });
      expect(res.status).toBe(200);
      expect(warned).toBeGreaterThan(0);
      const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get('doc-fault') as { n: number };
      expect(n.n).toBe(4);
    } finally {
      logger.info = origInfo;
      logger.warn = origWarn;
    }
  });
});

describe('summarizeReconciliation（纯函数）', () => {
  it('计数映射 + sim 取整 + 无禁用字段', () => {
    const old = [L('o1', '第1課', JA), L('o2', '第2課', JB)];
    const cur = [L('n1', '第1課', JA), L('n2', '第2課', JB)];
    const r = reconcileLessons(
      old.map((l) => ({ id: l.id as string, title: l.title as string, dialogues: (l.dialogues as Array<{ speaker: string; japanese: string }>), vocabularies: [] })),
      cur.map((l) => ({ id: l.id as string, title: l.title as string, dialogues: (l.dialogues as Array<{ speaker: string; japanese: string }>), vocabularies: [] }))
    );
    const s = summarizeReconciliation('doc-x', r, ['o9']);
    expect(s).toMatchObject({ event: 'lesson-reconcile-shadow', documentId: 'doc-x', oldLessonCount: 2, newLessonCount: 2, auto: 2, durableRefAtRiskCount: 1 });
    expect(s.riskyOldLessonIds).toEqual(['o9']);
    expect(s.autoPairs[0]).toEqual({ oldLessonId: 'o1', newIndex: 0, exactFp: true, tokenMatch: true, sim: 1 });
    const blob = JSON.stringify(s);
    expect(blob).not.toContain('はじめまして');
    expect(blob).not.toContain('第1課');
  });
});
