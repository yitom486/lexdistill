import type { AgentAdapter, AgentImageAttachment } from '@study-studio/agent-runtime';
import { BusinessError, err, generateId, ok, translateToBusinessError, type Result } from '@study-studio/shared';
import { buildTocExtractionPrompt } from './prompts/toc-extraction-prompt.js';
import { LibraryProposeTocTool, type ProposedToc } from '../tools/library-propose-toc-tool.js';

export interface ExtractTocWithLlmInput {
  userId: string;
  title?: string | undefined;
  language?: string | undefined;
  pageNumbers: number[];
  pageImages: AgentImageAttachment[];
  model?: string | undefined;
  adapter: AgentAdapter;
  proposalTool: LibraryProposeTocTool;
  traceId?: string;
  onDiagnostic?: (stage: string, details?: Record<string, string | number | boolean | number[]>) => void;
}

/** 专用视觉会话只收目录图片，只开放只读草稿工具，结果须由工具成功校验。 */
export async function extractTocWithLlm(
  input: ExtractTocWithLlmInput
): Promise<Result<ProposedToc, BusinessError>> {
  if (input.pageImages.length === 0 || input.pageImages.length !== input.pageNumbers.length) {
    return err(new BusinessError('E_INVALID_INPUT', '目录图片数量与所选 PDF 页不一致', 'VALIDATION'));
  }
  if (input.adapter.supportsImageInput?.() !== true) {
    return err(new BusinessError('E_AGENT_CAPABILITY', '当前模型通道不支持图片输入，请切换视觉模型', 'AGENT_RUNTIME'));
  }

  const sessionId = input.traceId ?? generateId('toc_review');
  const note = input.onDiagnostic ?? (() => {});
  input.proposalTool.begin(sessionId, input.userId, (result) => {
    note(result.accepted ? 'tool_validation_accepted' : 'tool_validation_rejected', {
      ...(result.code ? { code: result.code } : {}),
      ...(result.entryCount !== undefined ? { entryCount: result.entryCount } : {}),
    });
  });
  try {
    note('session_starting', { tool: input.proposalTool.name, imageCount: input.pageImages.length });
    const created = await input.adapter.createSession({
      sessionId,
      userId: input.userId,
      tools: [input.proposalTool],
      systemPrompt: '你负责根据教材目录页图片整理目录草稿。只依据所见，不编造。必须通过本会话提供的目录草稿工具提交结果，不要仅在普通回复中输出目录。',
      ...(input.model ? { model: input.model } : {}),
      approvalPolicy: 'on-request',
      ephemeral: true,
    });
    if (!created.ok) {
      note('session_failed', { code: created.error.code });
      return err(created.error);
    }
    const session = created.value;
    note('session_started');
    try {
      let completed = false;
      note('turn_starting');
      for await (const event of session.send({
        message: buildTocExtractionPrompt(input),
        attachments: input.pageImages,
      })) {
        if (event.type === 'TOOL_CALL_REQUESTED') {
          note('tool_call_requested', { tool: event.toolName });
        } else if (event.type === 'TOOL_CALL_COMPLETED') {
          note('tool_call_completed');
        } else if (event.type === 'APPROVAL_REQUESTED') {
          note('approval_declined', { action: event.action });
          const declined = await session.submitApproval(event.approvalId, 'decline');
          if (!declined.ok) return err(declined.error);
        } else if (event.type === 'ERROR') {
          note('turn_failed', { code: event.error.code });
          return err(event.error);
        } else if (event.type === 'COMPLETED') {
          completed = true;
          note('turn_completed');
        }
      }
      const proposal = input.proposalTool.take(sessionId);
      if (!completed || !proposal) {
        note('proposal_missing', { turnCompleted: completed });
        return err(new BusinessError(
          'E_TOC_PROPOSAL_MISSING',
          '视觉模型未提交通过校验的目录草稿，请核对目录页后重试',
          'AGENT_RUNTIME',
          true
        ));
      }
      note('proposal_ready', { entryCount: proposal.entries.length });
      return ok(proposal);
    } finally {
      note('session_closing');
      await session.close();
      note('session_closed');
    }
  } catch (cause) {
    const error = translateToBusinessError(cause, 'extractTocWithLlm');
    note('session_exception', { code: error.code });
    return err(error);
  } finally {
    input.proposalTool.end(sessionId);
  }
}
