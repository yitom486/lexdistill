import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sound } from '../../utils/audio.js';
import { openLookupPopup } from '../../lib/lookup-popup-bus.js';
import { normalizeSelectionText, type LookupLanguage } from '../../lib/selection-text.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';
import { useAnnotationsQuery, useAddAnnotationMutation, useProposeCardDraftMutation } from '../../queries/useLearnerQueries.js';
import type { useSelectionLookup } from './useSelectionLookup.js';
interface Inputs {
  book: TextbookBook;
  lesson: TextbookLesson;
  selection: ReturnType<typeof useSelectionLookup>;
  positionKey: string;
  onAddCard: (card: { front: string; back: string; category: string; prompt: string }) => Promise<unknown>;
  onAskAiTutor: (text: string, context: string) => void;
}
export function usePdfReaderActions({ book, lesson, selection, positionKey, onAddCard, onAskAiTutor }: Inputs) {
  const { selectedText, popupPosition, wordDetail } = selection;
  const mounted = useRef(false);
  const live = useRef({ key: '', quote: '' });
  const key = `${book.id}:${lesson.id}`;
  live.current = { key, quote: selectedText };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cardLock = useRef(false);
  const annotationLock = useRef(false);
  const [cardsPending, setCardsPending] = useState(false);
  const isCurrent = (requestKey: string) => mounted.current && live.current.key === requestKey;
  const dismissQuote = (quote: string) => { if (isCurrent(key) && live.current.quote === quote) selection.dismissSelection(); };
  // 划线批注持久化查询与新增
  const annotationsQuery = useAnnotationsQuery(book.documentId ?? book.id);
  const annotationsList = annotationsQuery.data ?? [];
  const addAnnotation = useAddAnnotationMutation();
  // 句子草稿提议（课文收句子 → 草稿箱确认 → 句子卡；接受时不记相遇词）
  const proposeDraft = useProposeCardDraftMutation();
  // 同步收句锁：与 disabled 双重保护同 tick 连击
  const collectingRef = useRef(false);
  const handleCollectSentence = (sentence: string, translation: string) => {
    if (collectingRef.current || proposeDraft.isPending) return;
    const text = sentence.trim();
    if (!text) return;
    collectingRef.current = true;
    sound.playClick();
    proposeDraft.mutate(
      {
        drafts: [
          {
            language: book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja',
            headword: text.slice(0, 500),
            meanings: [translation.trim() || '(译文待补)'],
            partOfSpeech: '课文句子',
            source: 'import',
            sourceRef: `${positionKey}/${lesson.id}`,
            kind: 'sentence',
            cardType: 'SENTENCE',
          },
        ],
      },
      {
        onSuccess: (created) => {
          if (!isCurrent(key)) return;
          sound.playCorrect();
          toast.success(
            created.length > 0 ? '已收进草稿箱，去生词闪卡页确认入库' : '这句已在草稿箱里了'
          );
        },
        onError: (e) => {
          if (!isCurrent(key)) return;
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '收句子失败');
        },
        onSettled: () => {
          collectingRef.current = false;
        },
      }
    );
  };

  // 划选查词典：经总线复用全局查词浮层（本书自有浮层保留，各管各的选择）
  const handleLookupSelection = () => {
    const language: LookupLanguage =
      book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja';
    const text = normalizeSelectionText(selectedText);
    if (!text || !popupPosition) {
      toast.error('请先在课文中划选要查的词。');
      return;
    }
    sound.playClick();
    openLookupPopup({
      text,
      language,
      x: popupPosition.x + 280,
      y: popupPosition.y,
      // P3-1 阅读上下文：查词 occurrence 带文档归属。
      documentId: book.documentId ?? book.id,
    });
  };

  const handleAddSelectedToCards = async () => {
    if (cardLock.current) return;
    if (!selectedText.trim()) {
      toast.error('请先在课文中划选要收的词。');
      return;
    }
    sound.playClick();
    cardLock.current = true;
    setCardsPending(true);
    // 加卡写入在 App 侧执行：以返回的 promise 为准，不预告成功
    try {
      await onAddCard({
        front: wordDetail?.reading ? `${wordDetail.word} (${wordDetail.reading})` : selectedText,
        back: wordDetail?.meaning || `来自《${book.shortTitle}》${lesson.title}`,
        category: 'VOCAB',
        prompt: `教材划词摘录: 《${book.shortTitle}》${lesson.title}`,
      });
      if (isCurrent(key)) {
        sound.playCorrect();
        toast.success(`记忆卡已保存：${selectedText}`);
        dismissQuote(selectedText);
      }
    } catch (e) {
      if (isCurrent(key)) {
        sound.playMistake();
        toast.error(e instanceof Error ? e.message : '加入闪卡失败，请重试。');
      }
    } finally {
      cardLock.current = false;
      if (mounted.current) setCardsPending(false);
    }
  };

  /** 生词行加卡：用行内词条数据，不误用当前划选 */
  const handleAddVocabToCards = async (vocab: { kanji: string; kana: string; chinese: string }) => {
    if (cardLock.current) return;
    cardLock.current = true;
    setCardsPending(true);
    sound.playClick();
    try {
      await onAddCard({
        front: `${vocab.kanji} (${vocab.kana})`,
        back: vocab.chinese,
        category: 'VOCAB',
        prompt: `教材生词：《${book.shortTitle}》${lesson.title}`,
      });
      if (isCurrent(key)) {
        sound.playCorrect();
        toast.success(`记忆卡已保存：${vocab.kanji}`);
      }
    } catch (e) {
      if (isCurrent(key)) {
        sound.playMistake();
        toast.error(e instanceof Error ? e.message : '加入闪卡失败，请重试。');
      }
    } finally {
      cardLock.current = false;
      if (mounted.current) setCardsPending(false);
    }
  };

  const handleAskTutorForSelection = () => {
    sound.playClick();
    const languageName = book.language === 'EN' ? '英文' : book.language === 'KO' ? '韩文' : '日文';
    onAskAiTutor(
      selectedText,
      `请结合《${book.title}》${lesson.title}的${languageName}课文语境，解释这段文字的语法和用法：`
    );
    selection.dismissSelection();
    toast.info('已打开导师，可继续提问。');
  };

  const handleSaveAnnotation = () => {
    if (annotationLock.current || addAnnotation.isPending) return;
    if (!selectedText.trim()) {
      toast.error('请先在课文中划选要批注的内容。');
      return;
    }
    sound.playClick();
    annotationLock.current = true;
    addAnnotation.mutate(
      {
        documentId: book.documentId ?? book.id,
        kind: wordDetail ? 'VOCAB' : 'KEY_POINT',
        quote: selectedText,
        note: wordDetail?.meaning || `课文划线批注: 《${book.shortTitle}》${lesson.title}`,
      },
      {
        onSuccess: () => {
          if (!isCurrent(key)) return;
          sound.playCorrect();
          toast.success(`批注已保存：${selectedText}`);
          dismissQuote(selectedText);
        },
        onError: (e) => {
          if (!isCurrent(key)) return;
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '批注保存失败，请重试。');
        },
        onSettled: () => { annotationLock.current = false; },
      }
    );
  };

  return { annotationsList, annotationsQuery, cardsPending, annotationPending: addAnnotation.isPending, collectPending: proposeDraft.isPending, handleCollectSentence, handleAddVocabToCards, handleAddSelectedToCards, handleSaveAnnotation, handleAskTutorForSelection, handleLookupSelection };
}
