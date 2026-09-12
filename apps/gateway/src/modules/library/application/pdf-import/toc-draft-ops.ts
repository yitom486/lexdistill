import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolLocations,
  ToolPermissions,
} from '@study-studio/tool-core';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { isSemanticOutlineTitle } from './embedded-outline-quality.js';
import { stripMarkdownLineMarkers } from './toc-discovery.js';

/**
 * CMD-LINGUA-P3.5 目录草稿会话内增量变更（session-local staged CRUD）。
 *
 * 替代已删除的 `toc_draft_replace_all`（整包替换）：模型不再一次性甩出完整
 * 草稿，而是对 OCR 基线做增量手术——保留正确的基线行（keep），只为漏项、
 * 错标题、错页码、错层级发起 add / update / remove，每项自带 evidence reason。
 *
 * 不变量：
 * - OCR 基线只读：调用方以 ContextSnapshot/证据形式给模型，绝不提供 Read Tool；
 * - 每次工具调用先全量校验、再一次性应用（原子：失败零副作用）；
 * - 基线行 id（`b{index}`）与新增行 id（`n{counter}`）由服务端确定性分配；
 * - update/remove 必须带 expectedBefore（乐观并发：所给字段与现状不符即拒）；
 * - 终态只返回“合并后完整目录 + 按 entryId 对齐的 diff”，不写 DB/AST/教材。
 */

export const TOC_DRAFT_ADD_ENTRY_TOOL = 'toc_draft_add_entry';
export const TOC_DRAFT_UPDATE_ENTRY_TOOL = 'toc_draft_update_entry';
export const TOC_DRAFT_REMOVE_ENTRY_TOOL = 'toc_draft_remove_entry';

/** 同一会话累计工具调用上限（含失败；超限直接拒绝，不再浪费模型轮次）。 */
export const TOC_DRAFT_MAX_OPS_PER_SESSION = 32;
/** 印刷页码上界（与旧整包工具同口径）。 */
export const TOC_DRAFT_PAGE_MAX = 9999;
/** evidence reason 上限（字符；空去空白后拒收）。 */
export const TOC_DRAFT_MAX_REASON_CHARS = 200;
/** 终态可采用下限（条；与 P2.2/基线门同等保守）。 */
export const TOC_DRAFT_MIN_ENTRIES = 2;

export type TocStagedChange = 'keep' | 'add' | 'update' | 'remove';
export type TocStagedConfidence = 'high' | 'medium' | 'low' | null;

export interface TocStagedSide {
  title: string;
  printedPage: number;
  level: 1 | 2;
  kind: 'lesson' | 'section';
  confidence: TocStagedConfidence;
}

export interface TocStagedEntry extends TocStagedSide {
  entryId: string;
  needsReview: boolean;
  change: TocStagedChange;
  /** 首次变更前的快照（基线行=基线原文；新增行为 null；展示 diff 用）。 */
  base: TocStagedSide | null;
  /** 最近一次变更依据（keep 为 null）。 */
  reason: string | null;
}

export interface TocStagedDiffRow {
  entryId: string;
  change: TocStagedChange;
  before: TocStagedSide | null;
  after: TocStagedSide | null;
  reason: string | null;
  needsReview: boolean;
}

export type TocDraftOpFailReason = 'args' | 'title' | 'page' | 'order' | 'stale' | 'exhausted';

interface TocDraftOpCheck {
  ok: true;
}

interface TocDraftOpReject {
  ok: false;
  reason: TocDraftOpFailReason;
  /** 纠正位点（字段路径/entryId），绝不含标题原文。 */
  hint: string;
}

const LEVEL_VALUES = [1, 2] as const;
const KIND_VALUES = ['lesson', 'section'] as const;
const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;

function isLevel(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function isKind(value: unknown): value is 'lesson' | 'section' {
  return value === 'lesson' || value === 'section';
}

function isConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low';
}

function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > TOC_DRAFT_MAX_REASON_CHARS) return null;
  return trimmed;
}

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = stripMarkdownLineMarkers(raw.trim());
  if (!title || !isSemanticOutlineTitle(title)) return null;
  return title;
}

function cleanPage(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > TOC_DRAFT_PAGE_MAX) return null;
  return raw;
}

function snapshotOf(entry: TocStagedEntry): TocStagedSide {
  return {
    title: entry.title,
    printedPage: entry.printedPage,
    level: entry.level,
    kind: entry.kind,
    confidence: entry.confidence,
  };
}

interface TocDraftSessionState {
  order: string[];
  entries: Map<string, TocStagedEntry>;
  calls: number;
  successes: number;
  errorCodes: string[];
  addCounter: number;
}

function newSessionState(): TocDraftSessionState {
  return { order: [], entries: new Map(), calls: 0, successes: 0, errorCodes: [], addCounter: 0 };
}

/** 会话暂存（进程内存；终态 take 即删，不跨会话、不落盘）。 */
const draftSessions = new Map<string, TocDraftSessionState>();

/** 工具隔离登记（P3.4B-ISO 第二道门；仅 review 会话登记）。 */
const draftToolSessions = new Set<string>();

/** 登记目录审核会话（review loop 在 createSession 成功后调用；幂等）。 */
export function registerTocDraftSession(sessionId: string): void {
  if (typeof sessionId === 'string' && sessionId) draftToolSessions.add(sessionId);
}

/** 登记是否有效（纯查询，供单测锁定隔离语义）。 */
export function isTocDraftSessionRegistered(sessionId: string): boolean {
  return draftToolSessions.has(sessionId);
}

export interface TocBaselineSeedEntry {
  title: string;
  printedPage: number;
  level: number;
  kind: 'lesson' | 'section';
}

/**
 * 基线行 entryId（确定性：`b{下标}`，与消息文本内标注一致，消息与暂存永不错位）。
 * 新增行 id（`n{计数}`，会话内单调）。
 */
export function baselineEntryId(index: number): string {
  return `b${index}`;
}

/**
 * 用 OCR 基线初始化会话暂存（只读快照：标题去 markdown 残留；confidence 为 null
 * 表示“原文保留、未经 AI 判定”，绝不臆造 medium）。
 * 基线标题无语义的行直接跳过（不进暂存，计数在诊断外；调用方基线 verdict 已覆盖）。
 */
export function initTocDraftSession(sessionId: string, baseline: TocBaselineSeedEntry[]): void {
  const state = newSessionState();
  baseline.forEach((row, index) => {
    const title = typeof row.title === 'string' ? stripMarkdownLineMarkers(row.title.trim()) : '';
    if (!title || !isSemanticOutlineTitle(title)) return;
    if (!Number.isSafeInteger(row.printedPage)) return;
    const entryId = baselineEntryId(index);
    state.order.push(entryId);
    state.entries.set(entryId, {
      entryId,
      title,
      printedPage: row.printedPage,
      level: row.level === 1 ? 1 : 2,
      kind: row.kind,
      confidence: null,
      needsReview: false,
      change: 'keep',
      base: null,
      reason: null,
    });
  });
  draftSessions.set(sessionId, state);
}

function checkMonotonic(order: string[], entries: Map<string, TocStagedEntry>): string | null {
  let prev = 0;
  for (const id of order) {
    const entry = entries.get(id);
    if (!entry || entry.change === 'remove') continue;
    if (entry.printedPage < prev) return id;
    prev = entry.printedPage;
  }
  return null;
}

function failMessage(reason: TocDraftOpFailReason | 'exhausted'): { code: string; userMessage: string } {
  const messages: Record<TocDraftOpFailReason | 'exhausted', string> = {
    args: '参数结构非法：字段缺失、类型越界或 expectedBefore 为空',
    title: '标题非法：空标题或无语义内容（纯数字/符号），请给出语义标题',
    page: `printedPage 须为 1–${TOC_DRAFT_PAGE_MAX} 的正整数`,
    order: '目录页码必须单调不减：请用 afterEntryId 放到正确位置，或修正页码',
    stale: 'entryId 不存在、已被删除，或 expectedBefore 与现状不符（请按最新状态重试）',
    exhausted: '本会话工具调用已用完，请等待本轮结束',
  };
  const code = reason === 'exhausted' ? 'E_TOC_DRAFT_EXHAUSTED' : `E_TOC_DRAFT_${reason.toUpperCase()}`;
  return { code, userMessage: `${messages[reason]}。请修正后重新调用工具` };
}

interface OpContext {
  state: TocDraftSessionState;
  sessionId: string;
}

function enterOp(sessionId: string): { denied: BusinessError } | OpContext {
  if (!draftToolSessions.has(sessionId)) {
    return {
      denied: new BusinessError('E_TOC_DRAFT_SESSION', '目录工具仅限目录审核会话调用', 'SECURITY', false),
    };
  }
  let state = draftSessions.get(sessionId);
  if (!state) {
    state = newSessionState();
    draftSessions.set(sessionId, state);
  }
  state.calls++;
  if (state.calls > TOC_DRAFT_MAX_OPS_PER_SESSION) {
    state.errorCodes.push('E_TOC_DRAFT_EXHAUSTED');
    const message = failMessage('exhausted');
    return { denied: new BusinessError(message.code, message.userMessage, 'TOOL_EXECUTION', false) };
  }
  return { state, sessionId };
}

function rejectOp(
  state: TocDraftSessionState,
  reason: TocDraftOpFailReason,
  hint: string
): { denied: BusinessError } {
  const message = failMessage(reason);
  state.errorCodes.push(message.code);
  return {
    denied: new BusinessError(message.code, `${message.userMessage}（${hint}）`, 'TOOL_EXECUTION', false),
  };
}

const TocDraftEntryRefSchema = z.string().min(1).max(32);

const TocDraftAddInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    printedPage: z.number(),
    level: z.union([z.literal(1), z.literal(2)]),
    kind: z.union([z.literal('lesson'), z.literal('section')]),
    confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]).optional().default('medium'),
    needsReview: z.boolean().optional().default(false),
    reason: z.string().min(1).max(TOC_DRAFT_MAX_REASON_CHARS),
    afterEntryId: z.string().min(1).max(32).optional(),
    beforeEntryId: z.string().min(1).max(32).optional(),
  })
  .strict()
  .refine((v) => !(v.afterEntryId !== undefined && v.beforeEntryId !== undefined), {
    message: 'afterEntryId 与 beforeEntryId 二选一',
  });

export type TocDraftAddInput = z.infer<typeof TocDraftAddInputSchema>;
export type TocDraftAddRawInput = z.input<typeof TocDraftAddInputSchema>;

const TocDraftExpectedBeforeSchema = z
  .object({
    title: z.string().max(200).optional(),
    printedPage: z.number().optional(),
    level: z.union([z.literal(1), z.literal(2)]).optional(),
    kind: z.union([z.literal('lesson'), z.literal('section')]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'expectedBefore 至少给一个字段' });

const TocDraftUpdatePatchSchema = z
  .object({
    title: z.string().max(200).optional(),
    printedPage: z.number().optional(),
    level: z.union([z.literal(1), z.literal(2)]).optional(),
    kind: z.union([z.literal('lesson'), z.literal('section')]).optional(),
    confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]).nullable().optional(),
    needsReview: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'patch 至少给一个字段' });

const TocDraftUpdateInputSchema = z
  .object({
    entryId: TocDraftEntryRefSchema,
    expectedBefore: TocDraftExpectedBeforeSchema,
    patch: TocDraftUpdatePatchSchema,
    reason: z.string().min(1).max(TOC_DRAFT_MAX_REASON_CHARS),
  })
  .strict();

export type TocDraftUpdateInput = z.infer<typeof TocDraftUpdateInputSchema>;
export type TocDraftUpdateRawInput = z.input<typeof TocDraftUpdateInputSchema>;

const TocDraftRemoveInputSchema = z
  .object({
    entryId: TocDraftEntryRefSchema,
    expectedBefore: TocDraftExpectedBeforeSchema,
    reason: z.string().min(1).max(TOC_DRAFT_MAX_REASON_CHARS),
  })
  .strict();

export type TocDraftRemoveInput = z.infer<typeof TocDraftRemoveInputSchema>;
export type TocDraftRemoveRawInput = z.input<typeof TocDraftRemoveInputSchema>;

export interface TocDraftOpResult {
  accepted: boolean;
  entryId: string;
  entryCount: number;
}

/**
 * 当前可用的插入锚点（纯读）：存活条目中页码 ≤ 给定页码的记为 `id@页码`，
 * 按目录顺序取末尾若干。模型按此选 afterEntryId 即满足单调，无需猜测。
 */
function validAnchorsFor(state: TocDraftSessionState, printedPage: number, limit = 5): string[] {
  const anchors: string[] = [];
  for (const id of state.order) {
    const entry = state.entries.get(id);
    if (!entry || entry.change === 'remove') continue;
    if (entry.printedPage <= printedPage) anchors.push(`${id}@${entry.printedPage}`);
  }
  return anchors.slice(-limit);
}

function matchExpectedBefore(
  entry: TocStagedEntry,
  expected: { title?: string | undefined; printedPage?: number | undefined; level?: (1 | 2) | undefined; kind?: ('lesson' | 'section') | undefined }
): string | null {
  if (expected.title !== undefined && expected.title.trim() !== entry.title) return 'expectedBefore.title';
  if (expected.printedPage !== undefined && expected.printedPage !== entry.printedPage) {
    return 'expectedBefore.printedPage';
  }
  if (expected.level !== undefined && expected.level !== entry.level) return 'expectedBefore.level';
  if (expected.kind !== undefined && expected.kind !== entry.kind) return 'expectedBefore.kind';
  return null;
}

function applyAdd(state: TocDraftSessionState, raw: unknown): TocDraftOpResult | { denied: BusinessError } {
  const parsed = TocDraftAddInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first
      ? first.path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : String(seg))).join('.').replace(/\.\[/g, '[')
      : 'input';
    return rejectOp(state, 'args', path);
  }
  const input = parsed.data;
  const title = cleanTitle(input.title);
  if (!title) return rejectOp(state, 'title', 'title');
  const printedPage = cleanPage(input.printedPage);
  if (printedPage === null) return rejectOp(state, 'page', 'printedPage');
  if (!isLevel(input.level) || !isKind(input.kind)) return rejectOp(state, 'args', 'level/kind');
  const reason = cleanReason(input.reason);
  if (!reason) return rejectOp(state, 'args', 'reason');
  let insertAt = state.order.length;
  if (input.afterEntryId !== undefined) {
    const anchorIndex = state.order.indexOf(input.afterEntryId);
    const anchor = anchorIndex >= 0 ? state.entries.get(input.afterEntryId) : undefined;
    if (!anchor || anchor.change === 'remove') return rejectOp(state, 'args', 'afterEntryId');
    insertAt = anchorIndex + 1;
  } else if (input.beforeEntryId !== undefined) {
    const anchorIndex = state.order.indexOf(input.beforeEntryId);
    const anchor = anchorIndex >= 0 ? state.entries.get(input.beforeEntryId) : undefined;
    if (!anchor || anchor.change === 'remove') return rejectOp(state, 'args', 'beforeEntryId');
    insertAt = anchorIndex;
  }
  const entryId = `n${state.addCounter++}`;
  const entry: TocStagedEntry = {
    entryId,
    title,
    printedPage,
    level: input.level,
    kind: input.kind,
    confidence: input.confidence,
    needsReview: input.needsReview,
    change: 'add',
    base: null,
    reason,
  };
  // 原子：先在副本上验证单调，再落盘。
  const nextOrder = [...state.order];
  nextOrder.splice(insertAt, 0, entryId);
  const nextEntries = new Map(state.entries);
  nextEntries.set(entryId, entry);
  const badId = checkMonotonic(nextOrder, nextEntries);
  if (badId !== null) {
    // 顺序被拒必须给出可插入位置（相邻条目反馈），不让模型猜锚点。
    // 特例：页码小于当前第一条（如第1課@6 插到第2課@18 之前）——页码正确，
    // 直接指引 beforeEntryId 插到最前，绝不能误导"修正页码"。
    const firstLiveId = state.order.find((id) => {
      const entry = state.entries.get(id);
      return entry !== undefined && entry.change !== 'remove';
    });
    const firstLive = firstLiveId !== undefined ? state.entries.get(firstLiveId) : undefined;
    if (firstLive && printedPage < firstLive.printedPage) {
      return rejectOp(
        state,
        'order',
        `页码正确但位置不对：${printedPage} 小于当前第一条 ${firstLiveId}@${firstLive.printedPage}，请用 beforeEntryId: "${firstLiveId}" 插到最前（不要改页码）`
      );
    }
    const anchors = validAnchorsFor(state, printedPage);
    const hint = badId === entryId ? 'printedPage/afterEntryId' : badId;
    return rejectOp(
      state,
      'order',
      anchors.length > 0
        ? `${hint}；可用的 afterEntryId（页码≤${printedPage}）：${anchors.join('、')}`
        : `${hint}；当前无页码≤${printedPage} 的条目，请修正页码`
    );
  }
  state.order = nextOrder;
  state.entries = nextEntries;
  state.successes++;
  return { accepted: true, entryId, entryCount: countLive(state) };
}

function applyUpdate(state: TocDraftSessionState, raw: unknown): TocDraftOpResult | { denied: BusinessError } {
  const parsed = TocDraftUpdateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first
      ? first.path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : String(seg))).join('.').replace(/\.\[/g, '[')
      : 'input';
    return rejectOp(state, 'args', path);
  }
  const input = parsed.data;
  const entry = state.entries.get(input.entryId);
  if (!entry || entry.change === 'remove') return rejectOp(state, 'stale', 'entryId');
  const mismatch = matchExpectedBefore(entry, input.expectedBefore);
  if (mismatch) return rejectOp(state, 'stale', mismatch);
  const reason = cleanReason(input.reason);
  if (!reason) return rejectOp(state, 'args', 'reason');
  const next: TocStagedEntry = { ...entry };
  const patch = input.patch;
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (!title) return rejectOp(state, 'title', 'patch.title');
    next.title = title;
  }
  if (patch.printedPage !== undefined) {
    const printedPage = cleanPage(patch.printedPage);
    if (printedPage === null) return rejectOp(state, 'page', 'patch.printedPage');
    next.printedPage = printedPage;
  }
  if (patch.level !== undefined) {
    if (!isLevel(patch.level)) return rejectOp(state, 'args', 'patch.level');
    next.level = patch.level;
  }
  if (patch.kind !== undefined) {
    if (!isKind(patch.kind)) return rejectOp(state, 'args', 'patch.kind');
    next.kind = patch.kind;
  }
  if (patch.confidence !== undefined) {
    if (patch.confidence !== null && !isConfidence(patch.confidence)) return rejectOp(state, 'args', 'patch.confidence');
    next.confidence = patch.confidence;
  }
  if (patch.needsReview !== undefined) next.needsReview = patch.needsReview;
  // 原子：副本验证后再落盘；base 保留首次变更前快照（diff 的 before 永远是原文）。
  const nextEntries = new Map(state.entries);
  nextEntries.set(input.entryId, {
    ...next,
    change: 'update',
    base: entry.base ?? snapshotOf(entry),
    reason,
  });
  const badId = checkMonotonic(state.order, nextEntries);
  if (badId !== null) return rejectOp(state, 'order', badId);
  state.entries = nextEntries;
  state.successes++;
  return { accepted: true, entryId: input.entryId, entryCount: countLive(state) };
}

function applyRemove(state: TocDraftSessionState, raw: unknown): TocDraftOpResult | { denied: BusinessError } {
  const parsed = TocDraftRemoveInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first
      ? first.path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : String(seg))).join('.').replace(/\.\[/g, '[')
      : 'input';
    return rejectOp(state, 'args', path);
  }
  const input = parsed.data;
  const entry = state.entries.get(input.entryId);
  if (!entry || entry.change === 'remove') return rejectOp(state, 'stale', 'entryId');
  const mismatch = matchExpectedBefore(entry, input.expectedBefore);
  if (mismatch) return rejectOp(state, 'stale', mismatch);
  const reason = cleanReason(input.reason);
  if (!reason) return rejectOp(state, 'args', 'reason');
  const nextEntries = new Map(state.entries);
  nextEntries.set(input.entryId, {
    ...entry,
    change: 'remove',
    base: entry.base ?? snapshotOf(entry),
    reason,
  });
  state.entries = nextEntries;
  state.successes++;
  return { accepted: true, entryId: input.entryId, entryCount: countLive(state) };
}

function countLive(state: TocDraftSessionState): number {
  let count = 0;
  for (const entry of state.entries.values()) {
    if (entry.change !== 'remove') count++;
  }
  return count;
}

export interface TocDraftTakeResult {
  merged: TocStagedEntry[];
  diff: TocStagedDiffRow[];
  calls: number;
  successes: number;
  errorCodes: string[];
}

function assemble(state: TocDraftSessionState): Pick<TocDraftTakeResult, 'merged' | 'diff'> {
  const merged: TocStagedEntry[] = [];
  const diff: TocStagedDiffRow[] = [];
  for (const id of state.order) {
    const entry = state.entries.get(id);
    if (!entry) continue;
    if (entry.change === 'remove') {
      diff.push({
        entryId: id,
        change: 'remove',
        before: entry.base ?? snapshotOf(entry),
        after: null,
        reason: entry.reason,
        needsReview: entry.needsReview,
      });
      continue;
    }
    merged.push(entry);
    const isUntouched = entry.change === 'keep';
    // add 无“改前”：before 必须为 null（此前填新增快照是语义谎言，真机抓到）；
    // keep/update 的 before 为基线原文（base 缺席回退当下快照）。
    const before =
      entry.change === 'add' ? null : isUntouched ? snapshotOf(entry) : (entry.base ?? snapshotOf(entry));
    diff.push({
      entryId: id,
      change: entry.change,
      before,
      after: snapshotOf(entry),
      reason: entry.reason,
      needsReview: entry.needsReview,
    });
  }
  return { merged, diff };
}

/**
 * 读并删除会话暂存（review loop 所有轮次结束后的终态唯一读取点；
 * 成功/unavailable/异常全调）。同时注销会话登记。
 */
export function takeTocDraftSession(sessionId: string): TocDraftTakeResult | null {
  const state = draftSessions.get(sessionId);
  draftSessions.delete(sessionId);
  draftToolSessions.delete(sessionId);
  if (!state) return null;
  const { merged, diff } = assemble(state);
  return { merged, diff, calls: state.calls, successes: state.successes, errorCodes: [...state.errorCodes] };
}

/**
 * 只读查看会话暂存（不删除、不注销；供多轮 loop 在终态前判断是否还值得
 * 再开一轮：预算耗尽则不再浪费一次模型轮次）。
 */
export function peekTocDraftSession(sessionId: string): TocDraftTakeResult | null {
  const state = draftSessions.get(sessionId);
  if (!state) return null;
  const { merged, diff } = assemble(state);
  return { merged, diff, calls: state.calls, successes: state.successes, errorCodes: [...state.errorCodes] };
}

export type TocMergedGateReason = 'ok' | 'too-few' | 'bad-title' | 'page-regress';

/**
 * 合并结果终态门（纯函数）：可采用条数 / 标题语义 / 页码单调。
 * 单步 op 已各自保证，终态再守一次（防御性纵深，不抛）。
 */
export function validateMergedEntries(entries: TocStagedEntry[]): { ok: boolean; reason: TocMergedGateReason } {
  if (entries.length < TOC_DRAFT_MIN_ENTRIES) return { ok: false, reason: 'too-few' };
  let prev = 0;
  for (const entry of entries) {
    const title = entry.title.trim();
    if (!title || !isSemanticOutlineTitle(title)) return { ok: false, reason: 'bad-title' };
    if (!Number.isSafeInteger(entry.printedPage) || entry.printedPage < 1) return { ok: false, reason: 'page-regress' };
    if (entry.printedPage < prev) return { ok: false, reason: 'page-regress' };
    prev = entry.printedPage;
  }
  return { ok: true, reason: 'ok' };
}

function toolResult(
  sessionId: string,
  raw: unknown,
  apply: (state: TocDraftSessionState, input: unknown) => TocDraftOpResult | { denied: BusinessError }
): Promise<Result<TocDraftOpResult, BusinessError>> {
  const entered = enterOp(sessionId);
  if ('denied' in entered) return Promise.resolve(err(entered.denied));
  const outcome = apply(entered.state, raw);
  if ('denied' in outcome) return Promise.resolve(err(outcome.denied));
  return Promise.resolve(ok(outcome));
}

/**
 * 三个 Server Tool 均为 session-local staged write（常规 WRITE：替换本次
 * review 会话的内存草稿；无持久化副作用、不写 documents/AST/textbook_*）。
 * 全局 registry 注册（adapter 执行链要求），但仅 review 会话在 createSession
 * 时声明，未声明的会话模型调不到（Codex 只放行已声明 dynamicTools），
 * 且执行侧有会话登记门。
 */
const TOOL_DESCRIPTION_SUFFIX =
  '自然语言回复会被忽略，草稿只认本次工具调用；每次调用独立校验，失败零副作用。';

export class TocDraftAddEntryTool implements ToolDefinition<TocDraftAddRawInput, TocDraftOpResult> {
  public readonly name = TOC_DRAFT_ADD_ENTRY_TOOL;
  public readonly description =
    '目录草稿新增一条：语义标题 + 印刷页码（只取目录上印出的数字）+ level 1|2 + kind + evidence reason；可选 afterEntryId 插到指定条目之后（缺席追加末尾；顺序被拒时会给出可用锚点，直接照抄即可）；页码小于当前第一条时用 beforeEntryId 插到最前。' +
    TOOL_DESCRIPTION_SUFFIX;
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = TocDraftAddInputSchema;

  public async execute(
    input: unknown,
    context: ToolExecutionContext
  ): Promise<Result<TocDraftOpResult, BusinessError>> {
    return toolResult(context.sessionId, input, applyAdd);
  }
}

export class TocDraftUpdateEntryTool implements ToolDefinition<TocDraftUpdateRawInput, TocDraftOpResult> {
  public readonly name = TOC_DRAFT_UPDATE_ENTRY_TOOL;
  public readonly description =
    '目录草稿修改一条：必须 entryId + expectedBefore（所给字段须与现状一致，否则拒收）；patch 至少改一个字段，可顺手标 needsReview。' +
    TOOL_DESCRIPTION_SUFFIX;
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = TocDraftUpdateInputSchema;

  public async execute(
    input: unknown,
    context: ToolExecutionContext
  ): Promise<Result<TocDraftOpResult, BusinessError>> {
    return toolResult(context.sessionId, input, applyUpdate);
  }
}

export class TocDraftRemoveEntryTool implements ToolDefinition<TocDraftRemoveRawInput, TocDraftOpResult> {
  public readonly name = TOC_DRAFT_REMOVE_ENTRY_TOOL;
  public readonly description =
    '目录草稿删除一条：必须 entryId + expectedBefore（所给字段须与现状一致，否则拒收）；误删可由后续 add 补回。' +
    TOOL_DESCRIPTION_SUFFIX;
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = TocDraftRemoveInputSchema;

  public async execute(
    input: unknown,
    context: ToolExecutionContext
  ): Promise<Result<TocDraftOpResult, BusinessError>> {
    return toolResult(context.sessionId, input, applyRemove);
  }
}

/** review 会话声明的三个工具单例（createSession tools 用此组）。 */
export const tocDraftOpTools = [
  new TocDraftAddEntryTool(),
  new TocDraftUpdateEntryTool(),
  new TocDraftRemoveEntryTool(),
] as const;

/** 工具名匹配（本地实现：gateway 禁止 import agent-codex；sanitize 口径与 tools-bridge 一致）。 */
export function isTocDraftOpCall(toolName: string): boolean {
  if (
    toolName === TOC_DRAFT_ADD_ENTRY_TOOL ||
    toolName === TOC_DRAFT_UPDATE_ENTRY_TOOL ||
    toolName === TOC_DRAFT_REMOVE_ENTRY_TOOL
  ) {
    return true;
  }
  const sanitized = toolName
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 64);
  return (
    sanitized === TOC_DRAFT_ADD_ENTRY_TOOL ||
    sanitized === TOC_DRAFT_UPDATE_ENTRY_TOOL ||
    sanitized === TOC_DRAFT_REMOVE_ENTRY_TOOL
  );
}

/**
 * 可观测事件（P3.4A 起，P3.5 沿用）：仅固定枚举 + 计数，无标题/正文/图片/路径/用户/模型原文。
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
