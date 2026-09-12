import * as React from 'react';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog.js';
import type { TocBaselineData } from '../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.5 AI 重建目录的配置 Dialog 与进度 Dialog（小尺寸；结果另见 TocResultDialog）。
 * 配置只做确认（范围/基线摘要只读展示），进度只做展示（mutation 不可取消，如实说明）；
 * 颜色只用 toc 语义变量（静态门禁锁定）。
 */

export interface TocReviewConfigDialogContentProps {
  rangeText: string;
  baseline: TocBaselineData;
  evidencePages: number;
  sizeHint: string | null;
  reviewDisabledReason: string | null;
  starting: boolean;
  onStart(): void;
  onClose(): void;
}

export function TocReviewConfigDialogContent(props: TocReviewConfigDialogContentProps): React.ReactElement {
  const { rangeText, baseline, evidencePages, sizeHint, reviewDisabledReason, starting, onStart, onClose } = props;
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
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px]"
          disabled={starting || reviewDisabledReason !== null}
          onClick={onStart}
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
