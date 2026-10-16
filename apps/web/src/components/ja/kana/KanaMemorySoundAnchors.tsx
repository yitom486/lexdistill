import { GitCompareArrows } from 'lucide-react';
import { KANA_MEMORY_GUIDE } from './kana-memory-guide.js';
import { KanaGuideSpeakButton } from './KanaGuideSpeakButton.js';
export function KanaMemorySoundAnchors() { return (
                <div className="mt-3 rounded-3xl border border-tone-amber-500o25 bg-wash-amber-500o10 p-4 dark:bg-wash-amber-500o10 transition-colors">
                  <div className="flex items-center gap-2 text-sm font-bold text-ink-amber-900-amber-200">
                    <GitCompareArrows className="h-4 w-4" />
                    这些音，建议直接点一下听
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {KANA_MEMORY_GUIDE.keySounds.map((item) => (
                      <div
                        key={item.kana}
                        className="flex items-center gap-1.5 rounded-2xl border border-tone-amber-500o20 bg-veil-whiteo70-stone-900o45 px-2.5 py-1.5"
                      >
                        <span className="font-serif text-base font-bold text-ink">
                          {item.kana}
                        </span>
                        <span className="font-mono text-xs text-accent-ink-strong">
                          ({item.romaji})
                        </span>
                        <KanaGuideSpeakButton
                          text={item.kana}
                          label={`播放 ${item.kana}（${item.romaji}）发音`}
                        />
                        <span className="hidden text-xs text-ink-ghost sm:inline">
                          {item.note}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                    罗马字可以帮你搭桥，但耳朵才是最后验收员。尤其是 `し (shi)`、`ち (chi)`、`つ (tsu)`、`ふ (fu)` 和 `ら (ra)`，不要只看字母猜声音。
                  </p>
                </div>

); }
