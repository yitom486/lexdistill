import type { AgentAdapter, AgentImageAttachment } from '@lexdistill/agent-runtime';
import { BusinessError, err, generateId, ok, logger, translateToBusinessError, type Result } from '@lexdistill/shared';
import { TextbookPipelineSettingsSchema, type TocEntry } from '@lexdistill/document-model';
import { buildTocExtractionPrompt, buildTocExtractionPromptForEmbeddedImages, buildTocExtractionPromptForEmbeddedText } from './prompts/toc-extraction-prompt.js';
import { LibraryProposeTocTool, type ProposedToc } from '../tools/library-propose-toc-tool.js';
import type { ImportMonitor } from './import-monitor.js';
import type { PdfTaskFile } from './pdf-import/pdf-task-workspace.js';
import { awaitModelActivity } from './model-activity-deadline.js';

export interface ExtractTocWithLlmInput {
  userId: string; title?: string | undefined; language?: string | undefined;
  pdfFile: PdfTaskFile; model?: string | undefined; effort?: string | undefined;
  adapter: AgentAdapter; proposalTool: LibraryProposeTocTool; traceId?: string;
  monitor?: ImportMonitor; signal?: AbortSignal;
  onDiagnostic?: (stage: string, details?: Record<string, string | number | boolean | number[]>) => void;
  /**
   * 文件投喂方式（路由按适配器-chain 决定，默认 native）：
   * - native：Agent 原生读文件（具本地文件能力的通路，prompt 传路径）；
   * - embedded-text：文字内嵌（ACP 通路，需同步给 embeddedText；扫描版无字可嵌直接失败）。
   */
  fileAccess?: 'native' | 'embedded-text';
  /** 与 pdfFile.originalPages 一一对应的页文字（embedded-text 必填；空串页调用方已剔除）。 */
  embeddedText?: Array<{ originalPage: number; text: string }>;
  /**
   * 内存态 PNG 页面图（扫描版目录识别用；路由按张数/总字节封顶后传入，用完即弃）。
   * 有图即走读图提示词；ACP 适配器随 prompt 直传模型，具原生读文件能力的通路忽略（直接读文件）。
   */
  attachments?: AgentImageAttachment[];
}

/** 目录识别图片预算（150dpi 整页 PNG；超限请用户收窄页码范围，不静默截断）。 */
export const MAX_TOC_IMAGE_COUNT = 12;
export const MAX_TOC_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * 目录页图片落盘文件 → 内存态附件（标签带原物理页，供提示词按序对应）。
 * 纯网关侧 IO，Artifact 随工作区关闭清理，用完即弃。
 */
export async function loadTocImageAttachments(
  images: Array<{ originalPage: number; path: string }>,
): Promise<Result<AgentImageAttachment[], BusinessError>> {
  if (images.length > MAX_TOC_IMAGE_COUNT) {
    return err(new BusinessError('E_TOC_IMAGE_BUDGET', `本轮页面图 ${images.length} 张超过上限 ${MAX_TOC_IMAGE_COUNT} 张，请指定更窄的目录页码范围后重试`, 'VALIDATION', true));
  }
  const attachments: AgentImageAttachment[] = [];
  let total = 0;
  for (const image of images) {
    let bytes: Uint8Array;
    try {
      bytes = await Bun.file(image.path).bytes();
    } catch {
      return err(new BusinessError('E_TOC_IMAGE_READ', `页面图读取失败（原 PDF 第 ${image.originalPage} 页），请重试`, 'TOOL_EXECUTION', true));
    }
    total += bytes.length;
    if (total > MAX_TOC_IMAGE_BYTES) {
      return err(new BusinessError('E_TOC_IMAGE_BUDGET', `页面图总量超过 ${MAX_TOC_IMAGE_BYTES / 1024 / 1024}MB，请指定更窄的目录页码范围后重试`, 'VALIDATION', true));
    }
    attachments.push({ png: bytes, label: `原PDF第${image.originalPage}页` });
  }
  return ok(attachments);
}

/** 目录会话读取裁剪 PDF；只有草稿工具，原生文件读取由适配器提供。 */
export async function extractTocWithLlm(input: ExtractTocWithLlmInput): Promise<Result<Omit<ProposedToc, 'entries'> & { entries: TocEntry[] }, BusinessError>> {
  const embedded = input.fileAccess === 'embedded-text';
  if (!embedded && !input.adapter.supportsLocalFileInput?.()) return err(new BusinessError('E_AGENT_CAPABILITY', '当前模型通道不支持本机 PDF 读取，请切换模型通道', 'AGENT_RUNTIME'));
  if (embedded && (!input.embeddedText || input.embeddedText.length === 0)
    && (!input.attachments || input.attachments.length === 0)) {
    return err(new BusinessError('E_TOC_NO_TEXT', '本轮无可内嵌文字且无页面图（请指定含目录的页码范围后重试）', 'VALIDATION'));
  }
  const sessionId = input.traceId ?? generateId('toc_review'), attemptId = generateId('toc_attempt');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal?.addEventListener('abort', cancel, { once: true });
  if (input.signal?.aborted) cancel();
  const note = input.onDiagnostic ?? (() => {});
  input.proposalTool.begin(sessionId, input.userId, result => input.monitor?.record('validation', result.accepted ? 'accepted' : 'rejected', result, { sessionId, attemptId }), input.pdfFile.originalPages);
  try {
    if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '目录识别已取消', 'AGENT_RUNTIME');
    const systemPrompt = '读取当前教材 PDF，依据实际目录提交草稿，不编造目录。通过本会话目录工具提交结果。';
    // ACP 无 systemPrompt 通道（与聊天身份同款）：首消息前置；文字内嵌替代原生读文件。
    const promptHead = embedded ? `${systemPrompt}\n\n` : '';
    const created = await input.adapter.createSession({ sessionId, userId: input.userId, tools: [input.proposalTool], systemPrompt,
      approvalPolicy: 'on-request', ephemeral: true,
      ...(input.model ? { model: input.model } : {}),
      // 档位经建会话生效（ACP 以 setConfigOption 落盘；旧 turnOptions 通路无适配器读取，已删除）。
      // sandboxMode/workingDirectory 无 ACP 对应物，不传：内嵌模式不需要，原生模式由能力门禁前置大声拒绝。
      ...(input.effort ? { effort: input.effort } : {}),
    });
    if (!created.ok) return created;
    const session = created.value;
    const turn = input.monitor?.turn(session, { attemptId });
    const interrupt = () => { input.proposalTool.end(sessionId); void session.interrupt().catch(cause => logger.warn('目录会话中断失败', { cause: String(cause) })); };
    controller.signal.addEventListener('abort', interrupt, { once: true });
    const message = input.attachments && input.attachments.length > 0
      ? promptHead + buildTocExtractionPromptForEmbeddedImages(input, input.embeddedText ?? [], input.attachments.map(item => item.label ?? ''))
      : embedded
        ? promptHead + buildTocExtractionPromptForEmbeddedText(input, input.embeddedText ?? [])
        : buildTocExtractionPrompt(input);
    input.monitor?.record('session', 'opened', { model: input.model ?? null, effort: input.effort ?? null, tools: session.toolSpecs ?? null }, { sessionId });
    input.monitor?.record('model', 'input', { message, systemPrompt, model: input.model ?? null, effort: input.effort ?? null, pdfFile: input.pdfFile, contextMode: 'directory-session' }, turn?.binding);
    const iterator = session.send({
      message,
      ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    })[Symbol.asyncIterator]();
    const budgets = TextbookPipelineSettingsSchema.parse({});
    let first = true, completed = false, deadline = Date.now() + budgets.firstResponseTimeoutMs;
    try {
      while (true) {
        const next = await awaitModelActivity(() => iterator.next(), controller, deadline - Date.now(), first);
        if (next.done) break;
        const event = next.value;
        turn?.event(event);
        if (event.type === 'RUNTIME_RETRY' || ((event.type === 'TEXT_DELTA' || event.type === 'REASONING_DELTA') && !event.delta)) continue;
        first = false; deadline = Date.now() + budgets.stallTimeoutMs;
        note(event.type.toLowerCase());
        if (event.type === 'ERROR') return err(event.error);
        if (event.type === 'APPROVAL_REQUESTED') { const result = await session.submitApproval(event.approvalId, 'decline'); if (!result.ok) return result; }
        if (event.type === 'COMPLETED') completed = true;
      }
      const proposal = input.proposalTool.take(sessionId);
      if (!completed || !proposal) return err(new BusinessError('E_TOC_PROPOSAL_MISSING', '模型未提交有效目录；可指定目录页范围后重新识别', 'AGENT_RUNTIME', true));
      if (proposal.tocEndPage === undefined || !input.pdfFile.originalPages.includes(proposal.tocEndPage)) return err(new BusinessError('E_TOC_RANGE_INVALID', '模型未确认实际目录结束页，请指定目录范围后重新识别', 'VALIDATION', true));
      return ok({ ...proposal, entries: proposal.entries.map(({parentIndex, ...entry}, index) => ({ ...entry, id: `toc-${index + 1}`,
        ...(parentIndex !== undefined ? { parentId: `toc-${parentIndex + 1}` } : {}),
      })) });
    } finally {
      input.proposalTool.end(sessionId);
      controller.signal.removeEventListener('abort', interrupt);
      void iterator.return?.().catch(cause => logger.warn('目录响应流收尾失败', { cause: String(cause) }));
      turn?.flush(); await session.close();
      input.monitor?.record('session', 'closed', undefined, { sessionId });
    }
  } catch (cause) { return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, '目录识别')); }
  finally { input.signal?.removeEventListener('abort', cancel); input.proposalTool.end(sessionId); await input.monitor?.flush(); }
}
