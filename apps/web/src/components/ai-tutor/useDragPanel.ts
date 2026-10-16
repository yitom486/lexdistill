import { useRef, useState } from 'react';

/**
 * 浮动面板拖拽：默认右侧垂直居中，不挤压主屏。
 * 纯位置状态，与会话/流式生命周期无关。
 */
export function useDragPanel(defaultWidthPx: number) {
  const [panelPos, setPanelPos] = useState<{ right: number; top: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origRight: number; origTop: number } | null>(null);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button,input,select,textarea,a')) return;
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
    const current = panelPos ?? {
      right: 16,
      top: Math.max(8, vh * 0.11),
    };
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: current.right,
      origTop: current.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(vw, defaultWidthPx);
    const right = Math.min(Math.max(drag.origRight - (e.clientX - drag.startX), -(w - 120)), vw - 120);
    const top = Math.min(Math.max(drag.origTop + (e.clientY - drag.startY), 0), vh - 60);
    setPanelPos({ right, top });
  };

  const handleDragEnd = () => {
    dragState.current = null;
  };

  return { panelPos, handleDragStart, handleDragMove, handleDragEnd };
}

/** 面板位置归一化：默认右上 + 视口钳制（至少留 120px 可抓取）。纯函数，可单测。 */
export function resolvePanelPos(
  panelPos: { right: number; top: number } | null,
  panelWidth: number,
  viewport: { w: number; h: number }
): { right: number; top: number } {
  const fallback = { right: 16, top: Math.max(8, viewport.h * 0.11) };
  const pos = panelPos ?? fallback;
  return {
    right: Math.min(Math.max(pos.right, -(panelWidth - 120)), viewport.w - 120),
    top: Math.min(Math.max(pos.top, 0), viewport.h - 60),
  };
}
