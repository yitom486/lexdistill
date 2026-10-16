import React, { useEffect, useRef, useState } from 'react';
import type { TextbookLesson } from '../../models/textbook.js';

export interface SelectionWordDetail {
  word: string;
  reading?: string | undefined;
  meaning?: string | undefined;
  pos?: string | undefined;
  pitch?: string | undefined;
}

interface UseSelectionLookupOptions {
  lesson: TextbookLesson;
  contextKey?: string;
}

/**
 * 划词选区状态：选中文本、浮层锚点、生词表命中的词义明细。
 * 清除带 150ms 延迟，以免点击浮窗内按钮时被提前取消。
 */
export function useSelectionLookup({ lesson, contextKey }: UseSelectionLookupOptions) {
  const [selectedText, setSelectedText] = useState<string>('');
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [wordDetail, setWordDetail] = useState<SelectionWordDetail | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setSelectedText('');
    setPopupPosition(null);
    setWordDetail(null);
    return () => { if (dismissTimer.current !== null) clearTimeout(dismissTimer.current); };
  }, [lesson.id, contextKey]);

  const handleMouseUp = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[role="dialog"]')) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0) {
      setSelectedText(text);
      setPopupPosition({
        x: Math.min(Math.max(e.clientX - 100, 20), window.innerWidth - 300),
        y: e.clientY - 60,
      });

      // 自动尝试在生词表中比对
      const matchedVocab = lesson.vocabularies.find(
        (v) => text === v.kanji || (v.kana.length > 0 && text === v.kana)
      );
      if (matchedVocab) {
        setWordDetail({
          word: matchedVocab.kanji,
          reading: matchedVocab.kana,
          meaning: matchedVocab.chinese,
          pos: matchedVocab.pos,
          pitch: matchedVocab.pitchAccent,
        });
      } else {
        setWordDetail({
          word: text,
        });
      }
    } else {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) {
          setPopupPosition(null);
        }
      }, 150);
    }
  };

  const dismissSelection = () => setPopupPosition(null);

  return { selectedText, popupPosition, wordDetail, handleMouseUp, dismissSelection };
}
