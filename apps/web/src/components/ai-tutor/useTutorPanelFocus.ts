import { useLayoutEffect, useRef } from 'react';

/** 非模态题目面板：首次打开进入面板，关闭恢复来源；外部阅读焦点不被抢回。 */
export function useTutorPanelFocus(isOpen: boolean, mounted: boolean, hasContext: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (isOpen && panel && !wasOpen.current) {
      if (document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
      panel.focus({ preventScroll: true });
    } else if ((!isOpen || !panel) && wasOpen.current) {
      const focused = document.activeElement;
      if ((focused === document.body || (focused && panel?.contains(focused))) && openerRef.current?.isConnected) {
        openerRef.current.focus({ preventScroll: true });
      }
      openerRef.current = null;
    }
    wasOpen.current = isOpen && Boolean(panel);
  }, [isOpen, mounted, hasContext]);
  return panelRef;
}
