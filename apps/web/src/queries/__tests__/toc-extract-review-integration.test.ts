import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { BusinessError, err, ok } from '@study-studio/shared';
import { createPdfImportRoutes } from '../../../../gateway/src/modules/library/http/pdf-import-routes.js';
import {
  TOC_DRAFT_TOOL_NAME,
  tocDraftReplaceAllTool,
} from '../../../../gateway/src/modules/library/application/pdf-import/toc-draft-tool.js';
import { pinProcessToTestRuntime, ensurePdfTestRuntime } from '../../../../gateway/src/modules/library/__tests__/pdf-test-runtime.js';
import { DEFAULT_GATEWAY_BASE_URL, configureGatewayBaseUrl } from '../../lib/api-client.js';
import type { TocReviewDraftEntry } from '../../lib/toc-confirm-flow.js';
import { GatewayRequestError } from '../../lib/gateway-error.js';
import { requestExtractTocBaseline, requestReviewToc } from '../textbooks-annotations.js';

/**
 * CMD-LINGUA-P3.1B Gateway + Web 真实 HTTP 集成回归（真 native + 真 server + 真 Web 客户端）。
 *
 * - 临时 Bun.serve 全挂载 pdf-import 路由（非 app.request），真实 fetch；
 * - Web 侧用生产 requestExtractTocBaseline / requestReviewToc（经 configureGatewayBaseUrl 指向临时服务）；
 * - 合成文本目录 PDF（2 页 Lesson 形，无私人内容）→ usable 基线 → fenced 草稿成功；
 *   同 PDF + 坏模型 → unavailable 200（非 502）；空白 PDF → thin 拒绝 + extract empty；
 * - 真临时文件（os.tmpdir，用后即删）；test-runtime 钉死，永不读写生产路径。
 */

pinProcessToTestRuntime();
await ensurePdfTestRuntime();

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

function syntheticTextTocPdf(): Uint8Array {
  const line = (text: string): string => `BT /F1 24 Tf 100 700 Td (${text}) Tj ET\n`;
  const pageObj = (contentRef: number): string =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 7 0 R >> >> >>`;
  const streamObj = (text: string): string =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    pageObj(5),
    pageObj(6),
    streamObj(line('Lesson 1 Apple 12')),
    streamObj(line('Lesson 2 Orange 30')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

function syntheticBlankPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

/** 内存 synthetic：3 页目录（仅 1 条同行页码 → thin，但证据有信号），无私人内容。 */
function syntheticSingleLineTocPdf(): Uint8Array {
  const line = (text: string): string => `BT /F1 24 Tf 100 700 Td (${text}) Tj ET\n`;
  const pageObj = (contentRef: number): string =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 8 0 R >> >> >>`;
  const streamObj = (text: string): string =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    pageObj(6),
    pageObj(7),
    pageObj(8),
    streamObj(line('Contents')),
    streamObj(line('Lesson 1 Apple Pie 12')),
    streamObj(line('Lesson 2 Orange')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** 内存 synthetic：3 页无页码目录（empty 可重建用），无私人内容。 */
function syntheticUnnumberedTocPdf(): Uint8Array {
  const line = (text: string): string => `BT /F1 24 Tf 100 700 Td (${text}) Tj ET\n`;
  const pageObj = (contentRef: number): string =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 8 0 R >> >> >>`;
  const streamObj = (text: string): string =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    pageObj(6),
    pageObj(7),
    pageObj(8),
    streamObj(line('Contents')),
    streamObj(line('Lesson 1 Apple')),
    streamObj(line('Lesson 2 Orange')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** 内存 synthetic：1 页普通正文（证据不足用），无私人内容。 */
function syntheticProsePdf(): Uint8Array {
  const text = 'BT /F1 24 Tf 100 700 Td (This is body text for testing.) Tj ET\n';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** 版式块双栏目录页内容：标题左（x=50）、页码右（x=450）同行，无私人内容。 */
function twoColumnPageContent(heading: string, page: string): string {
  return (
    `BT /F1 24 Tf 50 700 Td (${heading}) Tj ET\n` + `BT /F1 24 Tf 450 700 Td (${page}) Tj ET\n`
  );
}

/** 内存 synthetic：2 页双栏目录（标题与页码分列，无同行尾数），无私人内容。 */
function syntheticTwoColumnTocPdf(): Uint8Array {
  const pageObj = (contentRef: number): string =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 8 0 R >> >> >>`;
  const streamObj = (text: string): string =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    pageObj(5),
    pageObj(6),
    streamObj(twoColumnPageContent('Lesson 1 Apple', '12')),
    streamObj(twoColumnPageContent('Lesson 2 Orange', '30')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** 内存 synthetic：2 页跨行目录（标题行 + 独立页码行，无同行尾数），无私人内容。 */
function syntheticSplitLineTocPdf(): Uint8Array {
  // y-gap 取 50pt（探针实测：fork markdown 在 gap≥45 时不再合并数字行，
  // 块容差 2.2×24=52.8pt 仍覆盖——文本零条目、块必须命中）。
  const pageContent = (heading: string, page: string): string =>
    `BT /F1 24 Tf 50 700 Td (${heading}) Tj ET\n` + `BT /F1 24 Tf 50 650 Td (${page}) Tj ET\n`;
  const pageObj = (contentRef: number): string =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 8 0 R >> >> >>`;
  const streamObj = (text: string): string =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    pageObj(5),
    pageObj(6),
    streamObj(pageContent('Lesson 3 Banana', '44')),
    streamObj(pageContent('Lesson 4 Grape', '58')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** 工具通道脚本：text=自然语言（忽略）；tool=真实工具执行（生产 adapter 行为）。 */
type ToolStep = { kind: 'text'; text: string } | { kind: 'tool'; input: unknown };

/** 脚本队列假通道：按步骤吐事件，tool 步骤同步跑真实工具 execute。 */
function fakeAdapter(steps: ToolStep[]) {
  const session = {
    sessionId: 'sess-it',
    threadId: 'thread-it',
    send: async function* (input: unknown) {
      void input;
      let callSeq = 0;
      for (const step of steps) {
        if (step.kind === 'text') {
          yield { type: 'TEXT_DELTA', delta: step.text };
        } else {
          callSeq++;
          const callId = `call-it-${callSeq}`;
          yield { type: 'TOOL_CALL_REQUESTED', callId, toolName: TOC_DRAFT_TOOL_NAME, input: step.input as Record<string, unknown> };
          await tocDraftReplaceAllTool.execute(step.input, { userId: 'u1', sessionId: 'sess-it' });
          yield { type: 'TOOL_CALL_COMPLETED', callId, result: { status: 'completed', success: true } };
        }
      }
      yield { type: 'COMPLETED' };    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  return {
    id: 'it-fake-review',
    name: 'IT fake review adapter',
    supportsImageInput: () => true,
    createSession: async () => ok(session),
    resumeSession: async () => err(new BusinessError('E_CODEX_SESSION', 'it 不支持恢复', 'AGENT_RUNTIME')),
  };
}

const servers: Array<{ stop: () => void }> = [];
const tempFiles: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    try {
      s.stop();
    } catch {
      // 已停
    }
  }
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      // 已删
    }
  }
  configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
});

async function writeTempPdf(bytes: Uint8Array): Promise<string> {
  const tmp = join(tmpdir(), `p31b-it-${process.pid}-${Date.now()}.pdf`);
  await Bun.write(tmp, bytes);
  tempFiles.push(tmp);
  return tmp;
}

function serve(steps: ToolStep[]): string {
  const app = createPdfImportRoutes(
    { repo: {} as never, server: { agentAdapter: fakeAdapter(steps) } as never, port: 0 },
  );
  const server = Bun.serve({ port: 0, fetch: (req) => app.fetch(req) });
  servers.push(server);
  return `http://localhost:${server.port}`;
}

const TOOL_DRAFT_OK: { entries: TocReviewDraftEntry[]; warnings: string[] } = {
  entries: [
    { title: 'Lesson 1 Apple', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
    { title: 'Lesson 2 Orange', printedPage: 30, level: 1, kind: 'lesson', confidence: 'medium' },
  ],
  warnings: [],
};

describe('P3.4A extract+review 真实 HTTP 集成', () => {
  it('文本目录：extract usable + 证据有界；乱说 + 合法工具调用 → 草稿成功（200）', async () => {
    const url = serve([
      { kind: 'text', text: '这是目录：{"entries": [{"title": "编造课", "printedPage": 999}], "warnings": []}' },
      { kind: 'tool', input: TOOL_DRAFT_OK },
    ]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticTextTocPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(baseline.verdict).toBe('usable');
      expect(baseline.entries.length).toBe(2);
      expect(baseline.pageEvidence.length).toBe(2);
      for (const evidence of baseline.pageEvidence) {
        expect(evidence.excerpt.length).toBeLessThanOrEqual(1506);
      }
      expect(baseline.pageEvidence[0]?.excerpt).toContain('Lesson 1 Apple');

      const review = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(review.reviewStatus).toBe('ok');
      expect(review.reviewError).toBeNull();
      expect(review.draft?.entries).toEqual(TOOL_DRAFT_OK.entries);
      expect(JSON.stringify(review)).not.toContain('编造课');
      expect(review.baseline.verdict).toBe('usable');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('无工具调用：unavailable E_TOC_REVIEW_NO_TOOL_CALL（200，非 502），基线保留', async () => {
    const url = serve([{ kind: 'text', text: '我不知道，你自己看图吧' }]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticTextTocPdf());
      const review = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(review.reviewStatus).toBe('unavailable');
      expect(review.draft).toBeNull();
      expect(review.reviewError?.code).toBe('E_TOC_REVIEW_NO_TOOL_CALL');
      expect(typeof review.reviewError?.userMessage).toBe('string');
      expect(review.baseline.entries.length).toBe(2);
      expect(review.baseline.verdict).toBe('usable');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('空白 PDF：extract empty + review 400 thin 拒绝（可读码）', async () => {
    const url = serve([]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticBlankPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(baseline.verdict).toBe('empty');
      expect(baseline.entries).toEqual([]);
      const err = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 2 }).then(
        () => null,
        (e: unknown) => e
      );
      expect(err instanceof GatewayRequestError).toBe(true);
      expect((err as GatewayRequestError).code).toBe('E_TOC_EVIDENCE_INSUFFICIENT');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.2 thin 单行：extract thin → 工具重建 ≥2 条草稿（200）', async () => {
    const toolInput = {
      entries: [
        { title: 'Lesson 1 Apple Pie', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
        { title: 'Lesson 2 Orange', printedPage: 30, level: 1, kind: 'lesson', confidence: 'medium' },
      ],
      warnings: [],
    };
    const url = serve([{ kind: 'tool', input: toolInput }]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticSingleLineTocPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 3 });
      expect(baseline.verdict).toBe('thin');
      expect(baseline.entries.length).toBe(1);
      const review = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 3 });
      expect(review.reviewStatus).toBe('ok');
      expect(review.draft?.entries.length).toBe(2);
      expect(review.baseline.verdict).toBe('thin');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.4A 两次非法工具参数：unavailable E_TOC_REVIEW_TOOL_INVALID（200，非 502）', async () => {
    const regress = {
      entries: [
        { title: 'Lesson 1 Apple', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
        { title: 'Lesson 2 Orange', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
      ],
      warnings: [],
    };
    const url = serve([{ kind: 'tool', input: regress }, { kind: 'tool', input: regress }]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticTextTocPdf());
      const review = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(review.reviewStatus).toBe('unavailable');
      expect(review.draft).toBeNull();
      expect(review.reviewError?.code).toBe('E_TOC_REVIEW_TOOL_INVALID');
      expect(review.baseline.entries.length).toBe(2);
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.2A 无页码目录：extract empty → 工具重建 ≥2 条（200）', async () => {
    const toolInput = {
      entries: [
        { title: 'Lesson 1 Apple', printedPage: 5, level: 1, kind: 'lesson', confidence: 'medium' },
        { title: 'Lesson 2 Orange', printedPage: 9, level: 1, kind: 'lesson', confidence: 'medium' },
      ],
      warnings: ['页码来自图片核对'],
    };
    const url = serve([{ kind: 'tool', input: toolInput }]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticUnnumberedTocPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 3 });
      expect(baseline.verdict).toBe('empty');
      expect(baseline.entries).toEqual([]);
      const review = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 3 });
      expect(review.reviewStatus).toBe('ok');
      expect(review.draft?.entries.length).toBe(2);
      expect(review.baseline.verdict).toBe('empty');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.2A 普通正文：empty 且无信号 → review 400，零 Agent 调用等价（可读码）', async () => {
    const url = serve([]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticProsePdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 1 });
      expect(baseline.verdict).toBe('empty');
      const err = await requestReviewToc('u1', { filePath: tmp }, { startPage: 1, endPage: 1 }).then(
        () => null,
        (e: unknown) => e
      );
      expect(err instanceof GatewayRequestError).toBe(true);
      expect((err as GatewayRequestError).code).toBe('E_TOC_EVIDENCE_INSUFFICIENT');
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.2B 双栏目录：标题页码分列 → extract usable 且条目正确', async () => {
    // 探针实测：fork 会把同行两列合并成一行 markdown（`## Lesson 1 Apple 12`，
    // `##` 前缀为既有行为，旧测试亦不断言标题原文），故走文本路径
    // （text-fallback）；本用例锁定端到端正确性，块归因由跨行用例锁定。
    const url = serve([]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticTwoColumnTocPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(baseline.verdict).toBe('usable');
      expect(baseline.entries).toHaveLength(2);
      for (const entry of baseline.entries) {
        expect(entry.kind).toBe('lesson');
      }
      const byTitle = new Map(
        baseline.entries.map((e) => [e.title.replace(/^#+\s*/, ''), e.printedPage])
      );
      expect(byTitle.get('Lesson 1 Apple')).toBe(12);
      expect(byTitle.get('Lesson 2 Orange')).toBe(30);
      expect(baseline.diagnostics.entriesFromBlocks).toBe(0);
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);

  it('P3.2B 跨行目录：标题行+独立页码行 → 文本零条目、块补 2 条 geometry-block', async () => {
    const url = serve([]);
    configureGatewayBaseUrl(url);
    try {
      const tmp = await writeTempPdf(syntheticSplitLineTocPdf());
      const baseline = await requestExtractTocBaseline('u1', { filePath: tmp }, { startPage: 1, endPage: 2 });
      expect(baseline.verdict).toBe('usable');
      expect(baseline.entries).toHaveLength(2);
      const byTitle = new Map(baseline.entries.map((e) => [e.title, e.printedPage]));
      expect(byTitle.get('Lesson 3 Banana')).toBe(44);
      expect(byTitle.get('Lesson 4 Grape')).toBe(58);
      for (const entry of baseline.entries) {
        expect(entry.source).toBe('geometry-block');
      }
      expect(baseline.diagnostics.entriesFromBlocks).toBe(2);
      expect(baseline.diagnostics.unresolvedBlocks).toBe(0);
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  }, 180000);
});
