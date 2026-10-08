import { motion } from "framer-motion";
import { Volume2, Lightbulb } from "lucide-react";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { getKanaCardHighlight, KanaRowLabel } from "../ja/kana/KanaRowLabel.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
import { KANA_COLUMN_CLASSES } from './types.js';
export function KanaMatrix({ state }: {
    state: KanaStudioState;
}) {
    const { refetchKana, isKanaLoading, scriptMode, showRomaji, activeKana, groupedByRow, handlePlayAudio, handleSelectKana, handleOpenKanaGuide, handleOpenRowGuide } = state;
    return (<motion.div key="matrix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {groupedByRow.length > 0 ? (<div className="grid grid-cols-1 gap-4">
                {groupedByRow.map(({ rowName, items }) => (<div key={rowName} className="grid grid-cols-1 gap-3 rounded-2xl border border-line-amber-900o10 bg-paper-soft p-3.5 dark:border-wash-amber-500o10 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-stretch sm:p-4 transition-colors">
                  <KanaRowLabel rowName={rowName} items={items} scriptMode={scriptMode} onOpen={() => handleOpenRowGuide(rowName, items)}/>

                  <div className="grid min-w-0 grid-cols-5 gap-2 sm:gap-3">
                    {items.map((kana) => {
                    const isActive = activeKana?.id === kana.id;
                    const cardHighlight = getKanaCardHighlight(kana);
                    return (<div key={kana.id} onClick={() => handleSelectKana(kana)} className={`group relative ${KANA_COLUMN_CLASSES[kana.col] ?? ''} flex flex-col items-center justify-center gap-1 rounded-xl border p-2.5 transition-all cursor-pointer select-none sm:p-3.5 ${isActive
                            ? 'bg-wash-amber-500o15 border-tone-amber-500 shadow-sm'
                            : 'bg-tone-white dark:bg-tone-stone-800o80 border-line-stone-200o80-stone-700o80 hover:border-tone-amber-500o50 hover:shadow-sm'}`}>
                          {/* 假名主字面 */}
                          <div className="text-xl sm:text-2xl font-serif font-bold text-ink group-hover:scale-105 transition-transform flex items-baseline gap-1">
                            {scriptMode === 'HIRAGANA' && <span>{kana.hiragana}</span>}
                            {scriptMode === 'KATAKANA' && <span>{kana.katakana}</span>}
                            {scriptMode === 'BOTH' && (<>
                                <span>{kana.hiragana}</span>
                                <span className="text-xs text-ink-stone-400 font-sans font-normal">
                                  / {kana.katakana}
                                </span>
                              </>)}
                          </div>

                          {/* 罗马音辅助注记 */}
                          {showRomaji && (<div className="text-[11px] font-mono text-ink-stone-400 group-hover:text-accent-ink">
                              {kana.romaji}
                            </div>)}

                          {cardHighlight && (<Badge variant="amber" className="max-w-full truncate px-1.5 py-0 text-[9px] leading-4">
                              {cardHighlight}
                            </Badge>)}

                          <Button type="button" variant="ghost" size="sm" onClick={(event) => {
                            event.stopPropagation();
                            handleOpenKanaGuide(kana);
                        }} className="mt-1 h-6 rounded-lg px-2 text-[10px] text-tone-amber-700 hover:bg-wash-amber-500o15 dark:text-ink-amber-300 transition-colors" aria-label={`查看 ${kana.hiragana} 的发音与记忆详情`}>
                            <Lightbulb className="h-3 w-3"/>
                            详情
                          </Button>

                          {/* 试听按钮在桌面端悬停显示，在触摸设备上保持可见 */}
                          <Button type="button" variant="ghost" size="icon" onClick={(event) => handlePlayAudio(kana, event)} className="absolute right-1 top-1 h-7 w-7 rounded-lg p-0 text-ink-stone-400 opacity-70 transition-opacity hover:text-tone-amber-600 sm:opacity-0 sm:group-hover:opacity-100" title="播放发音" aria-label={`播放 ${kana.hiragana} 发音`}>
                            <Volume2 className="h-3 w-3"/>
                          </Button>
                        </div>);
                })}
                  </div>
                </div>))}
              </div>) : (<div className="rounded-2xl border border-line-amber-900o10 bg-paper-soft p-6 text-center dark:border-wash-amber-500o10 transition-colors">
                <p className="text-xs leading-relaxed text-ink-ghost">
                  {isKanaLoading
                ? '正在加载假名表…'
                : '假名表暂时不可用，请确认网关已启动（默认 localhost:8080），然后重试。'}
                </p>
                {!isKanaLoading && (<Button type="button" size="sm" variant="outline" onClick={() => {
                    void refetchKana();
                }} className="mt-3">
                    重新加载
                  </Button>)}
              </div>)}


          </motion.div>);
}
