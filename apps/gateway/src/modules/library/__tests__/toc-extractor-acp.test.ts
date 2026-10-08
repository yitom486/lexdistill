import { describe, expect, it } from 'bun:test';
import type { AgentAdapter, AgentEvent, AgentSession } from '@study-studio/agent-runtime';
import { ok } from '@study-studio/shared';
import { extractTocWithLlm } from '../application/toc-extractor.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import { buildTocExtractionPromptForEmbeddedText } from '../application/prompts/toc-extraction-prompt.js';

const SEED_PROPOSAL = {
  tocEndPage: 2,
  entries: [{ title: '第一課', level: 'lesson', startPage: 1 }],
} as const;

const PDF_FILE = {
  path: '0.pdf',
  pageCount: 2,
  originalPages: [1, 2],
  workingDirectory: '/tmp/lingua-test',
  images: [],
};

/** ACP 形假适配器：无原生文件能力（supportsLocalFileInput 缺席），send 内模拟 Agent 调工具。 */
function fakeAcpAdapter(tool: LibraryProposeTocTool, sessionId: string, userId: string): AgentAdapter {
  const session: AgentSession = {
    sessionId,
    threadId: `acp-${sessionId}`,
    toolSpecs: [],
    send: async function* (): AsyncIterable<AgentEvent> {
      // 模拟 Agent 经桥调目录工具（执行上下文 sessionId 与 begin 键一致）。
      await tool.execute(
        { tocEndPage: 2, entries: [{ title: '第一課', level: 'lesson' as const, startPage: 1 }] },
        { sessionId, userId },
      );
      yield { type: 'COMPLETED', finalOutput: 'done' };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  return {
    id: 'acp-fake',
    name: 'AcpFake',
    createSession: async () => ok(session),
    resumeSession: async () => ok(session),
  } as unknown as AgentAdapter;
}

describe('extractTocWithLlm ACP 内嵌通路', () => {
  it('文字内嵌＋桥工具实例直收：成功回 entries（无 spawn）', async () => {
    const tool = new LibraryProposeTocTool();
    const sessionId = 'test-toc-acp-1';
    const res = await extractTocWithLlm({
      userId: 'u1',
      title: '测试教材',
      language: 'ja',
      pdfFile: PDF_FILE,
      adapter: fakeAcpAdapter(tool, sessionId, 'u1'),
      proposalTool: tool,
      traceId: sessionId,
      fileAccess: 'embedded-text',
      embeddedText: [
        { originalPage: 1, text: '第一課 あいさつ' },
        { originalPage: 2, text: '第二課 がっこう' },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.entries.length).toBe(1);
      expect(res.value.entries[0]).toMatchObject({ id: 'toc-1', title: '第一課' });
      expect(res.value.tocEndPage).toBe(2);
    }
    expect(SEED_PROPOSAL.entries.length).toBe(1);
  });

  it('内嵌无字：大声报 E_TOC_NO_TEXT，不建会话', async () => {
    const tool = new LibraryProposeTocTool();
    let created = false;
    const adapter = fakeAcpAdapter(tool, 'x', 'u1');
    const raw = adapter.createSession;
    adapter.createSession = (async (...args: unknown[]) => {
      created = true;
      return raw(args[0] as Parameters<typeof raw>[0]);
    }) as typeof raw;
    const res = await extractTocWithLlm({
      userId: 'u1',
      pdfFile: PDF_FILE,
      adapter,
      proposalTool: tool,
      traceId: 'test-toc-acp-2',
      fileAccess: 'embedded-text',
      embeddedText: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_TOC_NO_TEXT');
    expect(created).toBe(false);
  });
});

describe('buildTocExtractionPromptForEmbeddedText', () => {
  it('页分隔标注原物理页，不含文件路径指令', () => {
    const text = buildTocExtractionPromptForEmbeddedText(
      { pdfFile: PDF_FILE },
      [{ originalPage: 3, text: '第三課' }],
    );
    expect(text).toContain('【原PDF第3页】');
    expect(text).toContain('第三課');
    expect(text).not.toContain('自行读取该文件');
  });
});
