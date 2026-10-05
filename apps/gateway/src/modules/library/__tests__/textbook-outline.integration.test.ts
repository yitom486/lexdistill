import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmdirSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextbookASTSchema, SaveTextbookOutlineResultSchema } from '@study-studio/document-model';
import { TextbookInspectionResultSchema } from '@study-studio/protocol';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();

let outlineRpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `outline-${++outlineRpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    await submitScope(scope, kind, requiredContent[kind]);
  }
}
async function scopeArticle(scope: McpChapterScope, lessonId: string) {
  await submitScope(scope, 'articles', { items: [{ text: `${lessonId}正文` }] });
}

const fixture = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);
const entries = [
  { id: 'l1', title: '第一章', level: 'lesson' as const, startPage: 1 },
  { id: 'l2', title: '第二章', level: 'lesson' as const, startPage: 2 },
];
const input = { title: '目录保存集成教材', language: 'ja', filePath: fileURLToPath(fixture), tocEntries: entries };
function routes(repo: DrizzleLearnerRepository) {
  // 目录保存无需 Agent、工具注册或 OCR runtime。
  return createPdfImportRoutes({ repo, server: {} as never, port: 0 });
}
function save(app: ReturnType<typeof routes>, body: unknown = input, user = 'owner') {
  return app.request(`/api/documents/${user}/textbook-outline`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('独立目录保存：HTTP → SQLite → 文件指纹检测 → 正文流水线', () => {
  it('未启动正文即可持久化；重开文件库按指纹加载，同文件重复确认不重复建书', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lingua-outline-'));
    const path = join(dir, 'outline.db');
    let repo = new DrizzleLearnerRepository(path);
    try {
      const response = await save(routes(repo)); expect(response.status).toBe(200);
      const saved = SaveTextbookOutlineResultSchema.parse(await response.json());
      expect(saved.lessonCount).toBe(2); expect(saved.entries[0]?.endPage).toBe(1);
      const document = await repo.getDocumentById(saved.documentId);
      expect(document.ok).toBe(true);
      if (!document.ok || !document.value?.astJson) throw new Error('目录没有真正写入底稿');
      const ast = TextbookASTSchema.parse(JSON.parse(document.value.astJson));
      expect(ast.outlineConfirmed).toBe(true); expect(ast.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(ast.lessons.map(lesson => lesson.id)).toEqual(['l1', 'l2']);
      repo.getRawDb().close(); repo = new DrizzleLearnerRepository(path);
      const app = routes(repo);
      const inspected = await app.request('/api/documents/owner/inspect-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: '改名.pdf', filePath: input.filePath }),
      });
      const state = TextbookInspectionResultSchema.parse(await inspected.json());
      expect(state.matchedDocument?.documentId).toBe(saved.documentId);
      expect(state.summary).toContain('正文尚未提取'); expect(state.canDirectlyUse).toBe(false);
      expect(state.matchedDocument?.readyLessonCount).toBe(0);
      expect(state.matchedDocument?.lineCount).toBe(0); expect(state.matchedDocument?.vocabCount).toBe(0);
      expect(state.matchedDocument?.grammarCount).toBe(0); expect(state.matchedDocument?.exerciseCount).toBe(0);
      const slots = await repo.listTextbookLessonSlots(saved.documentId);
      if (!slots.ok) throw slots.error;
      expect(slots.value.map(slot => [slot.startPage, slot.status, slot.hasPassage])).toEqual([[1, 'pending', false], [2, 'pending', false]]);
      const repeated = SaveTextbookOutlineResultSchema.parse(await (await save(app)).json());
      expect(repeated.documentId).toBe(saved.documentId);
      const docs = await repo.listDocuments('owner'); expect(docs.ok && docs.value.length).toBe(1);
      const separate = SaveTextbookOutlineResultSchema.parse(await (await save(app, input, 'other')).json());
      expect(separate.documentId).not.toBe(saved.documentId);
    } finally {
      repo.getRawDb().close();
      Bun.gc(true);
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
      rmdirSync(dir);
    }
  });

  it('目录页码倒退拒绝写入；保存失败没有伪造教材记录', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const response = await save(routes(repo), { ...input, tocEntries: entries.map((entry, index) => ({ ...entry, startPage: 2 - index })) });
      expect(response.ok).toBe(false); expect(JSON.stringify(await response.json())).toContain('E_TOC_PAGE_ORDER_INVALID');
      const docs = await repo.listDocuments('owner'); expect(docs.ok && docs.value.length).toBe(0);
      const malformed = await save(routes(repo), { ...input, tocEntries: [{ ...entries[0], startPage: 0 }] });
      expect(malformed.ok).toBe(false);
    } finally { repo.getRawDb().close(); }
  });

  it('后续正文使用已存教材 ID；再次确认目录保留正文，漏掉已就绪课次则拒绝并回滚', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const app = routes(repo);
      const saved = SaveTextbookOutlineResultSchema.parse(await (await save(app)).json());
      const harness = harnessInjection(repo, new Map<string, ChapterScript>([
        ['l1', async (scope) => { await scopeArticle(scope, 'l1'); await submitRequiredScope(scope); }],
        ['l2', async (scope) => { await scopeArticle(scope, 'l2'); await submitRequiredScope(scope); }],
      ]));
      const result = await repo.executeTextbookPipeline({
        documentId: saved.documentId, userId: 'owner', title: input.title, tocEntries: saved.entries,
        pdf: new Uint8Array(await Bun.file(fixture).arrayBuffer()),
        poolSize: 1, ...harness.extra,
        lessonJobs: entries.map(entry => ({ lessonId: entry.id, text: entry.title })),
      });
      expect(result.ok).toBe(true);
      const repeated = await save(app, { ...input, tocEntries: entries.map(entry => ({ ...entry, id: `new-${entry.id}` })) });
      expect(repeated.status).toBe(200);
      expect(SaveTextbookOutlineResultSchema.parse(await repeated.json()).entries.map(entry => entry.id)).toEqual(['l1', 'l2']);
      const before = await repo.getTextbookAssetStats(saved.documentId);
      if (!before.ok) throw before.error;
      expect(before.value.readyLessons).toBe(2); expect(before.value.lines).toBe(2);
      const rejected = await save(app, { ...input, tocEntries: [entries[0]] });
      expect(rejected.ok).toBe(false); expect(JSON.stringify(await rejected.json())).toContain('E_TOC_SLOT_CONFLICT');
      expect(await repo.getTextbookAssetStats(saved.documentId)).toEqual(before);
    } finally { repo.getRawDb().close(); }
  });
});
