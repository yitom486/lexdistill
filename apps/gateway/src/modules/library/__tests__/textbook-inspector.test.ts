import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { TextbookASTSchema, type TocEntry } from '@study-studio/document-model';
import { TextbookInspectionResultSchema } from '@study-studio/protocol';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { LessonBatchExtractor, type AgentPoolLike } from '../application/lesson-batch-extractor.js';

const fixture = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
function environment() {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  const db = drizzle(repo.getRawDb(), { schema });
  const app = createPdfImportRoutes({ repo, server: {} as never, port: 0 });
  return { repo, db, app };
}
function poolReturning(text: string): AgentPoolLike {
  return { acquire: async () => ({ ask: async () => ({ text }), finish: async () => {} }), close: async () => {} };
}
async function seed(repo: DrizzleLearnerRepository, entries: TocEntry[], documentId = 'book', sourceFingerprint?: string) {
  const fingerprint = sourceFingerprint ?? createHash('sha256').update(new Uint8Array(await Bun.file(fixture).arrayBuffer())).digest('hex');
  const result = await repo.seedTextbookTocSkeleton({ documentId, userId: 'owner', title: '测试教材', entries,
    sourceFingerprint: fingerprint });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
}
async function inspect(app: ReturnType<typeof createPdfImportRoutes>, filename = '测试教材.pdf', filePath = fileURLToPath(fixture), userId = 'owner') {
  const response = await app.request(`/api/documents/${userId}/inspect-import`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, filePath }) });
  expect(response.status).toBe(200);
  return TextbookInspectionResultSchema.parse(await response.json());
}

describe('教材导入检测：真实 HTTP、SQLite、模型提取及重复导入集成', () => {
  it('10 课仅导入 1 课且有 21 个生词，仍明确显示未完成；补齐后重新检测真实转为就绪', async () => {
    const { repo, app } = environment();
    const entries: TocEntry[] = Array.from({ length: 10 }, (_, index) => ({ id: `l${index + 1}`, level: 'lesson', title: `第${index + 1}课`, startPage: index + 1 }));
    await seed(repo, entries);
    const extractor = new LessonBatchExtractor(repo);
    const first = await extractor.extractBatch([{ documentId: 'book', lessonId: 'l1', ocrText: '第一课原文' }], {
      pool: poolReturning(JSON.stringify({ vocabularies: Array.from({ length: 21 }, (_, index) => ({ surface: `测试词${index + 1}` })) })),
    });
    expect(first.successfulJobs).toBe(1);
    expect(first.allLessonsReady).toBe(false);
    const partial = await inspect(app);
    expect(partial.status).toBe('partial');
    expect(partial.summary).toContain('1/10');
    expect(partial.matchedDocument?.vocabCount).toBe(21);
    expect(partial.matchedDocument?.passageLessonCount).toBe(0);
    expect(partial.matchedDocument?.lessonDetails.filter((l) => l.status === 'pending')).toHaveLength(9);
    expect(partial.matchedDocument?.lessonDetails[0]?.vocabCount).toBe(21);
    let skippedStats: { hasPassage: boolean; vocabCount: number } | undefined;
    const completed = await extractor.extractBatch(entries.map((e) => ({ documentId: 'book', lessonId: e.id, ocrText: '原书正文' })), {
      pool: poolReturning(JSON.stringify({ passageMd: '保存的课文' })), poolSize: 2,
      onProgress: (progress) => { if (progress.lessonId === 'l1') skippedStats = progress.stats; },
    });
    expect(skippedStats?.hasPassage).toBe(false);
    expect(skippedStats?.vocabCount).toBe(21);
    expect(completed.allLessonsReady).toBe(true);
    const ready = await inspect(app);
    expect(ready.status).toBe('ready');
    expect(ready.matchedDocument?.readyLessonCount).toBe(10);
    expect(ready.matchedDocument?.vocabCount).toBe(21);
    expect(ready.matchedDocument?.passageLessonCount).toBe(9);
    expect(ready.matchedDocument?.lessonDetails[0]?.hasPassage).toBe(false);
    expect((await inspect(app, '测试教材.pdf', undefined, 'other-user')).matchedDocument).toBeUndefined();
  });

  it('确认同一份 PDF 的指纹、逐课所有资产及 AST；改名仍识别，不同文件同名不自动确认', async () => {
    const { repo, db, app } = environment();
    const bytes = new Uint8Array(await Bun.file(fixture).arrayBuffer());
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    await seed(repo, [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 1 },
      { id: 's1', level: 'section', title: '会话', startPage: 1, parentId: 'l1' },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 2 },
    ], 'book', fingerprint);
    const output = JSON.stringify({ title: '模型猜测的课名', passageMd: '私は学生です。',
      preview: { keyPoints: ['判断句'] }, summary: { goldenSentences: ['私は学生です。'] },
      vocabularies: [{ surface: '学生', reading: 'がくせい', glossZh: '学生' }],
      knowledgePoints: [{ title: '～です', examples: [{ japanese: '私は学生です。', chinese: '我是学生。' }] }],
      exercises: [{ type: 'FILL_BLANK', prompt: '私は学生___。', answer: 'です' }] });
    const extractor = new LessonBatchExtractor(repo);
    const jobs = ['l1', 'l2'].map((lessonId) => ({ documentId: 'book', lessonId, ocrText: '真实原文输入' }));
    expect((await extractor.extractBatch(jobs, { pool: poolReturning(output) })).allLessonsReady).toBe(true);
    const result = await inspect(app, '重命名教材.pdf', fileURLToPath(fixture));
    expect(result.status).toBe('ready');
    expect(result.matchedDocument?.matchKind).toBe('file');
    expect(result.matchedDocument?.lessonCount).toBe(2);
    expect(result.matchedDocument?.readyLessonCount).toBe(2);
    expect(result.matchedDocument?.lineCount).toBe(2);
    expect(result.matchedDocument?.vocabCount).toBe(2);
    expect(result.matchedDocument?.grammarCount).toBe(2);
    expect(result.matchedDocument?.exerciseCount).toBe(2);
    expect(result.matchedDocument?.lessonDetails.every((l) => l.hasPreview && l.hasSummary)).toBe(true);
    expect(result.matchedDocument?.lessonDetails[0]?.title).toBe('第1课');
    const doc = db.select().from(schema.documents).where(eq(schema.documents.id, 'book')).all()[0]!;
    const ast = TextbookASTSchema.parse(JSON.parse(doc.astJson!));
    expect(ast.sourceFingerprint).toBe(fingerprint);
    expect(ast.outlineConfirmed).toBe(true);
    expect(ast.lessons.find((l) => l.id === 's1')?.kind).toBe('section');
    expect(ast.lessons.find((l) => l.id === 'l1')?.startPage).toBe(1);
    expect(ast.lessons.find((l) => l.id === 'l1')?.endPage).toBe(1);
    expect(ast.lessons.find((l) => l.id === 'l1')?.vocabularies).toHaveLength(1);
    expect(ast.lessons.find((l) => l.id === 'l1')?.grammarPoints[0]?.examples).toHaveLength(1);
    expect(ast.lessons.find((l) => l.id === 'l1')?.exercises).toHaveLength(1);
    let acquired = false;
    const neverAcquire: AgentPoolLike = { acquire: async () => { acquired = true; throw new Error('重复导入不应调用模型'); }, close: async () => {} };
    expect((await extractor.extractBatch(jobs, { pool: neverAcquire })).allLessonsReady).toBe(true);
    expect(acquired).toBe(false);
    const different = await inspect(app, '测试教材.pdf', fileURLToPath(new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url)));
    expect(different.status).toBe('not_imported');
    expect(different.matchedDocument).toBeUndefined();
    expect((await inspect(app)).matchedDocument?.matchKind).toBe('file');
    const withoutFile = await app.request('/api/documents/owner/inspect-import', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: '测试教材.pdf' }) });
    expect(withoutFile.status).toBe(400);
  });

  it('空模型输出不写资产、不标记就绪，任务台账和检测均显示未完成', async () => {
    const { repo, db, app } = environment();
    const result = await repo.executeTextbookPipeline({ userId: 'owner', documentId: 'book', title: '测试教材',
      pdf: new Uint8Array(await Bun.file(fixture).arrayBuffer()),
      tocEntries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      lessonJobs: [{ lessonId: 'l1', ocrText: '原书有正文' }], pool: poolReturning('{}') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.task.status).toBe('failed');
    expect(result.value.successfulLessons).toBe(0);
    expect(result.value.failedLessons).toBe(1);
    expect(result.value.allLessonsReady).toBe(false);
    expect(db.select().from(schema.textbookLines).all()).toHaveLength(0);
    const resultAfter = await inspect(app);
    expect(resultAfter.status).toBe('partial');
    expect(resultAfter.matchedDocument?.readyLessonCount).toBe(0);
    expect(resultAfter.matchedDocument?.lessonDetails[0]?.hasPassage).toBe(false);
    const malformed = await app.request('/api/documents/owner/inspect-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"filename":42}' });
    expect(malformed.status).toBe(400);
  });

  it('目录补课保留原课资产；复用冲突 ID 或换版本拒绝，删除的课不留下派生资产', async () => {
    const { repo, db, app } = environment();
    await seed(repo, [{ id: 'l1', level: 'lesson', title: '原第一课', startPage: 2 }]);
    expect((await repo.commitLessonKnowledge({ documentId: 'book', lessonId: 'l1', passageMd: '原课正文', vocabularies: [{ surface: '原词' }], exercises: [{ type: 'TRANSLATION', prompt: '原句', answer: '原答案' }] })).ok).toBe(true);
    const conflict = await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: '冲突目录', entries: [{ id: 'l1', level: 'lesson', title: '新增课', startPage: 1 }] });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('E_TOC_SLOT_CONFLICT');
    expect((await inspect(app)).matchedDocument?.title).toBe('测试教材');
    const sourceConflict = await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: '测试教材', sourceFingerprint: 'another-file', entries: [{ id: 'l1', level: 'lesson', title: '原第一课', startPage: 2 }] });
    expect(sourceConflict.ok).toBe(false);
    if (!sourceConflict.ok) expect(sourceConflict.error.code).toBe('E_SOURCE_FILE_CONFLICT');
    await seed(repo, [{ id: 'added', level: 'lesson', title: '新增课', startPage: 1 }, { id: 'l1', level: 'lesson', title: '原第一课', startPage: 2 }]);
    const partial = await inspect(app);
    expect(partial.matchedDocument?.readyLessonCount).toBe(1);
    expect(partial.matchedDocument?.lessonDetails.find((l) => l.lessonId === 'l1')?.vocabCount).toBe(1);
    expect(db.select().from(schema.textbookLessons).all().find((l) => l.lessonId === 'l1')?.passageMd).toBe('原课正文');
    await seed(repo, [{ id: 'added', level: 'lesson', title: '新增课', startPage: 1 }]);
    expect(db.select().from(schema.textbookVocab).all()).toHaveLength(0);
    expect(db.select().from(schema.textbookExercises).all()).toHaveLength(0);
    expect(db.select().from(schema.textbookLines).all()).toHaveLength(0);
    expect((await inspect(app)).matchedDocument?.readyLessonCount).toBe(0);
  });

  it('用户取消后，迟到模型结果释放租约且不再写入数据库', async () => {
    const { repo, db } = environment();
    await seed(repo, [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }]);
    const controller = new AbortController();
    let released = false;
    const pool: AgentPoolLike = { acquire: async () => ({ ask: async () => { controller.abort(); return { text: '{"passageMd":"迟到结果"}' }; }, finish: async () => { released = true; } }), close: async () => {} };
    await new LessonBatchExtractor(repo).extractBatch([{ documentId: 'book', lessonId: 'l1', ocrText: '原文' }], { pool, signal: controller.signal });
    expect(released).toBe(true);
    expect(db.select().from(schema.textbookLines).all()).toHaveLength(0);
    expect(db.select().from(schema.textbookLessons).all()[0]?.status).toBe('pending');
  });

  it('超过原池队列长度的全书按用户并发度消费，所有课均能完成', async () => {
    const { repo, app } = environment();
    const entries: TocEntry[] = Array.from({ length: 70 }, (_, index) => ({ id: `l${index + 1}`, level: 'lesson', title: `第${index + 1}课`, startPage: index + 1 }));
    await seed(repo, entries);
    let active = 0;
    let peak = 0;
    const pool: AgentPoolLike = { acquire: async () => { active++; peak = Math.max(peak, active); return {
      ask: async () => { await new Promise((r) => setTimeout(r, 1)); return { text: '{"passageMd":"测试正文"}' }; }, finish: async () => { active--; },
    }; }, close: async () => {} };
    const summary = await new LessonBatchExtractor(repo).extractBatch(entries.map((e) => ({ documentId: 'book', lessonId: e.id, ocrText: '原文' })), { pool, poolSize: 2 });
    expect(summary.successfulJobs).toBe(70);
    expect(summary.failedJobs).toBe(0);
    expect(summary.allLessonsReady).toBe(true);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect((await inspect(app)).matchedDocument?.readyLessonCount).toBe(70);
  });
});
