import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { markdownToAst } from '@study-studio/content';
import { convertPdfToAst, importPdfDocument } from '../application/pdf-import/pdf-import-service.js';
import { buildScannedLessonDialectPdf } from './fixtures/gen/gen-scanned-lesson-dialect.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-03：无文字层扫描课结构 fixture 真机锁（全 :memory:/fixture，真库零接触）。
 *
 * fixture = scanned-lesson-dialect.pdf（3 页整页位图，自撰：第1課/会話/对话/
 * 練習A噪声/第2課/復習A42）：文本层 thin → 本地 OCR → 提升 → 切课。
 * 断言只锁课标题集合与课数，不锁 OCR 的每一个假名（OCR 行合并等波动不判错）。
 * native E2E 永不 skip（运行时就绪失败即整文件失败）。
 */
pinProcessToTestRuntime();
await ensurePdfTestRuntime();

const FIXTURE_URL = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);

async function fixtureBytes(): Promise<Uint8Array> {
  const buf = await Bun.file(FIXTURE_URL).arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(0);
  return new Uint8Array(buf);
}

const NOISE_TITLES = ['会話', '練習A', '目次', '前言'];

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

describe('A. 生成器可重跑字节一致', () => {
  it('连续两次构建输出字节完全相同', async () => {
    const a = await buildScannedLessonDialectPdf();
    const b = await buildScannedLessonDialectPdf();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

describe('B. 文本层 thin：未 OCR 时切不出 2 课', () => {
  it('processPdf 无 OCR：三页全进 pagesNeedingOcr，文本层无课标题', async () => {
    const bytes = await fixtureBytes();
    const { inspector } = await ensurePdfTestRuntime();
    const cls = inspector.processPdf(bytes) as {
      pageCount?: unknown;
      markdown?: unknown;
      pagesNeedingOcr?: unknown;
    };
    expect(cls.pageCount).toBe(3);
    expect(cls.pagesNeedingOcr).toEqual([1, 2, 3]);
    const md = typeof cls.markdown === 'string' ? cls.markdown : '';
    expect(md.includes('第1課')).toBe(false);
    expect(md.includes('第2課')).toBe(false);
    // 未 OCR 的文本层连一课都切不出（空输入直接 E_CONTENT_EMPTY，不编造）
    expect(markdownToAst(md, { bookId: 'pdf-thin-check' }).ok).toBe(false);
  });
});

describe('C+D. native convert：本地 OCR 切出 第1課/第2課/復習A42', () => {
  it('ocrUsed=true、无 azure、噪声不成课、復習A42 保留 42', async () => {
    const bytes = await fixtureBytes();
    const res = await convertPdfToAst({}, { userId: 'u1', filename: 'scan-dialect.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.ocrUsed).toBe(true);
    expect(res.value.classification.azurePages).toBeUndefined();
    const titles = res.value.book.lessons.map((l) => l.title);
    expect(titles).toEqual(['第1課', '第2課', '復習A42']);
    for (const noise of NOISE_TITLES) {
      expect(titles.some((t) => t === noise)).toBe(false);
    }
    const review = res.value.book.lessons.find((l) => l.title.includes('復習A'));
    expect(review?.title.includes('42')).toBe(true);
    const speakers = new Set(res.value.book.lessons.flatMap((l) => l.dialogues.map((d) => d.speaker)));
    expect(speakers.has('アキ')).toBe(true);
    expect(speakers.has('ミナ')).toBe(true);
  }, 120000);
});

describe('E. 入库行数 == AST 课数', () => {
  it('importPdfDocument 后 textbook_lessons 行数对齐', async () => {
    const bytes = await fixtureBytes();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const res = await importPdfDocument(
      {
        saveDocument: (doc) => repo.saveDocument(doc),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
      },
      { userId: 'u1', filename: 'scan-dialect.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(res.value.document.id) as { n: number };
    expect(n.n).toBe(res.value.book.lessons.length);
    expect(n.n).toBe(3);
  }, 120000);
});
