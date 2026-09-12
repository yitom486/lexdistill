import * as React from 'react';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog.js';
import type { TocBaselineData } from '../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.5 AI 重建目录的配置 Dialog 与进度 Dialog（小尺寸；结果另见 TocResultDialog）。
 * 职责分离：配置只管“范围只读确认 + 模型/effort 选择”，进度只做展示，
 * 结果只管“展示草稿 + 勾选回执”；三者互不串活。
 * 颜色只用 toc 语义变量（静态门禁锁定）。
 */

export interface TocModelConfig {
  /** 本次模型 id（空=使用默认）。 */
  model: string;
  /** 本次 effort（空=使用默认；low/medium/high）。 */
  effort: string;
  /** 是否把本次选择记为持久偏好（zustand persist）。 */
  remember: boolean;
}

export const TOC_EFFORT_CHOICES = ['low', 'medium', 'high'] as const;

export interface TocReviewConfigDialogContentProps {
  rangeText: string;
  baseline: TocBaselineData;
  evidencePages: number;
  sizeHint: string | null;
  reviewDisabledReason: string | null;
  starting: boolean;
  /** 已保存偏好（zustand persist；空=未设）。 */
  savedModel: string;
  savedEffort: string;
  /** 本次已设覆盖（panel state；空=未覆盖）。 */
  sessionModel: string;
  sessionEffort: string;
  onStart(config: TocModelConfig): void;
  onClose(): void;
}

export function TocReviewConfigDialogContent(props: TocReviewConfigDialogContentProps): React.ReactElement {
  const {
    rangeText, baseline, evidencePages, sizeHint, reviewDisabledReason, starting,
    savedModel, savedEffort, sessionModel, sessionEffort, onStart, onClose,
  } = props;
  const [useCustomModel, setUseCustomModel] = React.useState<boolean>(() =>
    Boolean((sessionModel || savedModel).trim())
  );
  const [modelText, setModelText] = React.useState<string>(() => sessionModel || savedModel);
  const [effort, setEffort] = React.useState<string>(() => {
    const current = (sessionEffort || savedEffort).trim();
    return (TOC_EFFORT_CHOICES as readonly string[]).includes(current) ? current : '';
  });
  const [remember, setRemember] = React.useState<boolean>(false);
  const effectiveModel = useCustomModel ? modelText.trim() : '';
  const effectiveEffort = effort;
  const sourceLine = useCustomModel
    ? modelText.trim()
      ? `本次指定：${modelText.trim()}${remember ? '（将记住为偏好）' : '（仅本次）'}`
      : '已选指定模型但未填写 → 本次使用默认'
    : savedModel.trim()
      ? `使用已保存偏好：${savedModel.trim()}`
      : '使用默认（服务端环境变量 > 适配器默认）';
  return (
    <div className="space-y-2">
      <DialogHeader>
        <p className="text-[14px] font-bold text-toc-strong">AI 重建目录（保留正确项并标记变更）</p>
        <p className="text-[11px] text-toc-muted">
          只读流程：只调识别 / 基线 / 审核接口，不建文档、不入库；确认结果只保存在当前页面状态。
        </p>
      </DialogHeader>
      <div className="space-y-1 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
        <p>
          确认范围：第 {rangeText} 页 · 基线 {baseline.entries.length} 条（{baseline.verdict}）
        </p>
        <p className="text-toc-muted">证据 {evidencePages} 页 · 印刷页为书内页码，非 PDF 物理页</p>
        {(reviewDisabledReason ?? sizeHint) && (
          <p className="text-toc-muted">{reviewDisabledReason ?? sizeHint}</p>
        )}
      </div>
      <fieldset className="space-y-1.5 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
        <legend className="px-1 text-[11px] font-bold text-toc-muted">模型配置（本次生效）</legend>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="toc-review-model-mode"
              aria-label="使用默认模型"
              checked={!useCustomModel}
              onChange={() => setUseCustomModel(false)}
            />
            使用默认
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="toc-review-model-mode"
              aria-label="指定模型"
              checked={useCustomModel}
              onChange={() => setUseCustomModel(true)}
            />
            指定模型
          </label>
        </div>
        {useCustomModel && (
          <input
            type="text"
            aria-label="模型 id"
            placeholder="如 gpt-5.3-codex（空=默认）"
            value={modelText}
            onChange={(e) => setModelText(e.target.value)}
            className="h-7 w-full rounded-lg border border-toc-border bg-toc-surface px-2 text-toc-strong outline-none"
          />
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="toc-review-effort">思考等级</label>
          <Select value={effort || 'default'} onValueChange={(v) => setEffort(v === 'default' || v === null ? '' : v)}>
            <SelectTrigger id="toc-review-effort" className="h-7 w-36 text-[11px]" aria-label="思考等级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-[11px]">
                默认
              </SelectItem>
              {TOC_EFFORT_CHOICES.map((choice) => (
                <SelectItem key={choice} value={choice} className="text-[11px]">
                  {choice}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1 text-toc-muted">
          <input
            type="checkbox"
            aria-label="记住为偏好"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住为偏好（下次默认使用）
        </label>
        <p className="text-toc-muted" aria-live="polite">{sourceLine}</p>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px]"
          disabled={starting || reviewDisabledReason !== null}
          onClick={() => onStart({ model: effectiveModel, effort: effectiveEffort, remember })}
        >
          {starting ? '已开始…' : '开始重建'}
        </Button>
      </DialogFooter>
    </div>
  );
}

export interface TocReviewConfigDialogProps extends TocReviewConfigDialogContentProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function TocReviewConfigDialog(props: TocReviewConfigDialogProps): React.ReactElement {
  const { open, onOpenChange, ...contentProps } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-label="AI 重建目录配置">
        <TocReviewConfigDialogContent {...contentProps} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export interface TocReviewProgressDialogContentProps {
  rangeText: string;
}

export function TocReviewProgressDialogContent(props: TocReviewProgressDialogContentProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <DialogHeader>
        <p className="text-[14px] font-bold text-toc-strong">AI 正在重建目录…</p>
        <p className="text-[11px] text-toc-muted">
          {props.rangeText} · 通常需要几十秒；完成后自动打开结果。请勿关闭页面。
        </p>
      </DialogHeader>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-toc-border"
        role="progressbar"
        aria-label="AI 目录重建进度（不定长）"
      >
        <div className="h-full w-1/3 animate-pulse rounded-full bg-toc-review-fg" />
      </div>
      <p className="text-[11px] text-toc-muted">审核请求不可取消（网关单次调用）；如长时间无响应请检查网关终端。</p>
    </div>
  );
}

export interface TocReviewProgressDialogProps extends TocReviewProgressDialogContentProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function TocReviewProgressDialog(props: TocReviewProgressDialogProps): React.ReactElement {
  const { open, onOpenChange, ...contentProps } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={false} aria-label="AI 目录重建进度">
        <TocReviewProgressDialogContent {...contentProps} />
      </DialogContent>
    </Dialog>
  );
}
