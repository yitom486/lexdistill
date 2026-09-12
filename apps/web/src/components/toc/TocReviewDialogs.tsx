import * as React from 'react';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog.js';
import type { TocBaselineData, TocReviewModelMode } from '../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.5 AI 重建目录的配置 Dialog 与进度 Dialog（小尺寸；结果另见 TocResultDialog）。
 * 职责分离：配置只管“范围只读确认 + 模型/effort 选择”，进度只做展示，
 * 结果只管“展示草稿 + 勾选回执”；三者互不串活。
 * 颜色只用 toc 语义变量（静态门禁锁定）。
 */

export interface TocModelConfig {
  /** 本次模型 id（mode=explicit 时有效；空=未填按默认）。 */
  model: string;
  /** 本次 effort（mode=explicit 时有效；low/medium/high）。 */
  effort: string;
  /** 取值模式（inherit-saved / force-default / explicit，模型与 effort 各自独立）。 */
  modelMode: TocReviewModelMode;
  effortMode: TocReviewModelMode;
  /** 是否把本次选择记为持久偏好（zustand persist）。 */
  remember: boolean;
}

export const TOC_EFFORT_CHOICES = ['low', 'medium', 'high'] as const;

export type TocEffortChoice = (typeof TOC_EFFORT_CHOICES)[number];

/**
 * Inkdown 式显式选择：一个字段一个下拉，选什么发什么，值永远可见。
 * - 模型：网关没有"可用模型列表"端点，id 无法枚举，故不做假下拉；
 *   「指定模型」后手填 id + 本次生效预览，绝不出现"不知发了什么"的跟随态。
 * - 思考等级：low/medium/high 全枚举 + 费用提示，目录是简单任务，默认不选 high。
 * 对外契约不变：仍输出 TocModelConfig（model/effort 缺席 = 不发送 = 服务端默认），
 * panel 与 resolveRememberWrite 零改动。
 */
type ModelSel = '__saved__' | '__default__' | '__custom__';
type EffortSel = '__saved__' | '__default__' | TocEffortChoice;

function asEffortChoice(value: string): TocEffortChoice | null {
  return (TOC_EFFORT_CHOICES as readonly string[]).includes(value)
    ? (value as TocEffortChoice)
    : null;
}

function effortCostHint(value: TocEffortChoice): string {
  if (value === 'low') return '（快速·便宜，目录任务一般够用）';
  if (value === 'medium') return '（均衡）';
  return '（最强·最贵，目录任务一般不需要）';
}

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
  /** 本次已设覆盖（panel state；模式 + 值）。 */
  sessionModel: string;
  sessionModelMode: TocReviewModelMode;
  sessionEffort: string;
  sessionEffortMode: TocReviewModelMode;
  onStart(config: TocModelConfig): void;
  onClose(): void;
}

export function TocReviewConfigDialogContent(props: TocReviewConfigDialogContentProps): React.ReactElement {
  const {
    rangeText, baseline, evidencePages, sizeHint, reviewDisabledReason, starting,
    savedModel, savedEffort, sessionModel, sessionModelMode, sessionEffort, sessionEffortMode,
    onStart, onClose,
  } = props;
  const trimmedSavedModel = savedModel.trim();
  const trimmedSavedEffort = savedEffort.trim();
  const [modelSel, setModelSel] = React.useState<ModelSel>(() =>
    sessionModelMode === 'explicit'
      ? '__custom__'
      : sessionModelMode === 'default'
        ? '__default__'
        : trimmedSavedModel
          ? '__saved__'
          : '__default__');
  const [modelText, setModelText] = React.useState<string>(() => sessionModel || savedModel);
  const [effortSel, setEffortSel] = React.useState<EffortSel>(() => {
    if (sessionEffortMode === 'explicit') return asEffortChoice(sessionEffort) ?? '__default__';
    if (sessionEffortMode === 'default') return '__default__';
    return trimmedSavedEffort ? '__saved__' : '__default__';
  });
  const [remember, setRemember] = React.useState<boolean>(false);
  // 双跟随已保存时无可记住的内容，禁用复选框（而非勾选后静默无操作）。
  const nothingToRemember = modelSel === '__saved__' && effortSel === '__saved__';
  const modelMode: TocReviewModelMode =
    modelSel === '__custom__' ? 'explicit' : modelSel === '__default__' ? 'default' : 'inherit';
  const effectiveModel = modelSel === '__custom__' ? modelText.trim() : '';
  const effortMode: TocReviewModelMode =
    effortSel === '__saved__' ? 'inherit' : effortSel === '__default__' ? 'default' : 'explicit';
  const effectiveEffort = effortSel === '__saved__' || effortSel === '__default__' ? '' : effortSel;
  // 本次生效预览：永远可见的一行真相——实际发什么、不发什么。
  const modelPreview =
    modelSel === '__custom__'
      ? effectiveModel
        ? `本次发送模型：${effectiveModel}（仅本次）`
        : '指定了模型但未填写 → 本次不发送（服务端默认）'
      : modelSel === '__saved__' && trimmedSavedModel
        ? `本次发送已保存模型：${trimmedSavedModel}`
        : '本次不发送模型（服务端默认，跟随网关配置）';
  const effortPreview =
    effortSel === '__saved__'
      ? trimmedSavedEffort
        ? `本次发送已保存思考等级：${trimmedSavedEffort}`
        : '本次不发送思考等级（服务端默认）'
      : effortSel === '__default__'
        ? '本次不发送思考等级（服务端默认，跟随网关配置）'
        : `本次发送思考等级：${effortSel}${effortCostHint(effortSel)}`;
  const modelTriggerText =
    modelSel === '__custom__'
      ? modelText.trim() || '指定模型…'
      : modelSel === '__saved__'
        ? `跟随已保存（${trimmedSavedModel}）`
        : '服务端默认';
  const effortTriggerText =
    effortSel === '__saved__'
      ? `跟随已保存（${trimmedSavedEffort}）`
      : effortSel === '__default__'
        ? '服务端默认'
        : `${effortSel}${effortCostHint(effortSel)}`;
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
        <legend className="px-1 text-[11px] font-bold text-toc-muted">模型（本次生效）</legend>
        <Select
          value={modelSel}
          onValueChange={(v) => {
            if (v === '__saved__' && trimmedSavedModel) {
              setModelSel('__saved__');
              return;
            }
            if (v === '__custom__') {
              setModelSel('__custom__');
              return;
            }
            setModelSel('__default__');
          }}
        >
          <SelectTrigger className="h-7 w-full text-[11px]" aria-label="模型">
            <SelectValue placeholder="选择模型">{modelTriggerText}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {trimmedSavedModel && (
              <SelectItem value="__saved__" className="text-[11px]">
                跟随已保存（{trimmedSavedModel}）
              </SelectItem>
            )}
            <SelectItem value="__default__" className="text-[11px]">
              服务端默认（跟随网关配置）
            </SelectItem>
            <SelectItem value="__custom__" className="text-[11px]">
              指定模型…
            </SelectItem>
          </SelectContent>
        </Select>
        {modelSel === '__custom__' && (
          <input
            type="text"
            aria-label="模型 id"
            placeholder="如 gpt-5.3-codex（空=默认）"
            value={modelText}
            onChange={(e) => setModelText(e.target.value)}
            className="h-7 w-full rounded-lg border border-toc-border bg-toc-surface px-2 text-toc-strong outline-none"
          />
        )}
        <p className="text-toc-muted" aria-live="polite">{modelPreview}</p>
      </fieldset>
      <fieldset className="space-y-1.5 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
        <legend className="px-1 text-[11px] font-bold text-toc-muted">思考等级（本次生效）</legend>
        <Select
          value={effortSel}
          onValueChange={(v) => {
            if (v === '__saved__' && trimmedSavedEffort) {
              setEffortSel('__saved__');
              return;
            }
            if (v === null || v === '__default__') {
              setEffortSel('__default__');
              return;
            }
            setEffortSel(asEffortChoice(v) ?? '__default__');
          }}
        >
          <SelectTrigger className="h-7 w-full text-[11px]" aria-label="思考等级">
            <SelectValue placeholder="选择思考等级">{effortTriggerText}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {trimmedSavedEffort && (
              <SelectItem value="__saved__" className="text-[11px]">
                跟随已保存（{trimmedSavedEffort}）
              </SelectItem>
            )}
            <SelectItem value="__default__" className="text-[11px]">
              服务端默认（跟随网关配置）
            </SelectItem>
            {TOC_EFFORT_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice} className="text-[11px]">
                {choice}{effortCostHint(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-toc-muted" aria-live="polite">{effortPreview}</p>
      </fieldset>
      <div className="space-y-1 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
        <label className="flex items-center gap-1 text-toc-muted">
          <input
            type="checkbox"
            aria-label="记住为偏好"
            checked={remember && !nothingToRemember}
            disabled={nothingToRemember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住为偏好（{nothingToRemember ? '跟随偏好时无需记住' : '下次默认使用；选默认则清空已保存'}）
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px]"
          disabled={starting || reviewDisabledReason !== null}
          onClick={() => onStart({ model: effectiveModel, effort: effectiveEffort, modelMode, effortMode, remember: remember && !nothingToRemember })}
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
