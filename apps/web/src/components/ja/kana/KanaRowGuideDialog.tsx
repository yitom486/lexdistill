import React from 'react';
import { ArrowRight, GitCompareArrows, Info, Lightbulb, Volume2 } from 'lucide-react';
import type { KanaItem } from '@lexdistill/protocol';
import { speechStudio, sound } from '../../../utils/audio.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';
import { KanaGuideSpeakButton } from './KanaGuideSpeakButton.js';
import { useKanaAudio } from '../../../hooks/useKanaAudio.js';
import { DAKUTEN_ROW_GUIDES } from './dakuten/dakuten-row-guide.js';
import { HIRAGANA_ROW_GUIDES } from './hiragana/hiragana-row-guide.js';
import { KATAKANA_ROW_GUIDES } from './katakana/katakana-row-guide.js';
import {
  YOON_DEFAULT_GUIDE,
  YOON_ROW_NOTES,
} from './yoon/yoon-row-guide.js';
import type { KanaRowGuideContent } from './kana-row-guide-types.js';

export type KanaGuideScriptMode = 'HIRAGANA' | 'KATAKANA' | 'BOTH';

export interface KanaRowGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowName: string;
  items: readonly KanaItem[];
  scriptMode: KanaGuideScriptMode;
}

const FALLBACK_ROW_GUIDE: KanaRowGuideContent = {
  title: '这一行，先认声音再认轮廓',
  summary: '先把这一行的声音读一遍，再用罗马字、字形和词例反复确认。',
  memoryTip: '先顺读一次，马上打乱；不要只记住表格路线。',
  pronunciationTip: '一拍一拍读清楚，不要额外加中文声调，也不要把两个假名黏成奇怪的新音。',
  confusions: ['先听音，再看形', '和相邻行做一次对比'],
  examples: [],
};

function resolveRowGuide(
  rowName: string,
  items: readonly KanaItem[],
  scriptMode: KanaGuideScriptMode
): KanaRowGuideContent {
  const type = items[0]?.type;

  if (type === 'YOON' || rowName.includes('拗音')) {
    const rowNote = YOON_ROW_NOTES[rowName] ?? YOON_DEFAULT_GUIDE.summary;
    return {
      ...YOON_DEFAULT_GUIDE,
      title: `${rowName}：小字一来，声音就合体`,
      summary: rowNote,
    };
  }

  if (type === 'DAKUON' || type === 'HANDAKUON') {
    return DAKUTEN_ROW_GUIDES[rowName] ?? FALLBACK_ROW_GUIDE;
  }

  if (scriptMode === 'KATAKANA') {
    return KATAKANA_ROW_GUIDES[rowName] ?? HIRAGANA_ROW_GUIDES[rowName] ?? FALLBACK_ROW_GUIDE;
  }

  return HIRAGANA_ROW_GUIDES[rowName] ?? FALLBACK_ROW_GUIDE;
}

function typeLabel(items: readonly KanaItem[]): string {
  const type = items[0]?.type;
  if (type === 'YOON') return '拗音';
  if (type === 'DAKUON') return '浊音';
  if (type === 'HANDAKUON') return '半浊音';
  if (type === 'SPECIAL') return '特殊拍';
  return '清音';
}

export function KanaRowGuideDialog({
  open,
  onOpenChange,
  rowName,
  items,
  scriptMode,
}: KanaRowGuideDialogProps) {
  const guide = resolveRowGuide(rowName, items, scriptMode);
  const rowAudioText = items.map((item) => item.audioText).join('');
  const kind = typeLabel(items);
  const { playText: playRowText } = useKanaAudio();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && items.length > 0 && (
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <div className="flex max-h-[90vh] flex-col">
            <DialogHeader className="shrink-0 border-b border-line-amber-900o10 bg-linear-to-br from-paper-soft via-grad-amber-50-amber-950o35 to-grad-orange-50-orange-950o25 p-5 pr-12 dark:border-wash-amber-500o15 sm:p-6 sm:pr-14 transition-colors">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="amber">这一行的记忆卡</Badge>
                <span className="text-xs font-serif text-ink-ghost">
                  {rowName} · {kind}
                </span>
                <KanaGuideSpeakButton
                  text={rowAudioText}
                  label={`播放${rowName}整行发音`}
                  className="ml-auto"
                />
              </div>
              <DialogTitle className="mt-2 text-2xl sm:text-3xl">{guide.title}</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-relaxed">
                {guide.summary}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto bg-paper-clean p-4 sm:p-6">
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                <section className="rounded-3xl border border-tone-amber-500o25 bg-wash-amber-500o10 p-4 dark:bg-wash-amber-500o10 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-wash-amber-500o15 text-accent-ink-strong">
                      <Volume2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-ink-strong">
                            这一行先听一遍
                          </p>
                          <h3 className="mt-0.5 text-lg font-serif font-bold text-ink">
                            {rowName} 不要只看，要让耳朵也签到
                          </h3>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="amber"
                          className="gap-1.5"
                          onClick={() => {
                            sound.playClick();
                            void playRowText(rowAudioText, { sequence: true }).then((played) => {
                              if (!played) {
                                void speechStudio.speak(rowAudioText, { lang: 'JA', purpose: 'preview' });
                              }
                            });
                          }}
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          听整行
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-1.5 rounded-2xl border border-tone-amber-500o20 bg-veil-whiteo75-stone-900o45 px-3 py-2"
                          >
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-serif text-2xl font-bold text-ink">
                                {scriptMode === 'KATAKANA' ? item.katakana : item.hiragana}
                              </span>
                              {scriptMode === 'BOTH' && (
                                <span className="text-xs text-ink-ghost">
                                  / {item.katakana}
                                </span>
                              )}
                              <span className="font-mono text-xs font-bold text-accent-ink-strong">
                                {item.romaji}
                              </span>
                            </div>
                            <KanaGuideSpeakButton
                              text={item.audioText}
                              label={`播放 ${item.hiragana}（${item.romaji}）发音`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <div className="grid gap-3 md:grid-cols-2">
                  <section className="rounded-3xl border border-line-sky-500o20 bg-wash-sky-500o10 p-4 dark:bg-wash-sky-500o10 transition-colors">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-sky-900-sky-200">
                      <Lightbulb className="h-4 w-4" />
                      记忆抓手
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-mute-deep">
                      {guide.memoryTip}
                    </p>
                  </section>
                  <section className="rounded-3xl border border-line-violet-500o20 bg-wash-violet-500o10 p-4 dark:bg-wash-violet-500o10 transition-colors">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-violet-900-violet-200">
                      <Info className="h-4 w-4" />
                      发音提醒
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-mute-deep">
                      {guide.pronunciationTip}
                    </p>
                  </section>
                </div>

                <section className="rounded-3xl border border-line-rose-500o20 bg-wash-rose-500o10 p-4 dark:bg-wash-rose-500o10 transition-colors">
                  <div className="flex items-center gap-2 text-sm font-bold text-ink-rose-900-rose-200">
                    <GitCompareArrows className="h-4 w-4" />
                    容易撞脸的地方
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {guide.confusions.map((confusion) => (
                      <span
                        key={confusion}
                        className="rounded-full border border-line-rose-500o20 bg-veil-whiteo70-stone-900o35 px-3 py-1.5 text-xs font-semibold text-tone-stone-700 dark:text-ink-stone-200 transition-colors"
                      >
                        {confusion}
                      </span>
                    ))}
                  </div>
                </section>

                {guide.examples.length > 0 && (
                  <section className="rounded-3xl border border-line-emerald-500o20 bg-wash-emerald-500o10 p-4 dark:bg-wash-emerald-500o10 transition-colors">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-emerald-900-emerald-200">
                      <ArrowRight className="h-4 w-4" />
                      放进词里，记忆就不飘了
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {guide.examples.map((example) => (
                        <div
                          key={`${example.word}-${example.reading}`}
                          className="flex items-center justify-between gap-2 rounded-2xl border border-tone-emerald-500o15 bg-veil-whiteo70-stone-900o35 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-serif text-lg font-bold text-ink">
                                {example.word}
                              </span>
                              <span className="font-mono text-xs text-ink-emerald-700-emerald-300">
                                {example.reading}
                              </span>
                            </div>
                            <span className="text-xs text-ink-faint">
                              {example.meaning}
                            </span>
                          </div>
                          <KanaGuideSpeakButton
                            text={example.word}
                            label={`播放例词 ${example.word}（${example.reading}）`}
                            className="shrink-0"
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <p className="rounded-2xl border border-ink-stone-200 bg-veil-whiteo70-stone-900o30 p-3 text-xs leading-relaxed text-ink-stone-500 dark:border-tone-stone-800 dark:text-ink-stone-400 transition-colors">
                  先试着自己读一遍，再点播放按钮核对。读错不扣分，它只是告诉你这一行还需要再见几次。
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
