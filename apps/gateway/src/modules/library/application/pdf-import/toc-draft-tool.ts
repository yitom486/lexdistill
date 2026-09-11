import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolLocations,
  ToolPermissions,
} from '@study-studio/tool-core';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { isSemanticOutlineTitle } from './embedded-outline-quality.js';

/**
 * CMD-LINGUA-P3.4A：目录草稿原生工具（session-local Server Tool）。
 *
 * 替换“模型最终回复必须是完美 JSON”的脆弱契约：模型 scatter 自然语言无妨，
 * 结构化草稿只经 `toc_draft_replace_all` 工具调用进入网关；UI 数据源唯一
 * 来自本工具校验后暂存，模型原文永不解析、不展示、不记录。
 *
 * 执行链（与 Codex 原生 dynamic tools 对齐，不引入 ACP）：
 * review 会话 createSession(tools=[本工具]) → Codex 侧 dynamicTools 声明 →
 * 模型调用 → CodexSession 经 adapter executeTool（全局 registry）调本 execute →
 * 校验通过暂存（会话内存）/失败回安全错误码 → review loop 凭暂存判定。
 *
 * 零写保证：暂存只活在进程内存 Map（key=Codex sessionId），review 结束
 * （成功/unavailable/异常）必删；不碰 DB/AST/cache/import/anchor/P5。
 * 权限 READ：无任何持久副作用， Parliament（审批）默认 never，放行无弹窗。
 */

/** 工具名（已是 Responses 安全形，sanitize 后不变，便于双向回填）。 */
export const TOC_DRAFT_TOOL_NAME = 'toc_draft_replace_all';
/** 草稿条数上下限（review 窗 ≤8 页，32 为宽松上界，防模型刷屏）。 */
export const TOC_DRAFT_MIN_ENTRIES = 2;
export const TOC_DRAFT_MAX_ENTRIES = 32;
/** 印刷页码上界（教材印刷页极少超此数；年份 5 位数一并排除）。 */
export const TOC_DRAFT_PAGE_MAX = 9999;
/** warnings 上限（条数/单条字符，防注入式刷屏；内容只透传给 UI 展示）。 */
export const TOC_DRAFT_MAX_WARNINGS = 10;
export const TOC_DRAFT_MAX_WARNING_CHARS = 200;
/** 同一会话最多工具调用次数（首调 + 一次纠正；超限直接拒绝）。 */
export const TOC_DRAFT_MAX_CALLS_PER_SESSION = 2;

const TocDraftToolEntrySchema = z
  .object({
    title: z.string().min(1).max(200),
    printedPage: z.number(),
    level: z.union([z.literal(1), z.literal(2)]),
    kind: z.union([z.literal('lesson'), z.literal('section')]),
    confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]).optional().default('medium'),
  })
  .strict();

export const TocDraftToolInputSchema = z
  .object({
    // 条数上下限由 validateTocDraftToolInput 纯函数 single-enforce（zod 只管形状），
    // 失败原因码精确到 count 而非笼统 args。
    entries: z.array(TocDraftToolEntrySchema),
    warnings: z.array(z.string().max(TOC_DRAFT_MAX_WARNING_CHARS)).max(TOC_DRAFT_MAX_WARNINGS).optional().default([]),
  })
  .strict();

export type TocDraftToolEntry = z.infer<typeof TocDraftToolEntrySchema>;
export type TocDraftToolInput = z.infer<typeof TocDraftToolInputSchema>;
/** execute 入参（含可选/默认值未归一化的原始形；归一化由 safeParse 完成）。 */
export type TocDraftToolRawInput = z.input<typeof TocDraftToolInputSchema>;

export type TocDraftToolFailReason = 'args' | 'count' | 'title' | 'page' | 'order';

export interface TocDraftToolValidated {
  entries: Array<{
    title: string;
    printedPage: number;
    level: 1 | 2;
    kind: 'lesson' | 'section';
    confidence: 'high' | 'medium' | 'low';
  }>;
  warnings: string[];
}

interface TocDraftToolCheck {
  ok: true;
  draft: TocDraftToolValidated;
}

interface TocDraftToolReject {
  ok: false;
  reason: TocDraftToolFailReason;
  /** 给模型的纠正位点（条目序号/字段名），绝不含标题原文。 */
  hint: string;
}

const FAIL_MESSAGE: Record<TocDraftToolFailReason | 'exhausted', string> = {
  args: '参数结构非法：entries/warnings 形状不对，或 level/kind/confidence 不在白名单',
  count: `entries 条数须在 ${TOC_DRAFT_MIN_ENTRIES}–${TOC_DRAFT_MAX_ENTRIES} 之间`,
  title: '标题非法：空标题或无语义内容（纯数字/符号），请给出语义标题',
  page: `printedPage 须为 1–${TOC_DRAFT_PAGE_MAX} 的正整数`,
  order: 'printedPage 必须单调不减：后一条页码不得小于前一条',
  exhausted: '本会话工具调用已用完（首调 + 一次纠正），请等待本轮结束',
};

function failReasonOf(code: TocDraftToolFailReason | 'exhausted'): { code: string; userMessage: string } {
  const suffix = code === 'exhausted' ? 'E_TOC_DRAFT_EXHAUSTED' : `E_TOC_DRAFT_${code.toUpperCase()}`;
  return { code: suffix, userMessage: `${FAIL_MESSAGE[code]}。请修正后重新调用工具（最多一次纠正）` };
}

/**
 * 工具参数校验（纯函数）：结构（zod）→ 条数 → 逐条标题语义/页码正整数 →
 * 全序列单调。失败只给原因码 + 位点 hint，永不回显标题原文。
 */
export function validateTocDraftToolInput(raw: unknown): TocDraftToolCheck | TocDraftToolReject {
  const parsed = TocDraftToolInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first
      ? first.path
          .map((seg) => (typeof seg === 'number' ? `[${seg}]` : String(seg)))
          .join('.')
          .replace(/\.\[/g, '[')
      : 'input';
    return { ok: false, reason: 'args', hint: path };
  }
  const { entries, warnings } = parsed.data;
  if (entries.length < TOC_DRAFT_MIN_ENTRIES || entries.length > TOC_DRAFT_MAX_ENTRIES) {
    return { ok: false, reason: 'count', hint: `entries.length=${entries.length}` };
  }
  let prevPage = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as TocDraftToolEntry;
    const title = entry.title.trim();
    if (!title || !isSemanticOutlineTitle(title)) {
      return { ok: false, reason: 'title', hint: `entries[${i}].title` };
    }
    if (!Number.isSafeInteger(entry.printedPage) || entry.printedPage < 1 || entry.printedPage > TOC_DRAFT_PAGE_MAX) {
      return { ok: false, reason: 'page', hint: `entries[${i}].printedPage` };
    }
    if (entry.printedPage < prevPage) {
      return { ok: false, reason: 'order', hint: `entries[${i}].printedPage` };
    }
    prevPage = entry.printedPage;
  }
  const cleanWarnings = warnings.map((w) => w.trim()).filter((w) => w.length > 0);
  return {
    ok: true,
    draft: {
      entries: entries.map((entry) => ({
        title: entry.title.trim(),
        printedPage: entry.printedPage,
        level: entry.level,
        kind: entry.kind,
        confidence: entry.confidence,
      })),
      warnings: cleanWarnings,
    },
  };
}

export interface TocDraftToolSessionRecord {
  /** 本会话累计工具调用（含失败与耗尽拒绝）。 */
  calls: number;
  /** 成功调用次数。 */
  successes: number;
  /** 最新一次成功暂存（唯一 UI 数据源候选）。 */
  draft: TocDraftToolValidated | null;
  /** 历次失败原因码（按序；成功不清除，只计数用，无原文）。 */
  errorCodes: string[];
}

function newRecord(): TocDraftToolSessionRecord {
  return { calls: 0, successes: 0, draft: null, errorCodes: [] };
}

/** 会话暂存（进程内存；review 结束必删，不跨会话、不落盘）。 */
const draftSessions = new Map<string, TocDraftToolSessionRecord>();

/**
 * 读并删除会话暂存（review loop 终态唯一读取点；成功/unavailable/异常全调）。
 * 返回 null = 本会话无工具调用或从未成功。
 */
export function takeTocDraftToolResult(sessionId: string): TocDraftToolSessionRecord | null {
  const record = draftSessions.get(sessionId) ?? null;
  draftSessions.delete(sessionId);
  return record;
}

/** 工具执行结果回模型负载（仅计数 + 接受态，无标题无原文）。 */
export interface TocDraftToolResult {
  accepted: boolean;
  entries: number;
  warnings: number;
}

/**
 * `toc_draft_replace_all` Server Tool（READ：会话内存暂存，零持久副作用）。
 * 全局 registry 注册（adapter 执行链要求），但仅 review 会话在 createSession
 * 时声明，未声明的会话模型调不到（Codex 只放行已声明 dynamicTools）。
 */
export class TocDraftReplaceAllTool
  implements ToolDefinition<TocDraftToolRawInput, TocDraftToolResult>
{
  public readonly name = TOC_DRAFT_TOOL_NAME;
  public readonly description =
    '整体替换本轮目录草稿：entries（≥2 条：语义标题 + 印刷页码单调 + level 1|2 + kind lesson|section）+ warnings。自然语言回复会被忽略，草稿只认本次调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = TocDraftToolInputSchema;

  public async execute(
    // unknown：adapter/registry 经 unknown 透传（ToolDefinition 方法双变，仍满足接口）；
    // 结构归一由内部 safeParse 完成，非法只映射安全码。
    input: unknown,
    context: ToolExecutionContext
  ): Promise<Result<TocDraftToolResult, BusinessError>> {
    const record = draftSessions.get(context.sessionId) ?? newRecord();
    draftSessions.set(context.sessionId, record);
    record.calls++;
    if (record.calls > TOC_DRAFT_MAX_CALLS_PER_SESSION) {
      record.errorCodes.push('E_TOC_DRAFT_EXHAUSTED');
      const message = failReasonOf('exhausted');
      return err(new BusinessError(message.code, message.userMessage, 'TOOL_EXECUTION', false));
    }
    const checked = validateTocDraftToolInput(input);
    if (!checked.ok) {
      const message = failReasonOf(checked.reason);
      record.errorCodes.push(message.code);
      return err(new BusinessError(message.code, `${message.userMessage}（${checked.hint}）`, 'TOOL_EXECUTION', false));
    }
    record.successes++;
    record.draft = checked.draft;
    return ok({ accepted: true, entries: checked.draft.entries.length, warnings: checked.draft.warnings.length });
  }
}

/** review 会话声明的工具单例（createSession tools 用此对象）。 */
export const tocDraftReplaceAllTool = new TocDraftReplaceAllTool();

/**
 * 可观测事件（P3.4A）：仅固定枚举 + 计数，无标题/正文/图片/路径/用户/模型原文。
 */
export type TocReviewToolEvent =
  | { type: 'agent_session_ready' }
  | { type: 'tool_offered'; tool: string }
  | { type: 'tool_call_received'; tool: string }
  | { type: 'tool_validation_failed'; code: string }
  | { type: 'draft_ready'; entries: number; warnings: number }
  | { type: 'unavailable'; code: string };

export interface TocReviewToolObserver {
  emit(event: TocReviewToolEvent): void;
}
