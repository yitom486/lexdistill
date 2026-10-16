import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TextbookAST } from '@lexdistill/document-model';
import type { TextbookBook } from '../../models/textbook.js';
import { convertAstToTextbookBook, extractFsrsCardsFromAst } from './textbook-converter.js';
type Card = { id?: string; front: string; back: string; category: string; prompt: string };
interface Input {
  parsedAST: TextbookAST | null;
  autoGenerateCards: boolean;
  onImportBook: (book: TextbookBook, count: number) => unknown | Promise<unknown>;
  onAddCardsBatch: (cards: Card[]) => unknown | Promise<unknown>;
  onClose: () => void;
}
/** Book and cards have separate receipts. Preserve the snapshot and identities for explicit retries. */
export function useJsonImportAction(input: Input) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const liveAst = useRef(input.parsedAST);
  liveAst.current = input.parsedAST;
  const snapshot = useRef<{ ast: TextbookAST; book: TextbookBook; cards: Card[]; bookSaved: boolean; cardsSaved: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const confirm = async () => {
    if (lock.current || !input.parsedAST) return;
    lock.current = true;
    setPending(true);
    setError(null);
    if (snapshot.current?.ast !== input.parsedAST) {
      const id = crypto.randomUUID();
      snapshot.current = {
        ast: input.parsedAST, book: convertAstToTextbookBook(input.parsedAST), bookSaved: false, cardsSaved: false,
        cards: extractFsrsCardsFromAst(input.parsedAST).map((card, index) => ({ ...card, id: `card_import_${id}_${index}` })),
      };
    }
    const saved = snapshot.current;
    try {
      if (!saved.bookSaved) { await input.onImportBook(saved.book, input.autoGenerateCards ? saved.cards.length : 0); saved.bookSaved = true; }
      if (input.autoGenerateCards && saved.cards.length && !saved.cardsSaved) { await input.onAddCardsBatch(saved.cards); saved.cardsSaved = true; }
      if (!mounted.current || liveAst.current !== saved.ast) return;
      toast.success(`教材已导入：${saved.book.title}${input.autoGenerateCards && saved.cardsSaved ? `，${saved.cards.length} 张记忆卡已保存` : ''}`);
      input.onClose();
    } catch (cause) {
      if (!mounted.current || liveAst.current !== saved.ast) return;
      const message = `${saved.bookSaved ? '教材已保存，记忆卡保存失败' : '教材保存失败'}：${cause instanceof Error ? cause.message : '请重试'}。本次输入已保留。`;
      setError(message);
      toast.error(message);
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  return { pending, error, confirm };
}
