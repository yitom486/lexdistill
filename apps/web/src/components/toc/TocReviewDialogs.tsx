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
 * 真列表，不硬编码：模型与思考档全部来自网关活列表，对外契约不变
 * （仍输出 TocModelConfig；model/effort 缺席 = 不发送 = 服务端默认），
 * panel 与 resolveRememberWrite 零改动。
 */
export interface TocModelOption {
  /** 发送值（Codex model id）。 */
  id: string;
  /** 展示名（displayName || model || id）。 */
  label: string;
  /** 该模型支持的思考档（空 = 未知，走 TOC_EFFORT_CHOICES）。 */
  supportedEfforts: string[];
  /** 该模型的默认思考档（空 = 未知）。 */
  defaultEffort: string;
}

/** Codex 模型列表收窄（纯函数）：过滤 hidden/空 id，保持服务端顺序；读侧永不抛。 */
export function toTocModelOptions(input: unknown): TocModelOption[] {
  if (!Array.isArray(input)) return [];
  const out: TocModelOption[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.hidden === true) continue;
    const id = [rec.id, rec.model].find(
      (v): v is string => typeof v === 'string' && v.trim() !== ''
    );
    if (!id) continue;
    const labelRaw = [rec.displayName, rec.model, rec.id].find(
      (v): v is string => typeof v === 'string' && v.trim() !== ''
    );
    const supportedEfforts = Array.isArray(rec.supportedReasoningEfforts)
      ? rec.supportedReasoningEfforts.filter(
          (e): e is string => typeof e === 'string' && e.trim() !== ''
        )
      : [];
    const defaultEffort =
      typeof rec.defaultReasoningEffort === 'string' ? rec.defaultReasoningEffort : '';
    out.push({
      id: id.trim(),
      label: (labelRaw ?? id).trim(),
      supportedEfforts,
      defaultEffort,
    });
  }
  return out;
}

/**
 * 模型默认选中（纯函数，无硬编码）：已保存命中 → 已保存；
 * 否则取列表尾巴（服务端按大→小排，尾巴即便宜小模型）；空列表 → ''。
 */
export function resolveTocModelDefault(models: TocModelOption[], savedId: string): string {
  const saved = savedId.trim();
  if (saved && models.some((m) => m.id === saved)) return saved;
  const tail = models[models.length - 1];
  return tail ? tail.id : '';
}

/** 思考档候选（纯函数）：选中模型自带档优先，否则回退 low/medium/high。 */
export function resolveTocEffortOptions(model: TocModelOption | null): string[] {
  if (model && model.supportedEfforts.length > 0) return [...model.supportedEfforts];
  return [...TOC_EFFORT_CHOICES];
}

/**
 * 思考档默认（纯函数）：已保存命中 → 已保存；模型默认命中 → 它；
 * low 命中 → low（便宜优先）；首项；空 → ''。
 */
export function resolveTocEffortDefault(
  options: string[],
  model: TocModelOption | null,
  savedEffort: string
): string {
  const saved = savedEffort.trim();
  if (saved && options.includes(saved)) return saved;
  const modelDefault = model?.defaultEffort.trim() ?? '';
  if (modelDefault && options.includes(modelDefault)) return modelDefault;
  if (options.includes('low')) return 'low';
  return options[0] ?? '';
}

function effortCostHint(value: string): string {
  if (value === 'low') return '（快速·便宜，目录任务一般够用）';
  if (value === 'medium') return '（均衡）';
  if (value === 'high') return '（最强·最贵，目录任务一般不需要）';
  return '';
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
  /** 服务端活列表（panel 经 useCodexModelsQuery 现取；保持服务端顺序）。 */
  models: TocModelOption[];
  /** 列表拉取中（此时两下拉禁用）。 */
  modelsLoading: boolean;
  /** 列表失败文案（非空 → 降级手填模型 id，思考档回退三档）。 */
  modelsError: string | null;
  onStart(config: TocModelConfig): void;
  onClose(): void;
}

export function TocReviewConfigDialogContent(props: TocReviewConfigDialogContentProps): React.ReactElement {
  const {
    rangeText, baseline, evidencePages, sizeHint, reviewDisabledReason, starting,
    savedModel, savedEffort, sessionModel, sessionModelMode, sessionEffort, sessionEffortMode,
    models, modelsLoading, modelsError, onStart, onClose,
  } = props;
  const trimmedSavedModel = savedModel.trim();
  const trimmedSavedEffort = savedEffort.trim();
  // 列表失败/空列表 → 降级手填（思考档回退三档）；平时绝不出现输入框。
  const fallbackMode = modelsError !== null || (!modelsLoading && models.length === 0);
  const findModel = (id: string): TocModelOption | null =>
    models.find((m) => m.id === id) ?? null;

  const sessionModelText = sessionModel.trim();
  const sessionEffortText = sessionEffort.trim();
  const [modelId, setModelId] = React.useState<string>(() => {
    if (sessionModelMode === 'explicit' && sessionModelText) return sessionModelText;
    if (sessionModelMode === 'default') return '';
    return resolveTocModelDefault(models, trimmedSavedModel);
  });
  const touchedModelRef = React.useRef<boolean>(
    sessionModelMode === 'explicit' && sessionModelText !== ''
  );
  const [customModel, setCustomModel] = React.useState<string>(() =>
    sessionModelMode === 'explicit' ? sessionModel : ''
  );
  const touchedCustomRef = React.useRef<boolean>(
    sessionModelMode === 'explicit' && sessionModelText !== ''
  );
  const [effort, setEffort] = React.useState<string>(() => {
    if (sessionEffortMode === 'explicit' && sessionEffortText) return sessionEffortText;
    if (sessionEffortMode === 'default') return '';
    const initialModel = findModel(resolveTocModelDefault(models, trimmedSavedModel));
    return resolveTocEffortDefault(
      resolveTocEffortOptions(initialModel),
      initialModel,
      trimmedSavedEffort
    );
  });
  const touchedEffortRef = React.useRef<boolean>(
    sessionEffortMode === 'explicit' && sessionEffortText !== ''
  );

  // 列表后到达（打开即取）：没动手才跟进 本次覆盖 > 已保存 > 尾巴/模型默认 规则。
  React.useEffect(() => {
    if (fallbackMode || touchedModelRef.current) return;
    if (sessionModelMode === 'explicit' && sessionModelText) {
      if (!modelsLoading && !findModel(sessionModelText)) {
        setModelId(resolveTocModelDefault(models, trimmedSavedModel));
        return;
      }
      setModelId(sessionModelText);
      return;
    }
    if (sessionModelMode === 'default') {
      setModelId('');
      return;
    }
    setModelId(resolveTocModelDefault(models, trimmedSavedModel));
  }, [models, modelsLoading, fallbackMode, sessionModel, sessionModelMode, sessionModelText, trimmedSavedModel]);

  React.useEffect(() => {
    if (fallbackMode || touchedCustomRef.current) return;
    if (sessionModelMode === 'explicit') setCustomModel(sessionModel);
  }, [fallbackMode, sessionModel, sessionModelMode]);

  const selectedModel = findModel(modelId);
  const effortOptions = fallbackMode ? [...TOC_EFFORT_CHOICES] : resolveTocEffortOptions(selectedModel);
  React.useEffect(() => {
    if (sessionEffortMode === 'explicit' && sessionEffortText) {
      if (!modelsLoading && !effortOptions.includes(sessionEffortText)) {
        setEffort(
          resolveTocEffortDefault(
            effortOptions,
            selectedModel,
            touchedEffortRef.current ? '' : trimmedSavedEffort
          )
        );
        return;
      }
      if (!touchedEffortRef.current) setEffort(sessionEffortText);
      return;
    }
    if (sessionEffortMode === 'default') {
      if (!touchedEffortRef.current) setEffort('');
      return;
    }
    if (touchedEffortRef.current && effortOptions.includes(effort)) return;
    const wanted = resolveTocEffortDefault(
      effortOptions,
      selectedModel,
      touchedEffortRef.current ? '' : trimmedSavedEffort
    );
    if (wanted !== effort) setEffort(wanted);
  }, [
    effortOptions,
    selectedModel,
    effort,
    modelsLoading,
    sessionEffort,
    sessionEffortMode,
    sessionEffortText,
    trimmedSavedEffort,
  ]);

  const chooseModel = (id: string): void => {
    touchedModelRef.current = true;
    setModelId(id);
  };
  const chooseEffort = (value: string): void => {
    touchedEffortRef.current = true;
    setEffort(value);
  };

  const effectiveModel = fallbackMode ? customModel.trim() : modelId;
  const modelMode: TocReviewModelMode = effectiveModel ? 'explicit' : 'default';
  const effectiveEffort = effort;
  const effortMode: TocReviewModelMode = effectiveEffort ? 'explicit' : 'default';
  // 有显式选择才记住（zustand，下次默认使用）；双默认不动已保存。
  const remember = modelMode !== 'default' || effortMode !== 'default';

  const modelLabel = selectedModel ? selectedModel.label : effectiveModel;
  const clearsSavedModel = modelMode === 'default' && trimmedSavedModel !== '';
  const clearsSavedEffort = effortMode === 'default' && trimmedSavedEffort !== '';
  // 本次生效预览：永远可见的一行真相——实际发什么、不发什么、清什么。
  const modelPreview = fallbackMode
    ? effectiveModel
      ? `本次发送模型：${effectiveModel}（${modelsError ?? '模型列表为空'}，已降级手填）`
      : `本次不发送模型（服务端默认）${modelsError ? `；${modelsError}` : ''}`
    : effectiveModel
      ? `本次发送模型：${modelLabel}（${effectiveModel}）`
      : `本次不发送模型（服务端默认）${clearsSavedModel ? '；将清空已保存模型偏好' : ''}`;
  const effortPreview = effectiveEffort
    ? `本次发送思考等级：${effectiveEffort}${effortCostHint(effectiveEffort)}`
    : `本次不发送思考等级（服务端默认）${clearsSavedEffort ? '；将清空已保存思考等级偏好' : ''}`;
  const modelTriggerText = modelsLoading
    ? '拉取模型列表中…'
    : fallbackMode
      ? '手动填写'
      : selectedModel
        ? selectedModel.label
        : '服务端默认';
  const effortTriggerText = modelsLoading
    ? '拉取模型列表中…'
    : effectiveEffort
      ? `${effectiveEffort}${effortCostHint(effectiveEffort)}`
      : '服务端默认';
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
        {!fallbackMode && (
          <Select
            value={modelId}
            onValueChange={(v) => {
              chooseModel(v === null ? '' : v);
            }}
            disabled={modelsLoading}
          >
            <SelectTrigger className="h-7 w-full text-[11px]" aria-label="模型">
              <SelectValue placeholder="选择模型">{modelTriggerText}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="" className="text-[11px]">
                服务端默认（跟随网关配置）
              </SelectItem>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px]">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {fallbackMode && (
          <input
            type="text"
            aria-label="模型 id"
            placeholder="如 gpt-5.3-codex（空=默认）"
            value={customModel}
            onChange={(e) => {
              touchedCustomRef.current = true;
              setCustomModel(e.target.value);
            }}
            className="h-7 w-full rounded-lg border border-toc-border bg-toc-surface px-2 text-toc-strong outline-none"
          />
        )}
        <p className="text-toc-muted" aria-live="polite">{modelPreview}</p>
      </fieldset>
      <fieldset className="space-y-1.5 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
        <legend className="px-1 text-[11px] font-bold text-toc-muted">思考等级（本次生效）</legend>
        <Select
          value={effort}
          onValueChange={(v) => {
            chooseEffort(v === null ? '' : v);
          }}
          disabled={modelsLoading}
        >
          <SelectTrigger className="h-7 w-full text-[11px]" aria-label="思考等级">
            <SelectValue placeholder="选择思考等级">{effortTriggerText}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="" className="text-[11px]">
              服务端默认（跟随网关配置）
            </SelectItem>
            {effortOptions.map((choice) => (
              <SelectItem key={choice} value={choice} className="text-[11px]">
                {choice}{effortCostHint(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-toc-muted" aria-live="polite">{effortPreview}</p>
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
          onClick={() => onStart({ model: effectiveModel, effort: effectiveEffort, modelMode, effortMode, remember })}
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
