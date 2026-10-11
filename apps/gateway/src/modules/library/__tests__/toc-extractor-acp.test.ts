import { afterEach, describe, expect, it } from 'bun:test';
import type { AgentAdapter, AgentEvent, AgentImageAttachment, AgentSession } from '@study-studio/agent-runtime';
import { ok } from '@study-studio/shared';
import { extractTocWithLlm, loadTocImageAttachments, MAX_TOC_IMAGE_BYTES, MAX_TOC_IMAGE_COUNT } from '../application/toc-extractor.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import { buildTocExtractionPromptForEmbeddedImages, buildTocExtractionPromptForEmbeddedText } from '../application/prompts/toc-extraction-prompt.js';

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
function fakeAcpAdapter(tool: LibraryProposeTocTool, sessionId: string, userId: string): AgentAdapter {  const session: AgentSession = {
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

describe('extractTocWithLlm 扫描读图通路', () => {
  it('有图无字：照常建会话，send 收到 attachments 并成功', async () => {
    const tool = new LibraryProposeTocTool();
    const sessionId = 'test-toc-acp-img-1';
    let seenAttachments: AgentImageAttachment[] | undefined;
    const adapter = fakeAcpAdapter(tool, sessionId, 'u1');
    const raw = adapter.createSession;
    adapter.createSession = (async (...args: unknown[]) => {
      const res = await raw(args[0] as Parameters<typeof raw>[0]);
      if (res.ok) {
        const session = res.value as AgentSession;
        const send = session.send.bind(session);
        session.send = ((input: { attachments?: AgentImageAttachment[] } & Record<string, unknown>) => {
          seenAttachments = input.attachments;
          return send(input as unknown as never);
        }) as unknown as typeof session.send;
      }
      return res;
    }) as typeof raw;
    const png = new Uint8Array([137, 80, 78, 71]);
    const res = await extractTocWithLlm({
      userId: 'u1',
      pdfFile: PDF_FILE,
      adapter,
      proposalTool: tool,
      traceId: sessionId,
      fileAccess: 'embedded-text',
      attachments: [{ png, label: '原PDF第1页' }],
    });
    expect(res.ok).toBe(true);
    expect(seenAttachments?.length).toBe(1);
    expect(seenAttachments?.[0]?.png).toEqual(png);
  });

  it('无字无图：仍报 E_TOC_NO_TEXT', async () => {
    const tool = new LibraryProposeTocTool();
    const res = await extractTocWithLlm({
      userId: 'u1',
      pdfFile: PDF_FILE,
      adapter: fakeAcpAdapter(tool, 'x', 'u1'),
      proposalTool: tool,
      traceId: 'test-toc-acp-img-2',
      fileAccess: 'embedded-text',
      embeddedText: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_TOC_NO_TEXT');
  });
});

describe('buildTocExtractionPromptForEmbeddedImages', () => {
  it('图片顺序与标签对应，辅助文字以图为准', () => {
    const text = buildTocExtractionPromptForEmbeddedImages(
      { pdfFile: PDF_FILE },
      [{ originalPage: 1, text: '第一課' }],
      ['原PDF第1页', '原PDF第2页'],
    );
    expect(text).toContain('共2张');
    expect(text).toContain('第1张图＝原PDF第1页');
    expect(text).toContain('以图片为准');
    expect(text).not.toContain('自行读取该文件');
  });
});

describe('loadTocImageAttachments（预算封顶）', () => {
  const dir = `${import.meta.dir}/tmp-toc-images`;
  afterEach(async () => {
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  it('正常读取：字节与标签齐全', async () => {
    await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.write(`${dir}/p1.png`, new Uint8Array([1, 2, 3]));
    const res = await loadTocImageAttachments([{ originalPage: 5, path: `${dir}/p1.png` }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.length).toBe(1);
      expect(res.value[0]?.label).toBe('原PDF第5页');
      expect(res.value[0]?.png).toEqual(new Uint8Array([1, 2, 3]));
    }
  });

  it(`超张数（>${MAX_TOC_IMAGE_COUNT}）直接 E_TOC_IMAGE_BUDGET，不读文件`, async () => {
    const images = Array.from({ length: MAX_TOC_IMAGE_COUNT + 1 }, (_, i) => ({ originalPage: i + 1, path: `${dir}/nope.png` }));
    const res = await loadTocImageAttachments(images);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_TOC_IMAGE_BUDGET');
  });

  it(`总量超 ${MAX_TOC_IMAGE_BYTES / 1024 / 1024}MB 报 E_TOC_IMAGE_BUDGET`, async () => {
    await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.write(`${dir}/big.png`, new Uint8Array(MAX_TOC_IMAGE_BYTES + 1));
    const res = await loadTocImageAttachments([{ originalPage: 1, path: `${dir}/big.png` }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_TOC_IMAGE_BUDGET');
  });

  it('缺失文件报 E_TOC_IMAGE_READ', async () => {
    const res = await loadTocImageAttachments([{ originalPage: 1, path: `${dir}/missing.png` }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_TOC_IMAGE_READ');
  });
});
