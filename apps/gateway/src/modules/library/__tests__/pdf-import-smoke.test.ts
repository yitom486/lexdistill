import { describe, expect, it, afterEach, beforeAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { defaultRuntimeDir } from '../../../infrastructure/persistence/app-paths.js';
import {
  convertPdfToAst,
  importPdfDocument,
  mapPdfPages,
} from '../application/pdf-import/pdf-import-service.js';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';

/**
 * PDF 导入集成测试（fixture = smoke-native-2lessons.pdf，2 页日语教材）。
 *
 * 三层：
 * 1. 真 E2E（本机 pdf-inspector 运行时，离线可跑；缺运行时则 skip，CI 不红）；
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
const FIXTURE_URL = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);

async function fixtureBytes(): Promise<Uint8Array> {
  const buf = await Bun.file(FIXTURE_URL).arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(0);
  return new Uint8Array(buf);
}

function hasNativeRuntime(): boolean {
  try {
    return existsSync(join(defaultRuntimeDir(), 'manifest.json'));
  } catch {
    return false;
  }
}

const NATIVE = hasNativeRuntime();
const itNative = NATIVE ? it : it.skip;

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

beforeAll(() => {
  if (!NATIVE) {
    console.warn('[pdf-import-smoke] 本机无 pdf-inspector 运行时，真 E2E 用例 skip（mock 覆盖照常跑）');
  }
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

describe('smoke 真 E2E（本机运行时）', () => {
  itNative('convert：2 页走 OCR 回填（无文本层）+ 2 课 + 说话人齐全 + 不碰 Azure', async () => {
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

  itNative('map：结构预览页数对齐', async () => {
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
  itNative('import + shred 落库行数对齐，生产库零接触', async () => {
    const bytes = await fixtureBytes();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const res = await importPdfDocument(
      { saveDocument: (doc) => repo.saveDocument(doc) },
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
    expect(count('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?', docId)).toBe(2);
    expect(
      count('SELECT COUNT(*) AS n FROM textbook_lines WHERE document_id = ?', docId)
    ).toBe(res.value.stats.dialogues);
    expect(count('SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ?', docId)).toBeGreaterThan(0);
  }, 120000);
});
