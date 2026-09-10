import { describe, expect, it, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { isOk } from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { createLibraryRoutes, classifyDocumentAstJson } from '../modules/library/http/library-routes.js';

/**
 * P1-C0.75a：POST /api/documents AST 输入边界（HTTP 级 + 分类器单元）。
 * - 合法教材 → saveCanonicalAst 原子保存 + shred；
 * - 白名单非教材（{questions}）/ 无 astJson → saveDocument；
 * - 非法 JSON / 含 lessons 但坏 AST / 未知形态 → 结构化错误，saveDocument 永不被调用，
 *   documents 与 textbook_* 零写入。
 */
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function testApp(repo: DrizzleLearnerRepository): Hono {
  return createLibraryRoutes({ repo, server: {} as never, port: 0 });
}

function lesson(id: string, n: number): Record<string, unknown> {
  return { id, lessonNumber: n, title: `t${n}`, vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] };
}

function textbookAst(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'b1', language: 'JA', title: 'B', shortTitle: 'B',
    lessons: [lesson('l1', 1), lesson('l2', 2)],
    ...extra,
  };
}

async function post(app: Hono, userId: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/api/documents/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function counts(repo: DrizzleLearnerRepository, docId: string): { docs: number; lessons: number } {
  const db = repo.getRawDb();
  const docs = (db.query('SELECT COUNT(*) AS n FROM documents WHERE id = ?').get(docId) as { n: number }).n;
  const lessons = (db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(docId) as { n: number }).n;
  return { docs, lessons };
}

describe('classifyDocumentAstJson（纯函数）', () => {
  it('四路分类', () => {
    expect(classifyDocumentAstJson(undefined).kind).toBe('none');
    expect(classifyDocumentAstJson(null).kind).toBe('none');
    expect(classifyDocumentAstJson('').kind).toBe('none');
    expect(classifyDocumentAstJson(textbookAst()).kind).toBe('textbook');
    expect(classifyDocumentAstJson(JSON.stringify(textbookAst())).kind).toBe('textbook');
    expect(classifyDocumentAstJson({ id: 'r', questions: [] }).kind).toBe('non-textbook');
    const badJson = classifyDocumentAstJson('{broken');
    expect(badJson.kind).toBe('invalid');
    if (badJson.kind === 'invalid') expect(badJson.code).toBe('E_INVALID_INPUT');
    const dup = textbookAst({ lessons: [lesson('l1', 1), lesson('l1', 2)] });
    const dupRes = classifyDocumentAstJson(dup);
    expect(dupRes.kind).toBe('invalid');
    if (dupRes.kind === 'invalid') expect(dupRes.code).toBe('E_INVALID_TEXTBOOK_AST');
    const unknown = classifyDocumentAstJson({ foo: 1 });
    expect(unknown.kind).toBe('invalid');
    if (unknown.kind === 'invalid') expect(unknown.code).toBe('E_INVALID_INPUT');
  });
});

describe('POST /api/documents AST 边界（HTTP 级）', () => {
  it('合法教材 AST → 原子保存 + shred，saveDocument 未被调用', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    let plainSaves = 0;
    const origSave = repo.saveDocument.bind(repo);
    repo.saveDocument = (async (doc: DocumentItem) => {
      plainSaves++;
      return origSave(doc);
    }) as typeof repo.saveDocument;
    const app = testApp(repo);
    const { status } = await post(app, 'u1', {
      id: 'doc-tb', title: 'T', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(textbookAst()),
    });
    expect(status).toBe(200);
    expect(plainSaves).toBe(0);
    expect(counts(repo, 'doc-tb')).toEqual({ docs: 1, lessons: 2 });
  });

  it('白名单 {questions} → 普通保存，无 shred', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const { status } = await post(app, 'u1', {
      id: 'doc-news', title: 'N', sourceKind: 'news', language: 'ja', content: 'c',
      astJson: JSON.stringify({ id: 'r', questions: [{ q: '1' }] }),
    });
    expect(status).toBe(200);
    expect(counts(repo, 'doc-news')).toEqual({ docs: 1, lessons: 0 });
  });

  it('无 astJson → 普通保存', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const { status } = await post(app, 'u1', { id: 'doc-plain', title: 'P', content: 'c' });
    expect(status).toBe(200);
    const got = await repo.getDocumentById('doc-plain');
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) return;
    expect(got.value?.id).toBe('doc-plain');
  });

  it('非法 JSON → 400 且 documents 零写入', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    let plainSaves = 0;
    const origSave = repo.saveDocument.bind(repo);
    repo.saveDocument = (async (doc: DocumentItem) => {
      plainSaves++;
      return origSave(doc);
    }) as typeof repo.saveDocument;
    const app = testApp(repo);
    const { status, json } = await post(app, 'u1', { id: 'doc-bad', title: 'B', astJson: '{broken' });
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe('E_INVALID_INPUT');
    expect(plainSaves).toBe(0);
    expect(counts(repo, 'doc-bad')).toEqual({ docs: 0, lessons: 0 });
  });

  it('含 lessons 但 lesson id 重复 → E_INVALID_TEXTBOOK_AST，零写入', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    let plainSaves = 0;
    const origSave = repo.saveDocument.bind(repo);
    repo.saveDocument = (async (doc: DocumentItem) => {
      plainSaves++;
      return origSave(doc);
    }) as typeof repo.saveDocument;
    const app = testApp(repo);
    const dup = textbookAst({ lessons: [lesson('l1', 1), lesson('l1', 2)] });
    const { status, json } = await post(app, 'u1', {
      id: 'doc-dup', title: 'D', sourceKind: 'user_import', language: 'ja', content: 'c',
      astJson: JSON.stringify(dup),
    });
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe('E_INVALID_TEXTBOOK_AST');
    expect(plainSaves).toBe(0);
    expect(counts(repo, 'doc-dup')).toEqual({ docs: 0, lessons: 0 });
  });

  it('未知形态 → 400 且零写入', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = testApp(repo);
    const { status, json } = await post(app, 'u1', {
      id: 'doc-unk', title: 'U', astJson: JSON.stringify({ foo: 1 }),
    });
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe('E_INVALID_INPUT');
    expect(counts(repo, 'doc-unk')).toEqual({ docs: 0, lessons: 0 });
  });
});
