import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type {
  AgentAdapter,
  AgentEvent,
  AgentInput,
  AgentSession,
} from '@study-studio/agent-core';
import { BusinessError, isOk, ok } from '@study-studio/shared';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P4B review-toc HTTP 集成（真 native + 假 Agent，不调付费模型）。
 *
 * - PDF 为内存 synthetic 空白 2 页（无私人内容），经 filePath 直读；
 * - Agent 由 fake adapter 扮演：捕获 AgentInput、回固定 JSON；
 * - 零写证明：调用前后 listDocuments 行数不变。
 */
pinProcessToTestRuntime();
await ensurePdfTestRuntime();

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

interface CapturedCall {
  systemPrompt?: string;
  input: AgentInput;
}

function makeFakeAdapter(script: string, captured: CapturedCall[]): AgentAdapter {
  const session: AgentSession = {
    sessionId: 'sess-http-mock',
    threadId: 'thread-http-mock',
    send: async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
      yield { type: 'TEXT_DELTA', delta: script };
      yield { type: 'COMPLETED', finalOutput: script };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  return {
    id: 'mock-http-toc-review',
    name: 'Mock HTTP TOC Review Adapter',
    supportsImageInput: () => true,
    createSession: async (options) => {
      const capturing: AgentSession = {
        ...session,
        send: async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
          captured.push({ ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}), input });
          yield* session.send(input);
        },
      };
      return ok(capturing);
    },
    resumeSession: async () => ({
      ok: false as const,
      error: new BusinessError('E_CODEX_SESSION', 'mock 不支持恢复', 'AGENT_RUNTIME'),
    }),
  };
}

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

/** 内存 synthetic：2 空白页，无私人内容。 */
function syntheticBlankPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

/** 内存 synthetic：2 页文本目录（每页一行 Lesson 形），无私人内容。 */
function syntheticTextTocPdf(): Uint8Array {
  const line1 = 'BT /F1 24 Tf 100 700 Td (Lesson 1 Apple 12) Tj ET\n';
  const line2 = 'BT /F1 24 Tf 100 700 Td (Lesson 2 Orange 30) Tj ET\n';
  const pageObj = (contentRef: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 7 0 R >> >> >>`;
  const streamObj = (text: string) =>
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}endstream`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    pageObj(5),
    pageObj(6),
    streamObj(line1),
    streamObj(line2),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

async function writeTempPdf(bytes: Uint8Array): Promise<string> {
  const tmp = join(tmpdir(), `p4b-review-${process.pid}-${Date.now()}.pdf`);
  await Bun.write(tmp, bytes);
  tempFiles.push(tmp);
  return tmp;
}

async function postReviewToc(
  app: ReturnType<typeof createApp>,
  userId: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(`/api/documents/${userId}/review-toc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> };
}

async function documentCount(repo: DrizzleLearnerRepository, userId: string): Promise<number> {
  const res = await repo.listDocuments(userId);
  if (!isOk(res)) throw new Error('listDocuments failed');
  return res.value.length;
}

describe('P4B POST review-toc（真 native + 假 Agent）', () => {
  it('P3.1B 空白 synthetic：空基线服务端拒绝（E_TOC_BASELINE_THIN），Agent 零调用、DB 行数不变', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const captured: CapturedCall[] = [];
    const app = createApp({
      repo,
      server: { agentAdapter: makeFakeAdapter('{"entries":[],"warnings":["空白页，无目录"]}', captured) } as never,
      port: 0,
    });
    const tmp = await writeTempPdf(syntheticBlankPdf());
    const before = await documentCount(repo, 'u1');
    const res = await postReviewToc(app, 'u1', { filePath: tmp, startPage: 1, endPage: 2 });
    expect(res.status).not.toBe(200);
    expect((res.json.error as { code?: string } | undefined)?.code).toBe('E_TOC_BASELINE_THIN');
    expect(captured.length).toBe(0);
    const after = await documentCount(repo, 'u1');
    expect(after).toBe(before);
  }, 180000);

  it('P3.1B 文本目录 synthetic：围栏 JSON 成功进草稿，同一次 AgentInput 附件为真 PNG', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const captured: CapturedCall[] = [];
    const fenced = '```json\n{"entries": [{"title": "Lesson 1 Apple", "printedPage": 12, "level": 1, "kind": "lesson", "confidence": "high"}, {"title": "Lesson 2 Orange", "printedPage": 30, "level": 1, "kind": "lesson", "confidence": "medium"}], "warnings": []}\n```';
    const app = createApp({
      repo,
      server: { agentAdapter: makeFakeAdapter(fenced, captured) } as never,
      port: 0,
    });
    const tmp = await writeTempPdf(syntheticTextTocPdf());
    const before = await documentCount(repo, 'u1');
    const res = await postReviewToc(app, 'u1', { filePath: tmp, startPage: 1, endPage: 2 });
    expect(res.status).toBe(200);
    const body = res.json as {
      embedded: boolean;
      baseline: { status: string; verdict: string; entries: unknown[] };
      draft: { entries: unknown[]; warnings: string[] } | null;
      reviewStatus: string;
      reviewError: unknown;
      diagnostics: { pagesRendered: number };
    };
    expect(body.embedded).toBe(false);
    expect(body.baseline.verdict).toBe('usable');
    expect(body.reviewStatus).toBe('ok');
    expect(body.reviewError).toBeNull();
    expect(body.draft?.entries.length).toBe(2);
    expect(body.diagnostics.pagesRendered).toBe(2);
    expect(captured.length).toBe(1);
    const attachments = captured[0]?.input.attachments ?? [];
    expect(attachments.length).toBe(2);
    expect(JSON.stringify(captured)).not.toContain('iVBOR');
    const after = await documentCount(repo, 'u1');
    expect(after).toBe(before);
  }, 180000);

  it('P3.1B 模型坏 JSON：重试后 unavailable 200（非 502），基线保留、零写', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const captured: CapturedCall[] = [];
    const app = createApp({
      repo,
      server: { agentAdapter: makeFakeAdapter('garbage {{{', captured) } as never,
      port: 0,
    });
    const tmp = await writeTempPdf(syntheticTextTocPdf());
    const before = await documentCount(repo, 'u1');
    const res = await postReviewToc(app, 'u1', { filePath: tmp, startPage: 1, endPage: 2 });
    expect(res.status).toBe(200);
    const body = res.json as {
      reviewStatus: string;
      draft: unknown;
      reviewError: { code?: string; userMessage?: string };
      baseline: { status: string; verdict: string; entries: unknown[] };
    };
    expect(body.reviewStatus).toBe('unavailable');
    expect(body.draft).toBeNull();
    expect(body.reviewError?.code).toBe('E_TOC_REVIEW_PARSE');
    expect(typeof body.reviewError?.userMessage).toBe('string');
    expect(body.baseline.verdict).toBe('usable');
    expect(body.baseline.entries.length).toBe(2);
    // 同 session 重试一次：两次 send，一次 create
    expect(captured.length).toBe(2);
    expect(await documentCount(repo, 'u1')).toBe(before);
  }, 180000);

  it('缺范围 / 超 8 页：4xx E_INVALID_INPUT，Agent 零调用', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const captured: CapturedCall[] = [];
    const app = createApp({
      repo,
      server: { agentAdapter: makeFakeAdapter('{"entries":[],"warnings":[]}', captured) } as never,
      port: 0,
    });
    const tmp = await writeTempPdf(syntheticBlankPdf());
    const before = await documentCount(repo, 'u1');
    const missing = await postReviewToc(app, 'u1', { filePath: tmp });
    expect(missing.status).not.toBe(200);
    expect((missing.json.error as { code?: string } | undefined)?.code).toBe('E_INVALID_INPUT');
    const over = await postReviewToc(app, 'u1', { filePath: tmp, startPage: 1, endPage: 9 });
    expect(over.status).not.toBe(200);
    expect((over.json.error as { code?: string } | undefined)?.code).toBe('E_INVALID_INPUT');
    expect(captured.length).toBe(0);
    expect(await documentCount(repo, 'u1')).toBe(before);
  }, 180000);
});
