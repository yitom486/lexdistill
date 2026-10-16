import React from 'react';
import { BookOpen } from 'lucide-react';
import type { KanaItem } from '@lexdistill/protocol';
import { cn } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';

export type KanaRowLabelScriptMode = 'HIRAGANA' | 'KATAKANA' | 'BOTH';

interface KanaRowHighlight {
  label: string;
  detail: string;
  emphasis: boolean;
}

function displayKana(
  hiragana: string,
  katakana: string,
  scriptMode: KanaRowLabelScriptMode
): string {
  return scriptMode === 'KATAKANA' ? katakana : hiragana;
}

function rowHighlight(
  rowName: string,
  items: readonly KanaItem[],
  scriptMode: KanaRowLabelScriptMode
): KanaRowHighlight {
  const first = items[0];
  const type = first?.type;

  if (type === 'YOON' || rowName.includes('拗音')) {
    const baseHiragana = first?.hiragana.slice(0, 1) ?? 'い';
    const baseKatakana = first?.katakana.slice(0, 1) ?? 'イ';
    const base = displayKana(baseHiragana, baseKatakana, scriptMode);
    return {
      label: '小字合音',
      detail: `${base} + 小ゃ/ゅ/ょ`,
      emphasis: true,
    };
  }

  if (type === 'DAKUON') {
    const baseRow: Record<string, string> = {
      が行: 'か行',
      ざ行: 'さ行',
      だ行: 'た行',
      ば行: 'は行',
    };
    return {
      label: '浊音',
      detail: `${baseRow[rowName] ?? '基础行'} + ゛`,
      emphasis: true,
    };
  }

  if (type === 'HANDAKUON') {
    return {
      label: '半浊音',
      detail: 'は行 + ゜ → p',
      emphasis: true,
    };
  }

  if (type === 'SPECIAL' || rowName === '特殊') {
    return {
      label: '特殊拍',
      detail: 'ん (n)，无元音',
      emphasis: true,
    };
  }

  const kana = (hiragana: string, katakana: string) =>
    displayKana(hiragana, katakana, scriptMode);

  switch (rowName) {
    case 'あ行':
      return { label: '元音地基', detail: 'a · i · u · e · o', emphasis: true };
    case 'さ行':
      return { label: '特殊读音', detail: `${kana('し', 'シ')} (shi)`, emphasis: true };
    case 'た行':
      return {
        label: '特殊读音',
        detail: `${kana('ち', 'チ')} (chi) · ${kana('つ', 'ツ')} (tsu)`,
        emphasis: true,
      };
    case 'は行':
      return { label: '特殊读音', detail: `${kana('ふ', 'フ')} (fu)`, emphasis: true };
    case 'や行':
      return { label: '少两个音', detail: '只有 ya · yu · yo', emphasis: true };
    case 'わ行':
      return { label: '读音提醒', detail: `${kana('を', 'ヲ')} (o)，不是 wo`, emphasis: true };
    default:
      return { label: '辅音规律', detail: '辅音 + a/i/u/e/o', emphasis: false };
  }
}

/** 左侧固定行栏：行名、行讲义入口和本行最值得注意的声音规则。 */
export function KanaRowLabel({
  rowName,
  items,
  scriptMode,
  onOpen,
}: {
  rowName: string;
  items: readonly KanaItem[];
  scriptMode: KanaRowLabelScriptMode;
  onOpen: () => void;
}) {
  const highlight = rowHighlight(rowName, items, scriptMode);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onOpen}
      className="group h-full min-h-20 w-full min-w-0 flex-col items-start justify-center gap-1 rounded-xl border-b border-ink-stone-200 px-2.5 py-3 text-left hover:bg-wash-amber-500o10 hover:text-tone-amber-700 dark:border-tone-stone-800 dark:hover:text-ink-amber-300 sm:rounded-none sm:border-b-0 sm:border-r sm:px-3 sm:py-2 transition-colors"
      aria-label={`打开 ${rowName} 的行记忆讲义`}
    >
      <span className="font-serif text-xs font-bold text-ink-faint sm:text-sm">
        {rowName}
      </span>
      <span className="flex items-center gap-1 text-xs font-sans font-normal text-ink-stone-400 transition-colors group-hover:text-tone-amber-700 dark:text-ink-stone-500 dark:group-hover:text-ink-amber-300">
        <BookOpen className="h-3 w-3" />
        讲这一行
      </span>
      <Badge
        variant={highlight.emphasis ? 'amber' : 'outline'}
        className={cn(
          'max-w-full gap-1 truncate px-1.5 py-0 text-[9px] leading-4',
          !highlight.emphasis && 'text-ink-hint'
        )}
      >
        {highlight.label}
      </Badge>
      <span
        className={cn(
          'max-w-full truncate font-mono text-xs leading-4',
          highlight.emphasis
            ? 'text-accent-ink-strong'
            : 'text-ink-hint'
        )}
        title={highlight.detail}
      >
        {highlight.detail}
      </span>
    </Button>
  );
}

/** 卡片内的短提示：只标出真正需要额外注意的读法或组合。 */
export function getKanaCardHighlight(kana: KanaItem): string | null {
  if (kana.type === 'YOON') return '小字合音';
  if (kana.type === 'DAKUON') return '゛带声';
  if (kana.type === 'HANDAKUON') return '゜p 音';
  if (kana.type === 'SPECIAL' || kana.hiragana === 'ん') return '无元音';
  if (kana.hiragana === 'し') return 'shi，不是 si';
  if (kana.hiragana === 'ち') return 'chi，不是 ti';
  if (kana.hiragana === 'つ') return 'tsu，不是 tu';
  if (kana.hiragana === 'ふ') return 'fu，不是 hu';
  if (kana.hiragana === 'を') return '读 o，不是 wo';
  return null;
}
