import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { extractTocEntries } from '../application/pdf-import/extract-headings.js';
import { extractTocBaseline } from '../application/pdf-import/toc-baseline.js';
import {
  appendPdfToDocument,
  convertPdfToAst,
  importPdfDocument,
  mapPdfPages,
} from '../application/pdf-import/pdf-import-service.js';
import { tryParseTextbookAst } from '../persistence/textbook-shred.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * pdf-import rich 集成测试（tag：pdf-import；native E2E 永不 skip，见 pdf-test-runtime.ts）。
 * 本次修复期 tag 命令见 fixtures/gen/README.md（含 dist 绕行说明）。
 *
 * fixtures（__tests__/fixtures/，git 追踪）：
 * - rich-textbook-toc-review.pdf（5 页真文本）：TOC（普通点线/J1 断行/J2 前置同行/復習/付録）
 *   + 第1課（含无标记前言）+ 第2課 + 復習A + 付録
 * - scanned-shapes-no-text.pdf（1 页纯形状无字）：OCR 路由 + 零产出友好失败
 *
 * 锁定的线上真实行为（实测，非假设）：
 * - lesson_number 是 legacy positional field（导入顺序计数器）：復習A 显示 Lesson 3（不是“A”）；
 *   P1-B 起 ordering 由 sort_order（AST 数组 index+1）表达，display 另议；本断言仅做 legacy characterization
 * - 付録/まえがき无切课标记，并入相邻课
 * - ことば/文法/練習段落目前不进 AST（vocab/grammar/exercises 全 0，缺口已记录）
 * - 零产出错误不断言语种（E_OCR_LANG_UNSUPPORTED 文案已修正）
 */
const RICH_URL = new URL('./fixtures/rich-textbook-toc-review.pdf', import.meta.url);
const SCAN_URL = new URL('./fixtures/scanned-shapes-no-text.pdf', import.meta.url);

// 测试进程默认运行时钉到测试目录（显式 env 优先）；随后 bootstrap，失败即抛（不 skip）。
pinProcessToTestRuntime();
await ensurePdfTestRuntime();

async function bytesOf(url: URL): Promise<Uint8Array> {
  const buf = await Bun.file(url).arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(0);
  return new Uint8Array(buf);
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

describe('pdf-import TOC（单元，离线）', () => {
  it('普通点线/J1/復習/付録/页码前置同行全收', () => {
    const md = [
      '# 目次',
      '第1課 はじめまして ................ 2',
      '第2課 これは本です ................ 3',
      '復習A ............................ 4',
      '付録 ............................. 5',
      '第3課 さんぽ …………………',
      '30',
      '31 第4課 てんき',
    ].join('\n');
    const entries = extractTocEntries(md);
    const byNo = new Map(entries.map((e) => [e.lessonNo, e.printedPage]));
    expect(byNo.get('1')).toBe(2);
    expect(byNo.get('2')).toBe(3);
    expect(byNo.get('復習A')).toBe(4);
    expect(byNo.get('付録')).toBe(5);
    expect(byNo.get('3')).toBe(30);
    expect(byNo.get('4')).toBe(31);
  });
});

describe('pdf-import rich 真 E2E（本机运行时）', () => {
  it('map：6 条目录全收（含 J1/頁碼前置/復習/付録）', async () => {
    const bytes = await bytesOf(RICH_URL);
    const res = await mapPdfPages({}, { userId: 'u1', filename: 'rich.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(5);
    const byNo = new Map(res.value.tocEntries.map((e) => [e.lessonNo, e.printedPage]));
    expect(byNo.get('1')).toBe(2);
    expect(byNo.get('2')).toBe(3);
    expect(byNo.get('復習A')).toBe(4);
    expect(byNo.get('付録')).toBe(5);
    expect(byNo.get('3')).toBe(30);
    expect(byNo.get('4')).toBe(31);
  }, 120000);

  it('convert：3 课 + legacy positional lesson_number + 前言付録并入 + 零 OCR', async () => {
    const bytes = await bytesOf(RICH_URL);
    const res = await convertPdfToAst({}, { userId: 'u1', filename: 'rich.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.ocrUsed).toBe(false);
    expect(res.value.classification.azurePages).toBeUndefined();
    const lessons = res.value.book.lessons;
    expect(lessons).toHaveLength(3);
    // legacy characterization（P1-B replacement target）：lesson_number 是位置计数器，
    // 不是教材真实课号（線上錯位：復習A 拿 3 号）。P1-B 后 ordering 看 sort_order。
    expect(lessons.map((l) => l.lessonNumber)).toEqual([1, 2, 3]);
    const review = lessons.find((l) => l.title.includes('復習A'));
    expect(review?.lessonNumber).toBe(3);
    // 前言（まえがき）无切课标记，并入第 1 課；付録并入復習A
    expect(lessons[0]?.dialogues.length).toBeGreaterThanOrEqual(9);
    expect(lessons[2]?.dialogues.length).toBe(4);
    // ことば/文法/練習段落当前不进 AST（缺口锁定，哪天提取了这里变红提醒补 E2E）
    for (const l of lessons) {
      expect(l.vocabularies).toEqual([]);
      expect(l.grammarPoints).toEqual([]);
      expect(l.exercises ?? []).toEqual([]);
    }
  }, 120000);

  it('append：接力追加课数增长（smoke 2 课 + rich 3 课）', async () => {
    const smokeBytes = new Uint8Array(
      await Bun.file(new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url)).arrayBuffer()
    );
    const richBytes = await bytesOf(RICH_URL);
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const first = await importPdfDocument(
      {
        saveDocument: (doc) => repo.saveDocument(doc),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
      },
      { userId: 'u1', filename: 'smoke.pdf', bytes: smokeBytes }
    );
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const appended = await appendPdfToDocument(
      {
        saveDocument: (doc) => repo.saveDocument(doc),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
        getDocument: (id) => repo.getDocumentById(id),
      },
      { userId: 'u1', filename: 'rich.pdf', bytes: richBytes, documentId: first.value.document.id }
    );
    expect(isOk(appended)).toBe(true);
    if (!isOk(appended)) return;
    // smoke 出 2 课（OCR 回填后）+ rich 3 课 = 5 课，且续排不断号
    expect(appended.value.addedLessons).toBe(3);
    expect(appended.value.totalLessons).toBe(5);
    // P1-B：append 后最终 AST 数组顺序即 canonical 顺序；shred 落 sort_order 连续，
    // legacy lessonNumber（maxNo+1 续排）原样保留，两者不必相等
    const finalAst = tryParseTextbookAst(appended.value.document.astJson);
    expect(finalAst).not.toBeNull();
    if (!finalAst) return;
    expect(finalAst.lessons).toHaveLength(5);
    const shredRes = await repo.shredDocument(first.value.document.id, finalAst);
    expect(isOk(shredRes)).toBe(true);
    const dbRows = repo
      .getRawDb()
      .query(
        'SELECT lesson_number AS n, sort_order AS s FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order'
      )
      .all(first.value.document.id) as Array<{ n: number; s: number }>;
    expect(dbRows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(dbRows.map((r) => r.s)).toEqual([1, 2, 3, 4, 5]);
  }, 180000);
});

describe('P3.2B 目录基线真 E2E（本机运行时，rich TOC 页）', () => {
  it('同行有尾数走文本+span验证；J1 断行有页；前置頁碼只计 unresolved（不猜）', async () => {
    const bytes = await bytesOf(RICH_URL);
    const res = await extractTocBaseline({}, { userId: 'u1', filename: 'rich.pdf', bytes, fromPage: 1, toPage: 1 });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.verdict).toBe('usable');
    expect(res.value.entries).toEqual([
      { title: '第1課 はじめまして ................', printedPage: 2, level: 1, source: 'geometry-block', kind: 'lesson' },
      { title: '第2課 これは本です ................', printedPage: 3, level: 1, source: 'geometry-block', kind: 'lesson' },
      { title: '復習A ............................', printedPage: 4, level: 1, source: 'geometry-block', kind: 'lesson' },
      { title: '付録 .............................', printedPage: 5, level: 2, source: 'geometry-block', kind: 'section' },
      { title: '第3課 さんぽ …………………', printedPage: 30, level: 1, source: 'text-fallback', kind: 'lesson' },
    ]);
    // `31 第4課 てんき` 为同行前置页码（非 P3.2B 三形之列，不猜，只计未定位）
    expect(res.value.diagnostics.unresolvedBlocks).toBe(1);
    expect(res.value.diagnostics.entriesFromBlocks).toBe(0);
  }, 120000);
});

describe('pdf-import 扫描页（本机 OCR 运行时）', () => {  it('无字形状页：走 OCR → 零产出友好失败，不崩不打云', async () => {
    const bytes = await bytesOf(SCAN_URL);
    const res = await convertPdfToAst({}, { userId: 'u1', filename: 'scan.pdf', bytes });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_OCR_LANG_UNSUPPORTED');
    // 文案不得断言具体语种（空白页/纯图页同样零产出）
    expect(res.error.userMessage).not.toContain('韩语');
    expect(res.error.retryable).toBe(false);
  }, 180000);
});
