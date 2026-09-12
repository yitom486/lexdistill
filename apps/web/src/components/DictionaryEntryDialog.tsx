import React from 'react';
import { BookOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog.js';
import { DictionaryLookupPanel } from './DictionaryLookupPanel.js';
import { sound } from '../utils/audio.js';

/**
 * 卡面点词弹窗：渲染词典完整内容（读音/词性/分条释义/声调/例句/来源），
 * 复用查词面板同一命令（收藏/讲透/推送 Anki 全可用）。
 * 自包含挂载（调用方本地 useState 控制，不占导航；FsrsCardWorkbench 待并行合入后接入）。
 */
export function DictionaryEntryDialog({
  open,
  onClose,
  language,
  query,
}: {
  open: boolean;
  onClose: () => void;
  language: 'en' | 'ja' | 'ko';
  query: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          sound.playClick();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-tone-amber-600" />
            词典 · {query}
          </DialogTitle>
          <DialogDescription>完整条目（多来源对照）。收藏后例句与来源跟卡走。</DialogDescription>
        </DialogHeader>
        {open && (
          <DictionaryLookupPanel
            language={language}
            title=""
            helper=""
            initialQuery={query}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
