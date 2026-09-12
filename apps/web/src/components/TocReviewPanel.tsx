import React, { useReducer, useRef, useState } from 'react';
import {
  CheckCircle2,
  ListChecks,
  PencilLine,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import {
  useReviewTocMutation,
  streamDiscoverToc,
  streamExtractTocBaseline,
  type TocPdfSource,
} from '../queries/useLearnerQueries.js';
import { DEFAULT_USER_ID } from '../queries/query-keys.js';
import {
  applyTocExtractStreamEvent,
  cancelledTocExtractProgress,
  initialTocExtractProgress,
  isTocExtractPending,
  shouldAcceptExtractStreamEvent,
  tocExtractStageLabel,
  type TocExtractProgress,
} from '../lib/toc-baseline-stream.js';
import { TocAnchorPanel } from './TocAnchorPanel.js';
import {
  applyTocStreamEvent,
  cancelledTocDiscoverProgress,
  initialTocDiscoverProgress,
  isTocDiscoverPending,
  shouldAcceptStreamEvent,
  tocDiscoverStageLabel,
  type TocDiscoverProgress,
} from '../lib/toc-discovery-stream.js';
import {
  TOC_REVIEW_MAX_PAGES_UI,
  buildAiAdoptedEntries,
  canRequestTocReview,
  decideExtractRequest,
  decideReviewRequest,
  initialTocConfirmState,
  resolveTocReviewModelRequest,
  toEditableEntries,
  tocConfirmReducer,
  validateTocConfirmRange,
  type EditableTocEntry,
  type TocAdoptSource,
  type TocBaselineData,
  type TocDiscoveryData,
  type TocReviewData,
  type TocReviewModelMode,
  type TocReviewModelSession,
} from '../lib/toc-confirm-flow.js';
import type { TocAdoptReport } from '../lib/toc-result-view.js';
import { TocReviewConfigDialog, TocReviewProgressDialog } from './toc/TocReviewDialogs.js';
import type { TocModelConfig } from './toc/TocReviewDialogs.js';
import { TocResultDialog } from './toc/TocResultDialog.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';

/**
 * CMD-LINGUA-P4C：目录识别 → 选范围 → OCR 基线 → AI 审核草稿 → 人工确认。
 *
 * 确认流程，不是导入落库流程：只调 discover/extract/review 三个只读端点，
 * 不创建 document，不写 AST / textbook_* / SQLite，不自动采纳 AI draft；
 * 确认结果只活在当前页面 state（useReducer），刷新即失，文案如实说明。
 * 旧 PDF 导入链路一字未动；本面板不可用不阻塞旧流程。
 */

export interface TocReviewPanelProps {
  /** <32MB 小文件（超大视为无，由调用方按既有守卫过滤） */
  file: File | null;
  /** 本机绝对路径直读（调用方已剥引号也可，面板内不再处理） */
  filePath: string;
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function kindLabel(kind: string): string {
  return kind === 'lesson' ? '课' : '节';
}

function sourceLabel(source: string): string {
  if (source === 'geometry-block') return '几何块';
  // 旧网关兼容（收窄层已映射，此处兜底展示不断线）。
  if (source === 'geometry') return '几何块';
  if (source === 'table') return '表格';
  return '文本';
}

function confidenceBadge(confidence: string): 'emerald' | 'amber' | 'outline' {
  if (confidence === 'high') return 'emerald';
  if (confidence === 'medium') return 'amber';
  return 'outline';
}

const inputClassName =
  'h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500 text-[11px]';

export interface TocReviewPanelViewProps {
  hasSource: boolean;
  discovering: boolean;
  /** 流式进度（null = 尚未开始；只含服务端上报的真实数字）。 */
  discoverProgress: TocDiscoverProgress | null;
  discoverError: string | null;
  discover: TocDiscoveryData | null;
  selectedIndex: number | null;
  startText: string;
  endText: string;
  rangeError: string | null;
  extractDisabled: boolean;
  extractDisabledReason: string | null;
  extracting: boolean;
  /** 流式基线进度（null = 尚未开始；只含服务端上报的真实数字）。 */
  extractProgress: TocExtractProgress | null;
  onCancelExtract(): void;
  extractError: string | null;
  baseline: TocBaselineData | null;
  reviewDisabled: boolean;
  reviewDisabledReason: string | null;
  reviewSizeHint: string | null;
  reviewing: boolean;
  reviewError: string | null;
  review: TocReviewData | null;
  adopted: TocAdoptSource | null;
  editing: boolean;
  editedEntries: EditableTocEntry[];
  confirmed: boolean;
  confirmedSummary: string | null;
  /** thin/empty 基线不可直接采用（服务端同样拒绝；前端禁用只是辅助）。 */
  adoptDisabled: boolean;
  /** 手动建草稿（thin/empty 时的唯一出路；不复制垃圾基线）。 */
  onStartManual(): void;
  onAddEntry(): void;
  onRemoveEntry(key: string): void;
  /** 确认按钮禁用（空表/空标题行）；hint 由容器经 rangeError 复用展示。 */
  confirmDisabled: boolean;
  onDiscover(): void;
  onCancelDiscover(): void;
  onSelectCandidate(index: number): void;
  onStartChange(value: string): void;
  onEndChange(value: string): void;
  onExtract(): void;
  onReview(): void;
  /** 打开 AI 重建结果大 Dialog（有草稿时才启用）。 */
  onOpenResult(): void;
  onAdopt(source: TocAdoptSource): void;
  onStartEdit(): void;
  onUpdateEntry(key: string, patch: Partial<EditableTocEntry>): void;
  onConfirm(): void;
}

/** 纯展示视图（无 hooks）：所有状态经 props 注入，供 SSR 单测直渲各态。 */
export function TocReviewPanelView(props: TocReviewPanelViewProps): React.ReactElement {
  const {
    hasSource,
    discovering,
    discoverProgress,
    discoverError,
    discover,
    selectedIndex,
    startText,
    endText,
    rangeError,
    extractDisabled,
    extractDisabledReason,
    extracting,
    extractProgress,
    onCancelExtract,
    extractError,
    baseline,
    reviewDisabled,
    reviewDisabledReason,
    reviewSizeHint,
    reviewing,
    reviewError,
    review,
    adopted,
    editing,
    editedEntries,
    confirmed,
    confirmedSummary,
    onDiscover,
    onCancelDiscover,
    adoptDisabled,
    onStartManual,
    onAddEntry,
    onRemoveEntry,
    confirmDisabled,
    onSelectCandidate,
    onStartChange,
    onEndChange,
    onExtract,
    onReview,
    onOpenResult,
    onAdopt,
    onStartEdit,
    onUpdateEntry,
    onConfirm,
  } = props;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-ghost">
        只读流程：只调识别 / 基线 / 审核接口，不创建文档、不入库；确认结果只保存在当前页面状态，尚未写入教材。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 text-[11px] gap-1.5"
          disabled={!hasSource || discovering}
          onClick={onDiscover}
          title={hasSource ? '用受限 OCR 找疑似目录页（只读）' : '先选择 PDF 文件或填写本机路径'}
        >
          <ScanSearch className="w-3.5 h-3.5 text-tone-amber-600" />
          <span>{discovering ? '识别中…' : '识别目录'}</span>
        </Button>
        {!hasSource && (
          <span className="text-[11px] text-ink-stone-400">先选择 PDF 文件或填写本机路径，再识别目录</span>
        )}
      </div>
      {discoverProgress && discoverProgress.started && discovering && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
          <span aria-live="polite">{tocDiscoverStageLabel(discoverProgress)}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={onCancelDiscover}
          >
            取消识别
          </Button>
        </div>
      )}
      {discoverProgress?.runtimeDownloading && discovering && (
        <p className="text-[11px] text-ink-ghost">
          正在准备本地 OCR 运行时，首次可能下载约 80MB（一次性，之后不再下载）。
        </p>
      )}
      {discoverProgress?.phase === 'cancelled' && (
        <p className="text-[11px] text-ink-ghost">
          已取消识别，未采纳任何结果；可重新识别，或直接在下方手动填写范围。
        </p>
      )}
      {discoverError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {discoverError}
        </p>
      )}
      {discover && discover.outlineQuality === 'usable' && (
        <div className="p-2 rounded-xl border border-line-emerald-500o30 bg-wash-emerald-500o5 text-[11px] text-ink-faint">
          本书自带可用的原生目录，已使用内嵌目录，无需 OCR 找目录页。请直接用上方「预览结构」的原生目录，本流程不再做基线与 AI 审核。
        </div>
      )}
      {discover && discover.outlineQuality === 'unusable' && (
        <div className="p-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 text-[11px] text-ink-faint">
          检测到 PDF 内嵌书签，但标题不足以构成教材目录；已改用 OCR 识别。请从下方候选或手动填写范围继续。
        </div>
      )}
      {discover && !discover.embedded && discover.status === 'found' && (
        <div className="text-[11px] text-ink-faint space-y-1">
          <p className="font-bold">候选目录范围（仍需你手动确认，不会自动采用）：</p>
          <div className="flex flex-wrap gap-1.5">
            {discover.candidates.map((candidate, index) => (
              <button
                key={`${candidate.fromPage}-${candidate.toPage}`}
                type="button"
                aria-pressed={selectedIndex === index}
                onClick={() => onSelectCandidate(index)}
                className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
                  selectedIndex === index
                    ? 'border-tone-amber-600 bg-tone-amber-600 text-tone-white'
                    : 'border-line hover:border-tone-amber-500o50'
                }`}
              >
                第 {candidate.fromPage}–{candidate.toPage} 页 · 得分 {candidate.score}
              </button>
            ))}
          </div>
        </div>
      )}
      {discover && !discover.embedded && discover.status === 'ambiguous' && (
        <div className="text-[11px] text-ink-faint space-y-1">
          <p className="font-bold">
            发现 {discover.candidates.length} 个候选范围（得分仅供参考），请手动选一个，不会自动选择：
          </p>
          <div className="flex flex-wrap gap-1.5">
            {discover.candidates.map((candidate, index) => (
              <button
                key={`${candidate.fromPage}-${candidate.toPage}`}
                type="button"
                aria-pressed={selectedIndex === index}
                onClick={() => onSelectCandidate(index)}
                className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
                  selectedIndex === index
                    ? 'border-tone-amber-600 bg-tone-amber-600 text-tone-white'
                    : 'border-line hover:border-tone-amber-500o50'
                }`}
              >
                第 {candidate.fromPage}–{candidate.toPage} 页 · 得分 {candidate.score}
              </button>
            ))}
          </div>
        </div>
      )}
      {discover && !discover.embedded && discover.status === 'not-found' && (
        <div className="p-2 rounded-xl border border-line text-[11px] text-ink-faint">
          未找到可信目录页（已看前 {discover.pagesScannedCount} 页）。可以手工填写开始 / 结束页继续，不猜测页码。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-ghost">
        <span className="font-bold text-ink-mute-deep">确认范围：</span>
        <span className="text-ink-stone-400">熟悉教材可直接填写，跳过自动识别（不发识别请求）</span>
        <input
          type="number"
          min={1}
          placeholder="起始页"
          aria-label="目录起始页"
          value={startText}
          onChange={(e) => onStartChange(e.target.value)}
          className={`${inputClassName} w-20`}
        />
        <span>–</span>
        <input
          type="number"
          min={1}
          placeholder="结束页"
          aria-label="目录结束页"
          value={endText}
          onChange={(e) => onEndChange(e.target.value)}
          className={`${inputClassName} w-20`}
        />
        <span className="text-ink-stone-400">正整数，含两端，一次最多 30 页</span>
      </div>
      {rangeError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {rangeError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 text-[11px] gap-1.5"
          disabled={extractDisabled}
          onClick={onExtract}
          title={extractDisabledReason ?? '对确认范围做本地 OCR，产出目录基线（只读）'}
        >
          <ListChecks className="w-3.5 h-3.5 text-tone-amber-600" />
          <span>{extracting ? '提取中…' : '提取目录基线'}</span>
        </Button>
        {extractDisabledReason && <span className="text-[11px] text-ink-stone-400">{extractDisabledReason}</span>}
      </div>
      {extractProgress && extractProgress.started && extracting && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
          <span aria-live="polite">{tocExtractStageLabel(extractProgress)}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={onCancelExtract}
          >
            取消提取
          </Button>
        </div>
      )}
      {extractProgress?.runtimeDownloading && extracting && (
        <p className="text-[11px] text-ink-ghost">
          正在准备本地 OCR 运行时，首次可能下载约 80MB（一次性，之后不再下载）。
        </p>
      )}
      {extractProgress?.phase === 'cancelled' && (
        <p className="text-[11px] text-ink-ghost">
          已取消提取，未采纳任何结果；可重新提取，或直接手动填写范围。
        </p>
      )}
      {extractError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {extractError}
        </p>
      )}
      {baseline && (
        <div className="rounded-xl border border-tone-amber-500o25 bg-wash-amber-500o5 p-2 space-y-1.5">
          <p className="text-[11px] font-bold text-ink-mute-deep">
            OCR 基线：第 {baseline.range.fromPage}–{baseline.range.toPage} 页，共 {baseline.entries.length} 条
            {baseline.embedded && <span>（原生目录可用，本次零 OCR）</span>}
          </p>
          <p className="text-[11px] text-ink-ghost">
            printedPage 是教材印刷页，不等于 PDF 物理页，请勿直接当页码跳转。
            {baseline.entries.length === 0 && '本次没有提取到可用条目，可以换一段页码重试。'}
          </p>
          {!baseline.embedded && baseline.verdict !== 'usable' && (
            <div className="p-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 text-[11px] text-ink-faint">
              {baseline.verdict === 'empty'
                ? '规则未形成目录条目，但如目录原文证据足够，可让 AI 根据原文与页面图重建草稿（点 AI 审核；证据不足时会明确提示）。结果不足，不能直接采用；也可以换一段页码重试，或在下方手动填写。'
                : `结果不足，不能直接采用（仅 ${baseline.entries.length} 条有效条目${
                    baseline.diagnostics.badTitle > 0 ? `，${baseline.diagnostics.badTitle} 行标题存疑已剔除` : ''
                  }）。印刷页码（如 322）是书内页码，不是错误。可以换一段页码重试、点 AI 审核按证据重建，或在下方手动填写。`}
            </div>
          )}
          {baseline.entries.length > 0 && (
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {baseline.entries.map((entry, index) => (
                <div
                  key={`${entry.printedPage}-${index}`}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-veil-whiteo60-stone-900o40 text-[11px]"
                >
                  <span className="truncate">
                    {entry.title}
                    <span className="ml-1 font-mono text-ink-stone-400" title="教材印刷页（书内页码），不是 PDF 物理页">
                      印{entry.printedPage}页
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {kindLabel(entry.kind)}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]" title="geometry-block=版式坐标证据 · text-fallback=纯文本">
                      {sourceLabel(entry.source)}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] font-mono text-ink-stone-400">
            请求 {baseline.diagnostics.pagesRequested} 页 · OCR {baseline.diagnostics.pagesOcr} 页 · 接受{' '}
            {baseline.diagnostics.entriesAccepted} · 拒绝 {baseline.diagnostics.entriesRejected}
            {baseline.diagnostics.badTitle > 0 && ` · 标题不合 ${baseline.diagnostics.badTitle}`}
            {baseline.diagnostics.entriesFromBlocks > 0 && ` · 版式 ${baseline.diagnostics.entriesFromBlocks}`}
            {baseline.diagnostics.unresolvedBlocks > 0 &&
              ` · ${baseline.diagnostics.unresolvedBlocks} 个标题未定位页码（待定，不猜）`}
          </p>
          {baseline.pageEvidence.length > 0 && (
            <details className="text-[11px] text-ink-ghost">
              <summary className="cursor-pointer font-bold">查看 OCR 原文证据（每页截断，只读）</summary>
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 pt-1">
                {baseline.pageEvidence.map((evidence) => (
                  <div key={evidence.page} className="space-y-0.5">
                    <p className="font-mono text-[10px] text-ink-stone-400">PDF 第 {evidence.page} 页</p>
                    <pre className="whitespace-pre-wrap break-words px-2 py-1 rounded-lg bg-veil-whiteo60-stone-900o40 text-[11px] font-sans">
                      {evidence.excerpt || '（本页无保留行）'}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {baseline && !baseline.embedded && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            disabled={reviewDisabled}
            onClick={onReview}
            title={reviewDisabledReason ?? '打开 AI 重建目录配置（只读流程，不入库）'}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{reviewing ? '审核中…' : 'AI 重建目录…'}</span>
          </Button>
          {(reviewDisabledReason ?? reviewSizeHint) && (
            <span className="text-[11px] text-ink-stone-400">{reviewDisabledReason ?? reviewSizeHint}</span>
          )}
        </div>
      )}
      {review && !review.embedded && review.draft && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-tone-amber-500o25 bg-wash-amber-500o5 p-2">
          <p className="text-[11px] text-ink-faint">
            AI 草稿已就绪：基线 {review.diagnostics.baselineEntries} 条 → 合并 {review.diagnostics.draftEntries} 条
            {review.draft.diff.filter((d) => d.change !== 'keep').length > 0 &&
              `（含 ${review.draft.diff.filter((d) => d.change !== 'keep').length} 项变更）`}
            ，需人工确认后采用。
          </p>
          <Button type="button" size="sm" className="h-7 text-[11px]" onClick={onOpenResult}>
            打开 AI 草稿大结果
          </Button>
        </div>
      )}
      {reviewError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {reviewError}
        </p>
      )}
      {review && review.embedded && (
        <div className="p-2 rounded-xl border border-line-emerald-500o30 bg-wash-emerald-500o5 text-[11px] text-ink-faint">
          原生目录可用，本次没有触发 AI 审核（embedded=true），请直接用原生目录。
        </div>
      )}
      {review && !review.embedded && review.reviewStatus === 'unavailable' && (
        <div className="p-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 text-[11px] text-ink-faint space-y-1">
          <p className="font-bold">AI 审核暂不可用：{review.reviewError?.userMessage ?? '模型输出不合要求，已保留基线'}</p>
          <p>基线仍在上方，可直接采用基线，或手动填写后确认（错误码 {review.reviewError?.code ?? 'E_TOC_REVIEW_TOOL_INVALID'}，未记录模型原文）。</p>
        </div>
      )}

      {(baseline || (review && !review.embedded && review.draft)) && !confirmed && (
        <div className="flex flex-wrap items-center gap-2">
          {baseline && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={extracting || reviewing || adoptDisabled}
              onClick={() => onAdopt('ocr')}
              title={adoptDisabled ? '基线不足，不能直接采用（可手动填写）' : undefined}
            >
              采用 OCR 基线
            </Button>
          )}
          {review && !review.embedded && review.draft && (
            <span className="text-[11px] text-ink-stone-400">AI 草稿请在结果大 Dialog 内逐条确认采用（上方按钮打开）。</span>
          )}
          {baseline && !baseline.embedded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={extracting || reviewing}
              onClick={onStartManual}
              title="从空白行开始手动填写目录，不复制基线"
            >
              手动填写
            </Button>
          )}
          {adopted && !editing && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={onStartEdit}
            >
              <PencilLine className="w-3.5 h-3.5" />
              继续编辑
            </Button>
          )}
        </div>
      )}
      {adopted && (
        <div className="rounded-xl border border-line p-2 space-y-1.5">
          <p className="text-[11px] font-bold text-ink-mute-deep">
            待确认：{adopted === 'ocr' ? 'OCR 基线' : adopted === 'ai' ? 'AI 草稿' : '手动填写'}（{editedEntries.length} 条，只改本地状态）
          </p>
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {editedEntries.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <input
                  type="text"
                  aria-label="条目标题"
                  value={entry.title}
                  disabled={!editing}
                  onChange={(e) => onUpdateEntry(entry.key, { title: e.target.value })}
                  className={`${inputClassName} flex-1 min-w-28`}
                />
                <input
                  type="number"
                  min={1}
                  aria-label="印刷页码"
                  value={entry.printedPage}
                  disabled={!editing}
                  onChange={(e) => onUpdateEntry(entry.key, { printedPage: e.target.value })}
                  className={`${inputClassName} w-16`}
                />
                <Select
                  value={entry.level === 1 ? '1' : '2'}
                  disabled={!editing}
                  onValueChange={(v) => {
                    if (v === '1' || v === '2') onUpdateEntry(entry.key, { level: v === '1' ? 1 : 2 });
                  }}
                >
                  <SelectTrigger className="h-7 w-16 text-[11px]" aria-label="层级">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-[11px]">
                      1·课
                    </SelectItem>
                    <SelectItem value="2" className="text-[11px]">
                      2·节
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={entry.kind}
                  disabled={!editing}
                  onValueChange={(v) => {
                    if (v === 'lesson' || v === 'section') onUpdateEntry(entry.key, { kind: v });
                  }}
                >
                  <SelectTrigger className="h-7 w-16 text-[11px]" aria-label="类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lesson" className="text-[11px]">
                      课
                    </SelectItem>
                    <SelectItem value="section" className="text-[11px]">
                      节
                    </SelectItem>
                  </SelectContent>
                </Select>
                {entry.confidence && (
                  <Badge variant={confidenceBadge(entry.confidence)} className="text-[10px]">
                    {entry.confidence}
                  </Badge>
                )}
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-ink-rose-600"
                    onClick={() => onRemoveEntry(entry.key)}
                    aria-label="删除本行"
                  >
                    删除
                  </Button>
                )}
              </div>
            ))}
          </div>
          {editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={onAddEntry}
            >
              添加一行
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            disabled={confirmDisabled}
            onClick={onConfirm}
            title={confirmDisabled ? '每行标题不能为空，确认范围需合法' : undefined}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            确认目录
          </Button>
        </div>
      )}
      {confirmed && confirmedSummary && (
        <div className="p-2 rounded-xl border border-line-emerald-500o30 bg-wash-emerald-500o5 text-[11px] text-ink-faint space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-tone-emerald-600" />
            {confirmedSummary}
          </p>
          <p>目录已在本次导入流程中确认；下一阶段才会生成教材结构。</p>
          <p>尚未写入教材：没有创建文档，也没有调用任何保存接口。</p>
          <p>刷新页面后需重新确认（本状态只保存在当前页面，没有持久化）。</p>
        </div>
      )}
    </div>
  );
}

/** 容器：流式识别进度（本地 state）+ TanStack 基线/审核 + reducer 确认状态；确认动作零写。 */
export function TocReviewPanel({ file, filePath }: TocReviewPanelProps): React.ReactElement {
  const [flow, dispatch] = useReducer(tocConfirmReducer, initialTocConfirmState);
  const review = useReviewTocMutation();
  // P2.1 流式识别：进度只活本地 state；runId 换代丢弃迟到事件（取消后到达的
  // completed 不采纳）；取消只 abort + 置终态，不写错误（取消不是失败）。
  const [discoverProgress, setDiscoverProgress] = useState<TocDiscoverProgress | null>(null);
  const [discoverData, setDiscoverData] = useState<TocDiscoveryData | null>(null);
  const [discoverErrorText, setDiscoverErrorText] = useState<string | null>(null);
  const discoverRunRef = useRef(0);
  const discoverCtrlRef = useRef<AbortController | null>(null);
  const discovering = isTocDiscoverPending(discoverProgress);
  // P3.3 流式基线：同 discover 的世代守门；取消即换代，迟到 completed 丢弃。
  const [extractProgress, setExtractProgress] = useState<TocExtractProgress | null>(null);
  const [extractData, setExtractData] = useState<TocBaselineData | null>(null);
  const [extractErrorText, setExtractErrorText] = useState<string | null>(null);
  const extractRunRef = useRef(0);
  const extractCtrlRef = useRef<AbortController | null>(null);
  const extracting = isTocExtractPending(extractProgress);

  const source: TocPdfSource | null = file
    ? { file }
    : filePath.trim()
      ? { filePath: filePath.trim() }
      : null;
  const validation = validateTocConfirmRange(flow.startText, flow.endText);
  const baseline: TocBaselineData | null = extractData;
  const reviewData: TocReviewData | null = review.data ?? null;

  const resetExtractState = (): void => {
    extractRunRef.current += 1;
    extractCtrlRef.current?.abort();
    extractCtrlRef.current = null;
    setExtractProgress(null);
    setExtractData(null);
    setExtractErrorText(null);
  };

  const reviewSizeOk = validation.ok && canRequestTocReview(validation.from, validation.to);

  const handleDiscover = (): void => {
    if (!source || discovering) return;
    const runId = discoverRunRef.current + 1;
    discoverRunRef.current = runId;
    discoverCtrlRef.current?.abort();
    const controller = new AbortController();
    discoverCtrlRef.current = controller;
    resetExtractState();
    review.reset();
    dispatch({ type: 'reset-flow' });
    setDiscoverData(null);
    setDiscoverErrorText(null);
    setDiscoverProgress({ ...initialTocDiscoverProgress, started: true });
    void streamDiscoverToc(DEFAULT_USER_ID, source, {
      signal: controller.signal,
      onEvent: (event) => {
        if (!shouldAcceptStreamEvent(runId, discoverRunRef.current, false)) return;
        setDiscoverProgress((prev) => applyTocStreamEvent(prev ?? initialTocDiscoverProgress, event));
        if (event.type === 'completed' && event.data) setDiscoverData(event.data);
      },
    })
      .then(({ cancelled }) => {
        if (!shouldAcceptStreamEvent(runId, discoverRunRef.current, false)) return;
        if (cancelled) setDiscoverProgress(cancelledTocDiscoverProgress);
      })
      .catch((e: unknown) => {
        if (!shouldAcceptStreamEvent(runId, discoverRunRef.current, false)) return;
        const message = messageOf(e);
        setDiscoverErrorText(message);
        setDiscoverProgress((prev) => ({
          ...(prev ?? initialTocDiscoverProgress),
          started: true,
          phase: 'failed',
          error: message,
        }));
      });
  };

  const handleCancelDiscover = (): void => {
    discoverRunRef.current += 1;
    discoverCtrlRef.current?.abort();
    discoverCtrlRef.current = null;
    setDiscoverErrorText(null);
    setDiscoverProgress(cancelledTocDiscoverProgress);
  };

  const handleExtract = (): void => {
    if (!source || extracting) return;
    const decision = decideExtractRequest(source !== null, flow.startText, flow.endText);
    if (!decision.ok) return;
    const runId = extractRunRef.current + 1;
    extractRunRef.current = runId;
    extractCtrlRef.current?.abort();
    const controller = new AbortController();
    extractCtrlRef.current = controller;
    review.reset();
    dispatch({ type: 'clear-results' });
    setExtractData(null);
    setExtractErrorText(null);
    setExtractProgress({ ...initialTocExtractProgress, started: true });
    void streamExtractTocBaseline(
      DEFAULT_USER_ID,
      source,
      { startPage: decision.from, endPage: decision.to },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (!shouldAcceptExtractStreamEvent(runId, extractRunRef.current, false)) return;
          setExtractProgress((prev) => applyTocExtractStreamEvent(prev ?? initialTocExtractProgress, event));
          if (event.type === 'completed' && event.data) setExtractData(event.data);
        },
      }
    )
      .then(({ cancelled }) => {
        if (!shouldAcceptExtractStreamEvent(runId, extractRunRef.current, false)) return;
        if (cancelled) setExtractProgress(cancelledTocExtractProgress);
      })
      .catch((e: unknown) => {
        if (!shouldAcceptExtractStreamEvent(runId, extractRunRef.current, false)) return;
        const message = messageOf(e);
        setExtractErrorText(message);
        setExtractProgress((prev) => ({
          ...(prev ?? initialTocExtractProgress),
          started: true,
          phase: 'failed',
          error: message,
        }));
      });
  };

  const handleCancelExtract = (): void => {
    extractRunRef.current += 1;
    extractCtrlRef.current?.abort();
    extractCtrlRef.current = null;
    setExtractErrorText(null);
    setExtractProgress(cancelledTocExtractProgress);
  };

  const [configOpen, setConfigOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  // P3.5-FIX2 审核批次：每次 review 成功递增；结果 Dialog 以 key 重挂，
  // 新批次清空旧 rows/selected/filter/编辑，同批次关闭重开靠 aiAdoption 回显。
  const [reviewRunId, setReviewRunId] = useState(0);
  // P3.5-FIX2：本次模型覆盖只活页面 state（模式 + 值）；持久偏好走 zustand persist。
  const savedTocModel = usePreferencesStore((s) => s.tocReviewModel);
  const savedTocEffort = usePreferencesStore((s) => s.tocReviewEffort);
  const setSavedTocModel = usePreferencesStore((s) => s.setTocReviewModel);
  const setSavedTocEffort = usePreferencesStore((s) => s.setTocReviewEffort);
  const [sessionTocModel, setSessionTocModel] = useState('');
  const [sessionTocModelMode, setSessionTocModelMode] = useState<TocReviewModelMode>('inherit');
  const [sessionTocEffort, setSessionTocEffort] = useState('');
  const [sessionTocEffortMode, setSessionTocEffortMode] = useState<TocReviewModelMode>('inherit');
  // P3.5-FIX：AI 采用回执只活页面 state（选中 id + 编辑）；Dialog 关闭再打开按此回显。
  const [aiAdoption, setAiAdoption] = useState<{
    ids: string[];
    editedById: Record<string, EditableTocEntry>;
  } | null>(null);

  const handleReview = (): void => {
    // P3.5：按钮只打开配置 Dialog，真正的 mutate 由配置确认触发。
    if (review.isPending) return;
    const decision = decideReviewRequest(
      source !== null,
      flow.startText,
      flow.endText,
      baseline ? { embedded: baseline.embedded } : null
    );
    if (!decision.ok) return;
    setConfigOpen(true);
  };

  const handleStartReview = (config?: TocModelConfig): void => {
    if (review.isPending) return;
    const decision = decideReviewRequest(
      source !== null,
      flow.startText,
      flow.endText,
      baseline ? { embedded: baseline.embedded } : null
    );
    if (!decision.ok) return;
    if (!source) return;
    // P3.5-FIX2：inherit-saved / force-default / explicit。
    // 本次无配置回执（旧入口）沿用 panel 已存的本次覆盖；有回执则更新覆盖。
    const session: TocReviewModelSession = config
      ? { model: config.model, modelMode: config.modelMode, effort: config.effort, effortMode: config.effortMode }
      : { model: sessionTocModel, modelMode: sessionTocModelMode, effort: sessionTocEffort, effortMode: sessionTocEffortMode };
    if (config) {
      setSessionTocModel(config.model);
      setSessionTocModelMode(config.modelMode);
      setSessionTocEffort(config.effort);
      setSessionTocEffortMode(config.effortMode);
      if (config.remember) {
        // 记住本次生效值；选默认即清空已保存（下次走服务端默认）。
        setSavedTocModel(config.modelMode === 'explicit' ? config.model : '');
        setSavedTocEffort(config.effortMode === 'explicit' ? config.effort : '');
      }
    }
    const modelOptions = resolveTocReviewModelRequest({
      session,
      saved: { model: savedTocModel, effort: savedTocEffort },
    });
    setConfigOpen(false);
    review.mutate(
      {
        source,
        range: { startPage: decision.from, endPage: decision.to },
        ...(Object.keys(modelOptions).length > 0 ? { modelOptions } : {}),
      },
      {
        onSuccess: (data) => {
          // P3.5-FIX2：新审核结果隔离旧 state（批次递增 + 清空旧采用回执）。
          setAiAdoption(null);
          setReviewRunId((id) => id + 1);
          if (!data.embedded && data.draft) setResultOpen(true);
        },
      }
    );
  };

  const rangeText = validation.ok
    ? `${validation.from}–${validation.to}`
    : baseline
      ? `${baseline.range.fromPage}–${baseline.range.toPage}`
      : '—';

  const handleAdopt = (adoptSource: TocAdoptSource): void => {
    if (adoptSource === 'ocr') {
      // P3.1B 前端辅助门：thin/empty 不直接采用（服务端同样拒绝）。
      if (!baseline || baseline.embedded || baseline.verdict !== 'usable') return;
      dispatch({ type: 'adopt', source: 'ocr', entries: toEditableEntries(baseline.entries) });
      return;
    }
    // P3.5-FIX：AI 草稿采用只经结果大 Dialog 的 onAdopt 回执（见 handleAiAdopt），此处不再处理。
  };

  /**
   * P3.5-FIX 父级采用链：Dialog 回传选中操作 + 当前编辑，父级以 baseline +
   * 已确认操作构造完整有序 entries → 进入 AI adopted 态（可继续 anchor/preview）。
   * 全程页面 state，零 DB/导入写入。
   */
  const handleAiAdopt = (report: TocAdoptReport): void => {
    if (!baseline || baseline.embedded || !reviewData || !reviewData.draft) return;
    const editedById: Record<string, EditableTocEntry> = {};
    for (const row of report.edited) editedById[row.key] = row;
    const entries = buildAiAdoptedEntries({
      baselineEntries: baseline.entries,
      diff: reviewData.draft.diff,
      selectedIds: report.selectedIds,
      editedById,
    });
    setAiAdoption({ ids: report.selectedIds, editedById });
    dispatch({ type: 'adopt', source: 'ai', entries });
    setResultOpen(false);
  };

  const handleStartManual = (): void => {
    dispatch({ type: 'start-manual' });
  };

  const entriesValid =
    flow.editedEntries.length > 0 && flow.editedEntries.every((entry) => entry.title.trim() !== '');
  const confirmDisabled = !entriesValid || !validation.ok;

  const handleConfirm = (): void => {
    if (!flow.adopted || !entriesValid || !validation.ok) return;
    // 零写：只落本地 reducer，不调任何 mutation / 写接口。
    dispatch({ type: 'confirm', range: { fromPage: validation.from, toPage: validation.to } });
  };

  const adoptDisabled = baseline !== null && !baseline.embedded && baseline.verdict !== 'usable';

  const reviewDisabledReason = !baseline
    ? '先提取目录基线'
    : baseline.embedded
      ? '原生目录可用，无需 AI 审核'
      : !validation.ok
        ? '请先填写合法确认范围'
        : !reviewSizeOk
          ? `AI 审核单次最多 ${TOC_REVIEW_MAX_PAGES_UI} 页，请缩小范围或只看基线`
          : null;

  return (
    <>
      <TocReviewPanelView
      hasSource={source !== null}
      discovering={discovering}
      discoverProgress={discoverProgress}
      discoverError={discoverErrorText}
      discover={discoverData}
      selectedIndex={flow.selectedIndex}
      startText={flow.startText}
      endText={flow.endText}
      rangeError={
        !validation.ok && (flow.startText !== '' || flow.endText !== '') ? validation.message : null
      }
      extractDisabled={source === null || extracting || !validation.ok}
      extractDisabledReason={source === null ? '先选择 PDF 文件或填写本机路径' : null}
      extracting={extracting}
      extractProgress={extractProgress}
      onCancelExtract={handleCancelExtract}
      extractError={extractErrorText}
      baseline={baseline}
      reviewDisabled={
        baseline === null ||
        baseline.embedded ||
        review.isPending ||
        !validation.ok ||
        !reviewSizeOk
      }
      reviewDisabledReason={reviewDisabledReason}
      reviewSizeHint={
        baseline && !baseline.embedded && validation.ok && !reviewSizeOk
          ? `当前 ${validation.to - validation.from + 1} 页超出 AI 单次上限`
          : null
      }
      reviewing={review.isPending}
      reviewError={messageOf(review.error)}
      review={reviewData}
      adopted={flow.adopted}
      editing={flow.editing}
      editedEntries={flow.editedEntries}
      confirmed={flow.confirmed}
      confirmedSummary={flow.confirmedSummary}
      onDiscover={handleDiscover}
      onCancelDiscover={handleCancelDiscover}
      onSelectCandidate={(index) => {
        const candidate = discoverData?.candidates[index];
        if (!candidate) return;
        dispatch({ type: 'select-candidate', index, candidate });
      }}
      onStartChange={(value) =>
        dispatch({ type: 'set-range', start: value, end: flow.endText })
      }
      onEndChange={(value) =>
        dispatch({ type: 'set-range', start: flow.startText, end: value })
      }
      onExtract={handleExtract}
      onReview={handleReview}
      onOpenResult={() => setResultOpen(true)}
      onAdopt={handleAdopt}
      adoptDisabled={adoptDisabled}
      onStartManual={handleStartManual}
      onAddEntry={() => dispatch({ type: 'add-entry' })}
      onRemoveEntry={(key) => dispatch({ type: 'remove-entry', key })}
      confirmDisabled={confirmDisabled}
      onStartEdit={() => dispatch({ type: 'start-edit' })}
      onUpdateEntry={(key, patch) => dispatch({ type: 'update-entry', key, patch })}
      onConfirm={handleConfirm}
      />
      {baseline && !baseline.embedded && (
        <TocReviewConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          rangeText={rangeText}
          baseline={baseline}
          evidencePages={baseline.pageEvidence.length}
          sizeHint={
            baseline && !baseline.embedded && validation.ok && !reviewSizeOk
              ? `当前 ${validation.to - validation.from + 1} 页超出 AI 单次上限`
              : null
          }
          reviewDisabledReason={reviewDisabledReason}
          starting={review.isPending}
          savedModel={savedTocModel}
          savedEffort={savedTocEffort}
          sessionModel={sessionTocModel}
          sessionModelMode={sessionTocModelMode}
          sessionEffort={sessionTocEffort}
          sessionEffortMode={sessionTocEffortMode}
          onStart={handleStartReview}
          onClose={() => setConfigOpen(false)}
        />
      )}
      <TocReviewProgressDialog open={review.isPending} onOpenChange={() => {}} rangeText={rangeText} />
      {reviewData && !reviewData.embedded && reviewData.draft && (
        <TocResultDialog
          key={`toc-review-${reviewRunId}`}
          open={resultOpen}
          onOpenChange={setResultOpen}
          rangeText={rangeText}
          baselineCount={reviewData.baseline.entries.length}
          draft={reviewData.draft}
          {...(aiAdoption ? { initialAdoption: aiAdoption } : {})}
          onAdopt={handleAiAdopt}
        />
      )}
      {flow.confirmed && (
        <TocAnchorPanel file={file} filePath={filePath} entries={flow.editedEntries} />
      )}
    </>
  );
}
