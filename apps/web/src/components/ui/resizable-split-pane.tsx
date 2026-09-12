import React, { useCallback, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';

export interface ResizableSplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** 左侧占比 0.2–0.8 */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
  /** 工作台挂载时允许全局 [ / ]（输入框内除外） */
  enableBracketShortcuts?: boolean;
}

/**
 * 左右可拖拽分栏（阅读：文章 | 题目）。
 * 键盘：聚焦分隔条后 ArrowLeft/Right、[ / ] 微调；Home / End 到边界。
 * md 以下改为上下堆叠，分隔条隐藏。
 */
export function ResizableSplitPane({
  left,
  right,
  ratio,
  onRatioChange,
  minRatio = 0.28,
  maxRatio = 0.72,
  className,
  /** 工作台挂载时允许全局 [ / ]（输入框内除外） */
  enableBracketShortcuts = false,
}: ResizableSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (value: number) => Math.min(maxRatio, Math.max(minRatio, value)),
    [minRatio, maxRatio]
  );

  const nudge = useCallback(
    (delta: number) => {
      onRatioChange(clamp(ratio + delta));
    },
    [clamp, onRatioChange, ratio]
  );

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      onRatioChange(clamp((clientX - rect.left) / rect.width));
    },
    [clamp, onRatioChange]
  );

  const endDrag = (target: HTMLElement, pointerId: number) => {
    draggingRef.current = false;
    setDragging(false);
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    if (e.key === 'ArrowLeft' || e.key === '[') {
      e.preventDefault();
      nudge(-step);
    } else if (e.key === 'ArrowRight' || e.key === ']') {
      e.preventDefault();
      nudge(step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onRatioChange(minRatio);
    } else if (e.key === 'End') {
      e.preventDefault();
      onRatioChange(maxRatio);
    }
  };

  React.useEffect(() => {
    if (!enableBracketShortcuts) return;
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
          return;
        }
      }
      const step = e.shiftKey ? 0.05 : 0.02;
      if (e.key === '[') {
        e.preventDefault();
        nudge(-step);
      } else if (e.key === ']') {
        e.preventDefault();
        nudge(step);
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [enableBracketShortcuts, nudge]);

  const leftPct = `${(ratio * 100).toFixed(2)}%`;

  return (
    <div className={cn('w-full', className)}>
      {/* 移动端：上下堆叠 */}
      <div className="flex flex-col gap-4 md:hidden">
        <div className="min-h-[16rem]">{left}</div>
        <div className="min-h-[14rem]">{right}</div>
      </div>

      {/* 桌面：左右可调 */}
      <div
        ref={containerRef}
        className="hidden md:flex w-full min-h-[32rem] items-stretch"
      >
        <div
          className="min-w-0 overflow-hidden flex flex-col"
          style={{ flex: `0 0 ${leftPct}`, width: leftPct, maxWidth: leftPct }}
        >
          {left}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={Math.round(minRatio * 100)}
          aria-valuemax={Math.round(maxRatio * 100)}
          aria-label="调整文章与题目区域宽度，可用 [ ] 或左右方向键微调"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e.currentTarget, e.pointerId)}
          onPointerCancel={(e) => endDrag(e.currentTarget, e.pointerId)}
          className={cn(
            'w-3 shrink-0 cursor-col-resize flex items-stretch justify-center group touch-none select-none',
            'outline-none focus-visible:ring-2 focus-visible:ring-tone-amber-500o40 rounded-sm'
          )}
        >
          <div
            className={cn(
              'w-px self-stretch my-3 rounded-full transition-[width,background-color]',
              dragging
                ? 'w-0.5 bg-tone-amber-500'
                : 'bg-line-stone-300-stone-700 group-hover:w-0.5 group-hover:bg-tone-amber-500o80'
            )}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-hidden flex flex-col">{right}</div>
      </div>
    </div>
  );
}
