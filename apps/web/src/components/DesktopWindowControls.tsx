import React from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import {
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
  closeDesktopWindow,
  isDesktopWindowMaximized,
} from '../platform/tauri-capabilities.js';
import { sound } from '../utils/audio.js';

export function DesktopWindowControls() {
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void isDesktopWindowMaximized()
      .then((max) => {
        if (active) setIsMaximized(max);
      })
      .catch(() => {});

    const handleResize = () => {
      void isDesktopWindowMaximized()
        .then((max) => {
          if (active) setIsMaximized(max);
        })
        .catch(() => {});
    };

    window.addEventListener('resize', handleResize);
    return () => {
      active = false;
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleMinimize = () => {
    sound.playClick();
    void minimizeDesktopWindow().catch(() => {});
  };

  const handleToggleMaximize = () => {
    sound.playClick();
    void toggleMaximizeDesktopWindow()
      .then((max) => setIsMaximized(max))
      .catch(() => {});
  };

  const handleClose = () => {
    sound.playClick();
    void closeDesktopWindow().catch(() => {});
  };

  return (
    <div
      className="flex items-center gap-0.5 ml-1 select-none"
      data-tauri-drag-region="false"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="h-3.5 w-px bg-line mx-1 opacity-70" />

      <button
        type="button"
        onClick={handleMinimize}
        className="h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink hover:bg-surface-stone-100-stone-900 transition-colors"
        title="最小化"
        aria-label="最小化窗口"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={handleToggleMaximize}
        className="h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink hover:bg-surface-stone-100-stone-900 transition-colors"
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
      >
        {isMaximized ? (
          <Copy className="w-3 h-3 rotate-180" />
        ) : (
          <Square className="w-3 h-3" />
        )}
      </button>

      <button
        type="button"
        onClick={handleClose}
        className="h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-ink-ghost hover:text-surface hover:bg-tone-rose-500 transition-colors"
        title="关闭"
        aria-label="关闭应用"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
