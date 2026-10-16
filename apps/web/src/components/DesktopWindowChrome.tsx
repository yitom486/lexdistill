import React from 'react';
import { getPlatform } from '../platform/capabilities.js';
import { DesktopWindowControls } from './DesktopWindowControls.js';

/**
 * 桌面端全局顶置窗体控制条（Window Frame Chrome）
 *
 * 位于整个 Webview 视口的最顶层（z-[70]），不受任何页面路由、侧边栏、
 * 以及全屏模态弹窗遮罩（DialogOverlay / SheetOverlay 的 z-50）覆盖影响。
 * 保证在桌面端运行环境下，最小化、最大化、关闭三大控制按钮永久可见且可交互。
 */
export function DesktopWindowChrome() {
  const isDesktop = React.useMemo(() => {
    try {
      return getPlatform().isDesktop();
    } catch {
      return false;
    }
  }, []);

  if (!isDesktop) return null;

  return (
    <aside
      aria-label="窗口控制栏"
      className="fixed top-0 right-0 h-14 sm:h-15 pr-4 sm:pr-6 z-[70] flex items-center pointer-events-none select-none"
    >
      <div className="pointer-events-auto">
        <DesktopWindowControls showDivider />
      </div>
    </aside>
  );
}

