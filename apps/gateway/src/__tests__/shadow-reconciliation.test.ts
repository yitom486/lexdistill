import { describe, expect, it, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { isOk, getLogLevel } from '@study-studio/shared';
import { logger } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import {
  createLibraryRoutes,
  shadowReconcile,
  SHADOW_OBSERVE_CONSTANTS,
} from '../modules/library/http/library-routes.js';
import { summarizeReconciliation, reconcileLessons } from '@study-studio/storage-sqlite';
import { markdownToAst } from '@study-studio/content';
import { appendPdfToDocument } from '../modules/library/application/pdf-import/pdf-import-service.js';
import type { TextbookAST } from '@study-studio/document-model';

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

/** 捕获 shadow 事件负载：兼容 info/warn 两种投递（P1-C0.8a 重构了投递通道）。
 * 断言只认负载内容（event === 'lesson-reconcile-shadow'），不认通道/文案。 */
interface Captured {
  result: { status: number; json: Record<string, unknown> };
  events: Array<Record<string, unknown>>;
}
async function captureShadow(
  fn: () => Promise<{ status: number; json: Record<string, unknown> }>
): Promise<Captured> {
  const events: Array<Record<string, unknown>> = [];
  const sniff = (args: unknown[]): void => {
    for (const a of args) {
      if (a && typeof a === 'object' && (a as Record<string, unknown>).event === 'lesson-reconcile-shadow') {
        events.push(a as Record<string, unknown>);
      }
    }
  };
  const origInfo = logger.info;
  const origWarn = logger.warn;
  logger.info = ((...args: unknown[]) => { sniff(args); }) as typeof logger.info;
  logger.warn = ((...args: unknown[]) => { sniff(args); }) as typeof logger.warn;
  try {
    const result = await fn();
    return { result, events };
  } finally {
    logger.info = origInfo;
    logger.warn = origWarn;
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
    // 让 shadow 投递通道抛错（新旧两版实现分别走 info/warn，此处全堵）：
    // 合法保存必须不受影响，异常不得外泄。
    const origInfo = logger.info;
    const origWarn = logger.warn;
    logger.info = (() => { throw new Error('log down'); }) as typeof logger.info;
    logger.warn = (() => { throw new Error('log down'); }) as typeof logger.warn;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const res = await postDoc(app, 'u1', { id: 'doc-fault', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c', astJson: JSON.stringify(book(next)) });
      expect(res.status).toBe(200);
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

/**
 * P1-C0.8a：默认运行时 shadow evidence 可见性（只改可观测性，不改 matcher/identity/DB/API）。
 * 触发条件（与实现注释一致）：已存在 + 已授权 + 新旧均为合法教材 AST +
 * 整体 replacement（POST /api/documents/:userId 教材形）+ lesson id/title 序列变化。
 * 非触发：同 AST、新文档、questions 非教材形、enrich 原位修改（id/title 不变）、
 * append 专用路径（接力追加，不走 replacement 观察）。
 */
describe('P1-C0.8a 默认运行时可见性（warn 通道）', () => {
  it('默认 level=warn；真实 replacement 恰好一条 console.warn 可见，同 AST 零输出', async () => {
    expect(getLogLevel()).toBe('warn');
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const docId = 'doc-visible';
    await postDoc(app, 'u1', {
      id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    const origWarn = console.warn;
    const origInfo = console.info;
    const warnCalls: unknown[][] = [];
    const infoCalls: unknown[][] = [];
    console.warn = ((...args: unknown[]) => { warnCalls.push(args); }) as typeof console.warn;
    console.info = ((...args: unknown[]) => { infoCalls.push(args); }) as typeof console.info;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const res = await postDoc(app, 'u1', {
        id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
        astJson: JSON.stringify(book(next)),
      });
      expect(res.status).toBe(200);
      const shadowWarns = warnCalls.filter(
        (a) => typeof a[0] === 'string' && (a[0] as string).startsWith('[lesson-reconcile-shadow]')
      );
      expect(shadowWarns).toHaveLength(1);
      const payload = shadowWarns[0]?.[1] as Record<string, unknown>;
      expect(payload).toMatchObject({ event: 'lesson-reconcile-shadow', documentId: docId });
      // 前缀即人工审阅声明（shadow only，非用户错误）；info 通道无 shadow（默认静默）。
      expect(String(shadowWarns[0]?.[0])).toContain('needs human review');
      expect(String(shadowWarns[0]?.[0])).toContain('shadow only');
      const shadowInfos = infoCalls.filter(
        (a) => typeof a[0] === 'string' && (a[0] as string).includes('lesson-reconcile-shadow')
      );
      expect(shadowInfos).toEqual([]);
      // 同 AST 再覆盖：零输出（gate：序列无变化直接跳过）。
      warnCalls.length = 0;
      const res2 = await postDoc(app, 'u1', {
        id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
        astJson: JSON.stringify(book(next)),
      });
      expect(res2.status).toBe(200);
      const shadowWarns2 = warnCalls.filter(
        (a) => typeof a[0] === 'string' && (a[0] as string).startsWith('[lesson-reconcile-shadow]')
      );
      expect(shadowWarns2).toEqual([]);
    } finally {
      console.warn = origWarn;
      console.info = origInfo;
    }
  });

  it('observation 经 warn 投递且文案含审阅声明（非用户可见错误）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'u1', {
      id: 'doc-observe-msg', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    const raws: Array<{ msg: unknown; payload: unknown }> = [];
    const origWarn = logger.warn;
    logger.warn = ((...args: unknown[]) => {
      if (typeof args[0] === 'string' && (args[0] as string).startsWith('[lesson-reconcile-shadow]')) {
        raws.push({ msg: args[0], payload: args[1] });
      }
    }) as typeof logger.warn;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const res = await postDoc(app, 'u1', {
        id: 'doc-observe-msg', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
        astJson: JSON.stringify(book(next)),
      });
      expect(res.status).toBe(200);
      expect(raws).toHaveLength(1);
      expect(String(raws[0]?.msg)).toBe(SHADOW_OBSERVE_CONSTANTS.observeMsg);
      expect(String(raws[0]?.msg)).toContain('needs human review');
      expect((raws[0]?.payload as Record<string, unknown>).event).toBe('lesson-reconcile-shadow');
    } finally {
      logger.warn = origWarn;
    }
  });
});

describe('P1-C0.8a 负向：append / enrich 不输出 shadow', () => {
  it('enrich 原位修改（id/title 序列不变，仅正文变化）不输出', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'u1', {
      id: 'doc-enrich', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    // 同 id/title，仅第 1 课正文换成 JR（enrich 语义：原位改内容，不换身份）。
    const enriched = [L('o1', '第1課', JR), L('o2', '第2課', JB), L('o3', '第3課', JC)];
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'u1', {
        id: 'doc-enrich', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
        astJson: JSON.stringify(book(enriched)),
      })
    );
    expect(result.status).toBe(200);
    expect(events).toEqual([]);
  });

  it('append 专用路径（接力追加，不走 replacement）不输出 shadow 且旧 id 全保留', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const base = markdownToAst(
      ['# 第1課', 'A：はじめまして。', '# 第2課', 'B：さようなら。'].join('\n'),
      { bookId: 'doc-append' }
    );
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const baseDoc = {
      id: 'doc-append',
      userId: 'u1',
      title: 'Base',
      sourceKind: 'user_import' as const,
      language: 'ja',
      content: 'Base',
      astJson: JSON.stringify(base.value),
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    expect(isOk(await repo.saveDocument(baseDoc))).toBe(true);
    expect(isOk(await repo.shredDocument('doc-append', base.value))).toBe(true);
    const stubInspector = async () => ({
      processPdf: () => ({
        pdfType: 'TextBased',
        pageCount: 1,
        markdown: ['# 第3課', 'C：ありがとう。'].join('\n'),
        pagesNeedingOcr: [] as number[],
        confidence: 0.9,
      }),
      processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [] as number[], pagesRecommendingHosted: [] as number[] }),
    });
    const { result, events } = await captureShadow(async () => {
      const appended = await appendPdfToDocument(
        {
          saveDocument: (doc) => repo.saveDocument(doc),
          saveCanonicalAst: (docBase, bk) => repo.saveCanonicalAst(docBase, bk),
          getDocument: (id) => repo.getDocumentById(id),
          projectLinesSegments: (userId, documentId) =>
            repo.projectLinesSegments(userId, documentId),
          loadInspector: stubInspector,
        },
        {
          userId: 'u1',
          filename: 'part2.pdf',
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
          documentId: 'doc-append',
        }
      );
      expect(isOk(appended)).toBe(true);
      return { status: 200, json: {} };
    });
    expect(result.status).toBe(200);
    expect(events).toEqual([]);
    const got = await repo.getDocumentById('doc-append');
    expect(isOk(got)).toBe(true);
    if (!isOk(got) || !got.value?.astJson) return;
    const stored = JSON.parse(got.value.astJson as string) as { lessons: Array<{ id: string }> };
    expect(stored.lessons).toHaveLength(3);
    expect(stored.lessons[0]?.id).toBe('doc-append-l1');
    expect(stored.lessons[1]?.id).toBe('doc-append-l2');
  });
});

describe('P1-C0.8a fail-open 与载荷安全', () => {
  it('evaluator 异常 fail-open：固定分类、无原始 message/stack/正文，shadow 不抛', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const docId = 'doc-eval-fault';
    await postDoc(testApp(repo), 'u1', {
      id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    const got = await repo.getDocumentById(docId);
    expect(isOk(got)).toBe(true);
    if (!isOk(got) || !got.value?.astJson) return;
    const oldAstJson = got.value.astJson as string;
    // 构造 incoming：id/title 序列变化（确保过 gate），但 dialogues getter 抛错（含正文 marker）。
    const marker = 'EVAL_FAIL_MARKER_はじめまして_第1課_secret-token-xyz';
    const goodLesson = (L('n1', '第9課', JA) as unknown as Record<string, unknown>);
    const badLessonBase = L('n2', '第8課', JB) as unknown as Record<string, unknown>;
    const badLesson = { ...badLessonBase };
    Object.defineProperty(badLesson, 'dialogues', {
      enumerable: true,
      configurable: true,
      get(): unknown {
        throw new Error(marker);
      },
    });
    const incoming = {
      id: 'b1', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [goodLesson, badLesson],
    } as unknown as TextbookAST;
    const faults: unknown[] = [];
    const faultMsgs: unknown[] = [];
    const origWarn = logger.warn;
    logger.warn = ((...args: unknown[]) => {
      if (typeof args[0] === 'string' && (args[0] as string).startsWith('[lesson-reconcile-shadow]')) {
        faultMsgs.push(args[0]);
        faults.push(args[1]);
      }
    }) as typeof logger.warn;
    try {
      await shadowReconcile(
        { repo, server: {} as never, port: 0 },
        docId,
        oldAstJson,
        incoming
      );
    } finally {
      logger.warn = origWarn;
    }
    expect(faults).toHaveLength(1);
    const fault = faults[0] as Record<string, unknown>;
    expect(fault).toEqual({
      event: SHADOW_OBSERVE_CONSTANTS.faultEvent,
      documentId: docId,
      code: SHADOW_OBSERVE_CONSTANTS.faultCode,
    });
    expect(String(faultMsgs[0])).toBe(SHADOW_OBSERVE_CONSTANTS.faultMsg);
    const blob = JSON.stringify({ fault, msg: faultMsgs[0] });
    expect(blob).not.toContain(marker);
    expect(blob).not.toContain('はじめまして');
    expect(blob).not.toContain('第1課');
    expect(blob).not.toContain('secret-token-xyz');
    expect(blob).not.toContain('stack');
    // 主保存不受影响：用合法 replacement 再 POST 仍成功且有正常 observation。
    const app = testApp(repo);
    const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const { result, events } = await captureShadow(() =>
      postDoc(app, 'u1', {
        id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
        astJson: JSON.stringify(book(next)),
      })
    );
    expect(result.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it('risk 读取异常不阻断保存：observation 照常（risk 计 0）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    await postDoc(app, 'u1', {
      id: 'doc-risk-fault', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    const orig = repo.listDocumentLessonRefs.bind(repo);
    repo.listDocumentLessonRefs = (async () => {
      throw new Error('refs down はじめまして');
    }) as typeof repo.listDocumentLessonRefs;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const { result, events } = await captureShadow(() =>
        postDoc(app, 'u1', {
          id: 'doc-risk-fault', title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
          astJson: JSON.stringify(book(next)),
        })
      );
      expect(result.status).toBe(200);
      expect(events).toHaveLength(1);
      const ev = events[0] as Record<string, unknown>;
      expect(ev.durableRefAtRiskCount).toBe(0);
      expect(JSON.stringify(ev)).not.toContain('はじめまして');
    } finally {
      repo.listDocumentLessonRefs = orig;
    }
  });

  it('observation 载荷仅含安全字段：键白名单 + 无正文/title/token/sourceRef/userId/locator', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const userId = 'u1-sensitive-check';
    const docId = 'doc-safe';
    // 生词面 distinctive：若泄漏，blob 必含；sourceRef/locator 疑似字段亦不得出现。
    const vocabSurface = '勉強特別語彙';
    const baseLessons = seedBook().map((l) => {
      if ((l.id as string) === 'o1') {
        return {
          ...(l as Record<string, unknown>),
          vocabularies: [
            { id: 'o1-v0', kanji: vocabSurface, kana: 'べんきょう', chinese: '学习', pos: '名词', pitchAccent: '⓪' },
          ],
        };
      }
      return l;
    });
    await postDoc(app, userId, {
      id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c-content-marker',
      astJson: JSON.stringify(book(baseLessons)),
    });
    expect(isOk(await repo.saveReadingPosition(userId, docId, { lessonId: 'o1', offset: 3 }))).toBe(true);
    const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const { result, events } = await captureShadow(() =>
      postDoc(app, userId, {
        id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c-content-marker',
        astJson: JSON.stringify(book(next)),
      })
    );
    expect(result.status).toBe(200);
    expect(events).toHaveLength(1);
    const ev = events[0] as Record<string, unknown>;
    expect(Object.keys(ev).sort()).toEqual(
      [
        'absorb', 'added', 'ambiguous', 'auto', 'autoPairs', 'documentId',
        'durableRefAtRiskCount', 'event', 'merge', 'newLessonCount',
        'oldLessonCount', 'removed', 'riskyOldLessonIds', 'split',
      ].sort()
    );
    for (const p of (ev.autoPairs as Array<Record<string, unknown>>)) {
      expect(Object.keys(p).sort()).toEqual(['exactFp', 'newIndex', 'oldLessonId', 'sim', 'tokenMatch'].sort());
      expect(typeof p.oldLessonId).toBe('string');
      expect(typeof p.newIndex).toBe('number');
      expect(typeof p.sim).toBe('number');
    }
    const blob = JSON.stringify(ev);
    expect(blob).not.toContain('はじめまして');
    expect(blob).not.toContain('すみません');
    expect(blob).not.toContain('第1課');
    expect(blob).not.toContain('復習A');
    expect(blob).not.toContain(vocabSurface);
    expect(blob).not.toContain('べんきょう');
    expect(blob).not.toContain('sourceRef');
    expect(blob).not.toContain(userId);
    expect(blob).not.toContain('c-content-marker');
    expect(blob).not.toContain('offset');
    expect(blob).not.toContain('locator');
    // tokenMatch 为允许的布尔信号位；禁止的是 token 原文值与 oldToken/newToken 键。
    expect(blob).not.toContain('"oldToken"');
    expect(blob).not.toContain('"newToken"');
    expect(blob).not.toContain('"dialogues"');
    expect(blob).not.toContain('"vocabularies"');
    expect(blob).not.toContain('"sourceRef"');
  });

  it('shadow 零额外写入：canonical 恰一次、provisional id 原样、行数=新课数', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const docId = 'doc-nowrite';
    await postDoc(app, 'u1', {
      id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(book(seedBook())),
    });
    const origCanonical = repo.saveCanonicalAst.bind(repo);
    let canonicalCalls = 0;
    repo.saveCanonicalAst = (async (
      ...args: Parameters<typeof origCanonical>
    ): Promise<Awaited<ReturnType<typeof origCanonical>>> => {
      canonicalCalls += 1;
      return origCanonical(...args);
    }) as typeof repo.saveCanonicalAst;
    const origSaveDoc = repo.saveDocument.bind(repo);
    let docCalls = 0;
    repo.saveDocument = (async (
      ...args: Parameters<typeof origSaveDoc>
    ): Promise<Awaited<ReturnType<typeof origSaveDoc>>> => {
      docCalls += 1;
      return origSaveDoc(...args);
    }) as typeof repo.saveDocument;
    try {
      const next = [L('n1', '第1課', JA), L('nR', '復習A', JR), L('n2', '第2課', JB), L('n3', '第3課', JC)];
      const { result, events } = await captureShadow(() =>
        postDoc(app, 'u1', {
          id: docId, title: 'B', sourceKind: 'user_import', language: 'ja', content: 'c',
          astJson: JSON.stringify(book(next)),
        })
      );
      expect(result.status).toBe(200);
      expect(events).toHaveLength(1);
      expect(canonicalCalls).toBe(1);
      expect(docCalls).toBe(0);
      const got = await repo.getDocumentById(docId);
      expect(isOk(got)).toBe(true);
      if (!isOk(got) || !got.value?.astJson) return;
      const saved = JSON.parse(got.value.astJson as string) as { lessons: Array<{ id: string }> };
      expect(saved.lessons.map((l) => l.id)).toEqual(['n1', 'nR', 'n2', 'n3']);
      const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(docId) as { n: number };
      expect(n.n).toBe(4);
    } finally {
      repo.saveCanonicalAst = origCanonical;
      repo.saveDocument = origSaveDoc;
    }
  });
});
