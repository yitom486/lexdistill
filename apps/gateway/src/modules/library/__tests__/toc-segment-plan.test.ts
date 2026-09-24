import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { isOk, logger } from '@study-studio/shared';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { previewTocSegments, fingerprintTocPlan, sha256HexBytes } from '@study-studio/content';
import { planTocSegments } from '../application/pdf-import/toc-segment-plan.js';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P5C 分段预览编排（mock + 真机位）。
 * 服务只做 `[1]` 探页数 + 调 P5-A 纯函数：零 OCR/Agent/render/DB/AST/shred。
 */

interface PlanMockCalls {
  load: number;
  classify: number[][];
  ocr: number;
  render: number;
}

function planMock(args: { pageCount: number; calls: PlanMockCalls }): PdfInspectorLike {
  return {
    processPdf: (_pdf, pages) => {
      args.calls.classify.push(pages ?? []);
      return { pdfType: 'TextBased', pageCount: args.pageCount, markdown: '', pagesNeedingOcr: [] };
    },
    processPdfWithOcr: async () => {
      args.calls.ocr++;
      return { markdown: '', pages: [] };
    },
    renderPdfPages: async () => {
      args.calls.render++;
      return [];
    },
  };
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-segment-plan');
}

const ENTRIES = [
  { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
  { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
];

const ANCHORS = [
  { printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const },
  { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed' as const },
];

describe('P5C planTocSegments（mock）', () => {
  it('仅 [1] 探针；输出与 P5-A 纯函数一致；零 OCR/渲染', async () => {
    const calls: PlanMockCalls = { load: 0, classify: [], ocr: 0, render: 0 };
    const res = await planTocSegments(
      {
        loadInspector: async () => {
          calls.load++;
          return planMock({ pageCount: 100, calls });
        },
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: ENTRIES, anchors: ANCHORS }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 与纯函数同输入同输出（服务只是探页数 + 透传 + 指纹）
    const pure = previewTocSegments({ pageCount: 100, entries: ENTRIES, anchors: ANCHORS });
    expect(isOk(pure)).toBe(true);
    if (!isOk(pure)) return;
    const { fingerprint: _fp, ...pureRest } = pure.value as unknown as Record<string, unknown>;
    void _fp;
    const { fingerprint, ...rest } = res.value as unknown as Record<string, unknown>;
    expect(rest).toEqual(pureRest);
    // 指纹即规范重算（P5-D1 导入核验同一函数）
    expect(fingerprint).toBe(
      fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: ENTRIES, anchors: ANCHORS })
    );
    expect(res.value.lessons[0]).toMatchObject({ printedStart: 12, physicalStart: 17, physicalEnd: 34 });
    expect(calls.classify).toEqual([[1]]);
    expect(calls.ocr).toBe(0);
    expect(calls.render).toBe(0);
  });

  it('无效 anchor / 越界 / 重复条目明确失败', async () => {
    const run = async (entries: unknown, anchors: unknown) =>
      planTocSegments(
        { loadInspector: async () => planMock({ pageCount: 100, calls: { load: 0, classify: [], ocr: 0, render: 0 } }) },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries, anchors }
      );
    for (const [entries, anchors] of [
      [ENTRIES, [{ printedPage: 12, physicalPage: 17, evidence: 'model-confidence' }]],
      [ENTRIES, [{ printedPage: 12, physicalPage: 500, evidence: 'human-confirmed' }]],
      [
        [
          { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
          { title: '第2課', printedPage: 12, level: 1, kind: 'lesson' },
        ],
        ANCHORS,
      ],
      ['not-array', ANCHORS],
      [ENTRIES, 'not-array'],
    ] as Array<[unknown, unknown]>) {
      const res = await run(entries, anchors);
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_INVALID_INPUT');
    }
  });

  it('缺 entries/anchors 直接拒绝', async () => {
    const res = await planTocSegments(
      { loadInspector: async () => planMock({ pageCount: 100, calls: { load: 0, classify: [], ocr: 0, render: 0 } }) },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), entries: undefined, anchors: undefined }
    );
    expect(isOk(res)).toBe(false);
  });

  it('日志只记计数：不含标题、anchor 详情、文件名、userId', async () => {
    const captured: unknown[][] = [];
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]): void => {
      captured.push(args);
    };
    try {
      const res = await planTocSegments(
        { loadInspector: async () => planMock({ pageCount: 100, calls: { load: 0, classify: [], ocr: 0, render: 0 } }) },
        { userId: 'u-log-probe-5', filename: 'secret-plan-file.pdf', bytes: mockBytes(), entries: ENTRIES, anchors: ANCHORS }
      );
      expect(isOk(res)).toBe(true);
    } finally {
      logger.warn = originalWarn;
    }
    const dumped = JSON.stringify(captured);
    expect(dumped).not.toContain('第1課');
    expect(dumped).not.toContain('u-log-probe-5');
    expect(dumped).not.toContain('secret-plan-file.pdf');
    expect(dumped).not.toContain('human-confirmed');
  });
});

function buildPdf(objects: string[]): Uint8Array {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefAt = Buffer.byteLength(parts.join(''));
  const n = objects.length + 1;
  parts.push(`xref\n0 ${n}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i < n; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

function syntheticBlankPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

const repos: DrizzleLearnerRepository[] = [];
const tempFiles: string[] = [];
afterEach(async () => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      /* 已删或从未落盘 */
    }
  }
});

describe('P5C POST preview-toc-segments（真运行时探针 + 自造 PDF）', () => {
  it('有效输入 200 映射；无效/单条目 400；DB 行数不变', async () => {
    pinProcessToTestRuntime();
    await ensurePdfTestRuntime();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const tmp = join(tmpdir(), `p5c-plan-${process.pid}-${Date.now()}.pdf`);
    await Bun.write(tmp, syntheticBlankPdf());
    tempFiles.push(tmp);
    const before = await repo.listDocuments('u1');

    const okRes = await app.request('/api/documents/u1/preview-toc-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: tmp,
        entries: [
          { title: '第1課', printedPage: 1, level: 1, kind: 'lesson' },
          { title: '第2課', printedPage: 2, level: 1, kind: 'lesson' },
        ],
        anchors: [
          { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' },
          { printedPage: 2, physicalPage: 2, evidence: 'human-confirmed' },
        ],
      }),
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      pageCount: number;
      lessons: Array<{ printedStart: number; physicalStart: number | null; status: string }>;
      diagnostics: { mappedCount: number };
    };
    expect(body.pageCount).toBe(2);
    expect(body.lessons[0]).toMatchObject({ printedStart: 1, physicalStart: 1, status: 'mapped' });
    expect(body.diagnostics.mappedCount).toBe(2);

    // P3.2 thin 永不 preview：单条目 400
    const single = await app.request('/api/documents/u1/preview-toc-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: tmp,
        entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' }],
        anchors: [{ printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' }],
      }),
    });
    expect(single.status).not.toBe(200);

    const bad = await app.request('/api/documents/u1/preview-toc-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: tmp,
        entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' }],
        anchors: [{ printedPage: 1, physicalPage: 9, evidence: 'human-confirmed' }],
      }),
    });
    expect(bad.status).not.toBe(200);
    const badBody = (await bad.json()) as { error?: { code?: string } };
    expect(badBody.error?.code).toBe('E_INVALID_INPUT');

    const missing = await app.request('/api/documents/u1/preview-toc-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp }),
    });
    expect(missing.status).not.toBe(200);

    const after = await repo.listDocuments('u1');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  }, 300000);
});

describe('P3.1B 下游标题门（preview 漏斗）', () => {
  it('无语义标题条目 → E_TOC_ENTRY_INVALID（带 issues 明细），正常条目放行', () => {
    const base = { pageCount: 100, anchors: ANCHORS };
    for (const title of ['##### ……', '···', '12', 'Page 5']) {
      const res = previewTocSegments({
        ...base,
        entries: [{ title, printedPage: 12, level: 1, kind: 'lesson' as const }, ENTRIES[1] as (typeof ENTRIES)[number]],
      });
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_TOC_ENTRY_INVALID');
      expect(res.error.userMessage).toContain('无语义');
      const details = res.error.internalDetails as { issues: Array<{ field: string }> };
      expect(details.issues[0]?.field).toBe('title');
    }
    const okRes = previewTocSegments({ ...base, entries: ENTRIES });
    expect(isOk(okRes)).toBe(true);
  });

  it('planTocSegments 服务层同样拒绝垃圾标题（prepare/import/execute 同漏斗）', async () => {
    const calls: PlanMockCalls = { load: 0, classify: [], ocr: 0, render: 0 };
    const res = await planTocSegments(
      {
        loadInspector: async () => {
          calls.load++;
          return planMock({ pageCount: 100, calls });
        },
      },
      {
        userId: 'u1',
        filename: 't.pdf',
        bytes: mockBytes(),
        entries: [{ title: '##### ……', printedPage: 322, level: 2, kind: 'section' as const }, ENTRIES[1] as (typeof ENTRIES)[number]],
        anchors: ANCHORS,
      }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_ENTRY_INVALID');
  });
});
