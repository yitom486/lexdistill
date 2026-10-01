import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import {
  convertPdfToAst,
  importPdfDocument,
  mapPdfPages,
} from '../application/pdf-import/pdf-import-service.js';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * PDF 导入集成测试（fixture = smoke-native-2lessons.pdf，2 页日语教材）。
 *
 * 三层（native E2E 永不 skip）：
 * 1. 真 E2E（测试拥有的 pinned 运行时，见 pdf-test-runtime.ts；就绪失败即整文件失败）；
 * 2. 不启用 OCR 单元测试（mock inspector 计数取证：processPdfWithOcr 零调用）；
 * 3. 入库集成（:memory: 库，跑完即弃，生产库零接触）。
 *
 * 重要发现（实测，非假设）：该文件虽名含 native，实无文本层（内容流无 BT/Tj，
 * 疑似文字转曲），inspector 判 TextBased 但两页均 thin（<50 字）→ 触发 OCR 回填，
 * OCR 后正常拆出 2 课。E2E 断言以此真实行为为准；"厚文本页跳过 OCR" 由 mock 单测锁定。
 *
 * fixture 内容：2 课（第1課/第2課）× 会話（アキ/ミナ）+ ことば + 文法 + 練習。
 * 已知缺口（后续 richer fixture 覆盖）：无目录页、无真扫描页、无 復習/附录非数字章节。
 */
// 测试进程默认运行时钉到测试目录（显式 env 优先）；随后 bootstrap，失败即抛（不 skip）。
pinProcessToTestRuntime();
await ensurePdfTestRuntime();
const FIXTURE_URL = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);

async function fixtureBytes(): Promise<Uint8Array> {
  const buf = await Bun.file(FIXTURE_URL).arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(0);
  return new Uint8Array(buf);
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

describe('smoke 文档型 PDF 不启用 OCR（mock 取证）', () => {
  it('processPdfWithOcr 零调用 + ocrUsed=false + 无 azurePages', async () => {
    const bytes = await fixtureBytes();
    let ocrCalls = 0;
    const inspector: PdfInspectorLike = {
      processPdf: () => ({
        pdfType: 'native',
        pageCount: 2,
        markdown: '# 第1課\nアキ：はじめまして。\n# 第2課\nミナ：はい。\n',
        pagesNeedingOcr: [],
      }),
      processPdfWithOcr: async () => {
        ocrCalls++;
        return { markdown: '', pages: [] };
      },
    };
    const res = await convertPdfToAst(
      { loadInspector: async () => inspector },
      { userId: 'u1', filename: 'smoke.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(ocrCalls).toBe(0);
    expect(res.value.classification.ocrUsed).toBe(false);
    expect(res.value.classification.pagesNeedingOcr).toEqual([]);
    expect(res.value.classification.azurePages).toBeUndefined();
    expect(res.value.book.lessons).toHaveLength(2);
  });
});

describe('CMD-08 全部页扫描超限改夹持（mock，不碰原生）', () => {
  it('35 页全需 OCR 的全部页 convert：不 err，对 1–30 窗转换 + clampedFromAll', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 mock-clamp');
    const expectedWindow = Array.from({ length: 30 }, (_, i) => i + 1);
    let ocrWindows: Array<number[] | undefined> = [];
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const inspector: PdfInspectorLike = {
      processPdf: (_pdf, pages) => {
        classifyCalls.push(pages);
        return {
          pdfType: 'Scanned',
          pageCount: 35,
          markdown: '',
          pagesNeedingOcr: Array.from({ length: 35 }, (_, i) => i + 1),
        };
      },
      processPdfWithOcr: async (_pdf, options) => {
        ocrWindows.push(options?.pageNumbers);
        return { markdown: '# 第1課\nアキ：はじめまして。\n# 第2課\nミナ：はい。\n' };
      },
    };
    const res = await convertPdfToAst(
      { loadInspector: async () => inspector },
      { userId: 'u1', filename: 'scan35.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 第一次就成功：窗内转换，selectedPages 即该窗，不走错误
    expect(res.value.classification.selectedPages).toEqual(expectedWindow);
    expect(res.value.classification.clampedFromAll).toBe(true);
    expect(res.value.classification.ocrUsed).toBe(true);
    expect(ocrWindows).toEqual([expectedWindow]);
    expect(res.value.book.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    // CMD-10：未选页 processPdf 必带 ≤30 页窗，禁止无窗口扫全书
    expect(classifyCalls.length).toBeGreaterThan(0);
    for (const w of classifyCalls) {
      expect(Array.isArray(w)).toBe(true);
      if (!Array.isArray(w)) continue;
      expect(w.length).toBeGreaterThan(0);
      expect(w.length).toBeLessThanOrEqual(30);
    }
  });

  it('30 页整不触发夹持（边界）', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 mock-boundary');
    const inspector: PdfInspectorLike = {
      processPdf: () => ({
        pdfType: 'Scanned',
        pageCount: 30,
        markdown: '',
        pagesNeedingOcr: Array.from({ length: 30 }, (_, i) => i + 1),
      }),
      processPdfWithOcr: async () => ({
        markdown: '# 第1課\nアキ：はじめまして。\n',
      }),
    };
    const res = await convertPdfToAst(
      { loadInspector: async () => inspector },
      { userId: 'u1', filename: 'scan30.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.selectedPages).toEqual([]);
    expect(res.value.classification.clampedFromAll).toBeUndefined();
  });

  it('CMD-10 map 未选页：只开窗分类，页数仍诚实为全书', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 mock-map-window');
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const inspector: PdfInspectorLike = {
      processPdf: (_pdf, pages) => {
        classifyCalls.push(pages);
        return {
          pdfType: 'Scanned',
          pageCount: 35,
          markdown: '',
          pagesNeedingOcr: Array.from({ length: 35 }, (_, i) => i + 1),
        };
      },
      processPdfWithOcr: async () => ({
        markdown: '# 第1課\nアキ：はじめまして。\n',
      }),
    };
    const res = await mapPdfPages(
      { loadInspector: async () => inspector },
      { userId: 'u1', filename: 'scan35.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(35);
    expect(res.value.window).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(classifyCalls.length).toBeGreaterThan(0);
    for (const w of classifyCalls) {
      expect(Array.isArray(w)).toBe(true);
      if (!Array.isArray(w)) continue;
      expect(w.length).toBeGreaterThan(0);
      expect(w.length).toBeLessThanOrEqual(30);
    }
  });
});

describe('smoke 真 E2E（本机运行时）', () => {
  it('convert：2 页走 OCR 回填（无文本层）+ 2 课 + 说话人齐全 + 不碰 Azure', async () => {
    const bytes = await fixtureBytes();
    const res = await convertPdfToAst({}, { userId: 'u1', filename: 'smoke.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(2);
    // 实现象：两页 thin → OCR 回填；未传 azure 凭据 → 云不打
    expect(res.value.classification.pagesNeedingOcr).toEqual([1, 2]);
    expect(res.value.classification.ocrUsed).toBe(true);
    expect(res.value.classification.azurePages).toBeUndefined();
    expect(res.value.book.lessons).toHaveLength(2);
    const speakers = new Set(
      res.value.book.lessons.flatMap((l) => l.dialogues.map((d) => d.speaker))
    );
    expect(speakers.has('アキ')).toBe(true);
    expect(speakers.has('ミナ')).toBe(true);
    expect(res.value.stats.lessons).toBe(2);
    expect(res.value.stats.dialogues).toBeGreaterThan(0);
  }, 120000);

  it('map：结构预览页数对齐', async () => {
    const bytes = await fixtureBytes();
    const res = await mapPdfPages({}, { userId: 'u1', filename: 'smoke.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(2);
    expect(Array.isArray(res.value.headings)).toBe(true);
    expect(Array.isArray(res.value.tocEntries)).toBe(true);
  }, 120000);
});

describe('smoke 入库集成（:memory:，跑完即弃）', () => {
  it('import + shred 落库行数对齐，生产库零接触', async () => {
    const bytes = await fixtureBytes();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const res = await importPdfDocument(
      {
        saveDocument: (doc) => repo.saveDocument(doc),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
        projectLinesSegments: (userId, documentId) => repo.projectLinesSegments(userId, documentId),
      },
      { userId: 'u1', filename: 'smoke.pdf', bytes }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.document.sourceKind).toBe('user_import');
    // shred 走同一领域能力（与线上回填同路径）
    const shredded = await repo.shredDocument(res.value.document.id, res.value.book);
    expect(isOk(shredded)).toBe(true);
    const db = repo.getRawDb();
    const count = (sql: string, id: string): number =>
      (db.query(sql).get(id) as { n: number }).n;
    const docId = res.value.document.id;
    expect(count('SELECT coalesce(json_array_length(chapters_json),0) AS n FROM documents WHERE id = ?', docId)).toBe(2);
    expect(
      count('SELECT COUNT(*) AS n FROM (SELECT document_id FROM textbook_articles UNION ALL SELECT document_id FROM textbook_sentences) WHERE document_id = ?', docId)
    ).toBe(res.value.stats.dialogues);
    expect(count('SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ?', docId)).toBeGreaterThan(0);
  }, 120000);
});
