import { useEffect, useRef, useState } from 'react';

/** 只滚动消息列表；用户上翻后保留阅读位置。即时滚动不引入视觉动效。 */
export function useChatScroll(items: readonly unknown[], busy: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToLatest, setStickToLatest] = useState(true);
  const scrollToLatest = () => {
    const list = scrollRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  };
  useEffect(() => {
    if (stickToLatest) scrollToLatest();
  }, [items, busy, stickToLatest]);
  const handleScroll = () => {
    const list = scrollRef.current;
    if (list) setStickToLatest(list.scrollHeight - list.scrollTop - list.clientHeight < 64);
  };
  const jumpToLatest = () => {
    setStickToLatest(true);
    scrollToLatest();
  };
  return { scrollRef, stickToLatest, handleScroll, jumpToLatest };
}
