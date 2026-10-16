import { useEffect, type KeyboardEvent } from 'react';

/** keep-alive面板关闭时同步收起附属浮层，嵌套控件先处理自己的Escape。 */
export function useChatDismiss(
  visible: boolean,
  onClose: (() => void) | undefined,
  setHistoryOpen: (open: boolean) => void,
  setSettingsOpen: (open: boolean) => void
) {
  useEffect(() => {
    if (!visible) {
      setHistoryOpen(false);
      setSettingsOpen(false);
    }
  }, [visible, setHistoryOpen, setSettingsOpen]);
  const close = () => {
    setHistoryOpen(false);
    setSettingsOpen(false);
    onClose?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !onClose) return;
    event.stopPropagation();
    close();
  };
  return { close, onKeyDown };
}
