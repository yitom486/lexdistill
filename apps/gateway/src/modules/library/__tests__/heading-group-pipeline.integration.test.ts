import { expect, it } from 'bun:test';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { SaveTextbookOutlineResultSchema, type TocEntry } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { fixturePdf } from './textbook-pipeline-fixtures.js';
import { pinProcessToTestRuntime } from './pdf-test-runtime.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
pinProcessToTestRuntime();

// 混合四种类型、嵌套课次和三级标题，分组不依赖教材名称或枚举排序。
const entries: TocEntry[] = [
  { id: 'root-a', title: '准备单元', level: 'unit', startPage: 1 },
  { id: 'child-a', title: '发音准备', level: 'lesson', parentId: 'root-a', startPage: 1 },
  { id: 'deep-a', title: '长音练习', level: 'section', parentId: 'child-a', startPage: 2 },
  { id: 'root-b', title: '第一课', level: 'lesson', startPage: 3 },
  { id: 'child-b', title: '自我介绍', level: 'section', parentId: 'root-b', startPage: 4 },
  { id: 'root-c', title: '复习章', level: 'chapter', startPage: 5 },
  { id: 'child-c', title: '复习句型', level: 'section', parentId: 'root-c', startPage: 6 },
  { id: 'root-d', title: '独立阅读', level: 'section', startPage: 7 },
  { id: 'child-d', title: '阅读课次', level: 'lesson', parentId: 'root-d', startPage: 8 },
];

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `heading-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}

it('一级标题保存重开、真实 PDF 切片、MCP 工具及事务使用同一分组', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingua-heading-'));
  const dbPath = join(dir, 'book.db'), pdfPath = join(dir, 'book.pdf');
  let repo = new DrizzleLearnerRepository(dbPath);
  try {
    const pdf = await fixturePdf(8); await Bun.write(pdfPath, pdf);
    const request = { title: '层级验证教材', language: 'ja', filePath: pdfPath, tocEntries: entries };
    const save = (body: unknown) => createPdfImportRoutes({ repo, server: {} as never, port: 0 }).request('/api/documents/owner/textbook-outline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await save(request); expect(response.status).toBe(200);
    const saved = SaveTextbookOutlineResultSchema.parse(await response.json());
    expect(saved.totalEntries).toBe(4);
    expect(saved.entries.filter(entry => !entry.parentId).map(entry => entry.endPage)).toEqual([2, 4, 6, undefined]);
    repo.getRawDb().close(); repo = new DrizzleLearnerRepository(dbPath);
    const slots = await repo.listTextbookLessonSlots(saved.documentId);
    if (!slots.ok) throw slots.error;
    expect(slots.value.map(slot => slot.lessonId)).toEqual(['root-a', 'root-b', 'root-c', 'root-d']);
    const restored = slots.value.flatMap(slot => slot.tocEntries ?? []);
    expect(restored.map(entry => [entry.id, entry.parentId])).toEqual(entries.map(entry => [entry.id, entry.parentId]));
    const repeated = await save({ ...request, tocEntries: entries.map(entry => ({ ...entry, id: `new-${entry.id}`, ...(entry.parentId ? { parentId: `new-${entry.parentId}` } : {}) })) });
    expect(repeated.status).toBe(200);
    expect(SaveTextbookOutlineResultSchema.parse(await repeated.json()).entries.map(entry => entry.id)).toEqual(entries.map(entry => entry.id));
    const scripts = new Map<string, ChapterScript>();
    const pagesRead: number[][] = [];
    for (const root of ['root-a', 'root-b', 'root-c', 'root-d']) {
      scripts.set(root, async (scope, job) => {
        if (!job.pdfFile) throw new Error('章节 PDF 未就绪');
        expect((await PDFDocument.load(await Bun.file(job.pdfFile.path).bytes())).getPageCount()).toBe(job.pdfFile.pageCount);
        pagesRead.push([...job.pdfFile.originalPages]);
        await submitScope(scope, 'grammar', requiredContent.grammar);
        await submitScope(scope, 'vocabulary', requiredContent.vocabulary);
        await submitScope(scope, 'exercises', requiredContent.exercises);
        await submitScope(scope, 'articles', { items: [{ text: `${root}正文` }] });
      });
    }
    const harness = harnessInjection(repo, scripts);
    const progress: Array<{ id: string; total: number }> = [];
    const result = await repo.executeTextbookPipeline({ userId: 'owner', documentId: saved.documentId, title: request.title,
      tocEntries: restored, pdf, poolSize: 2, modelRetries: 0, ...harness.extra,
      onProgress: event => progress.push({ id: event.lessonId, total: event.totalCount }),
    });
    expect(result.ok && result.value).toMatchObject({ successfulLessons: 4, failedLessons: 0, allLessonsReady: true, lessonCount: 4 });
    // 四个 ask 的提示词各自只含本组标题；切片页数在执行期脚本中断言（管线结束即清理）。
    expect(harness.driver.asks).toHaveLength(4);
    for (const prompt of harness.driver.asks) {
      const title = /^章节: (.+)$/m.exec(prompt)?.[1];
      const root = entries.find(entry => !entry.parentId && entry.title === title)!;
      const group = slots.value.find(slot => slot.lessonId === root.id)!.tocEntries!;
      for (const entry of group) expect(prompt).toContain(entry.title);
      for (const other of restored.filter(entry => !group.some(own => own.id === entry.id))) expect(prompt).not.toContain(other.title);
      if (root.id === 'root-a') expect(prompt).toContain('    - 长音练习');
      for (const field of ['tocId', 'sourceRefs', 'startPage', 'root-a', 'coverage', 'inputSchema']) expect(prompt).not.toContain(field);
    }
    expect(pagesRead.sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    expect([...new Set(progress.map(event => event.id))].sort()).toEqual(['root-a', 'root-b', 'root-c', 'root-d']);
    expect(progress.every(event => event.total === 4)).toBe(true);
    expect(harness.driver.finishes).toHaveLength(2);
    const stats = await repo.getTextbookAssetStats(saved.documentId);
    expect(stats.ok && stats.value).toMatchObject({ lessons: 4, readyLessons: 4, vocab: 4, grammar: 4, exercises: 4, lines: 4 });
  } finally {
    repo.getRawDb().close(); Bun.gc(true);
    for (const path of [pdfPath, dbPath, dbPath + '-wal', dbPath + '-shm']) if (existsSync(path)) unlinkSync(path);
    rmdirSync(dir);
  }
});

it('缺失父节点、循环或一级页码倒退拒绝保存，不产生伪造任务', async () => {
  const repo = new DrizzleLearnerRepository(':memory:');
  try {
    const valid = [
      { entries: [{ ...entries[0]!, parentId: 'missing' }], code: 'E_TOC_HIERARCHY_INVALID' },
      { entries: [{ ...entries[0]!, parentId: 'child-a' }, entries[1]!], code: 'E_TOC_HIERARCHY_INVALID' },
      { entries: [{ ...entries[0]!, startPage: 5 }, { ...entries[3]!, startPage: 3 }], code: 'E_TOC_PAGE_ORDER_INVALID' },
    ];
    for (const test of valid) {
      const result = await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'bad', title: '错误目录', entries: test.entries });
      expect(!result.ok && result.error.code).toBe(test.code);
      const doc = await repo.getDocumentById('bad'); expect(doc.ok && doc.value).toBeNull();
    }
  } finally { repo.getRawDb().close(); }
});
