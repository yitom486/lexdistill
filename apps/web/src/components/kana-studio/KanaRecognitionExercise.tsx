import { Volume2, CheckCircle2, XCircle, Bot, BookOpen } from "lucide-react";
import { Button } from "../ui/button.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
export function KanaRecognitionExercise({ state }: {
    state: KanaStudioState;
}) {
    const { allKana, practiceMutation, scriptMode, selectedOption, isAnswered, handlePlayAudio, handleOpenKanaGuide, currentDrillKana, activeMode, drillOptions, drillCorrectAnswer, handleSelectDrillOption, handleNextDrill, handleAskTutor } = state;
    if (!currentDrillKana)
        return null;
    return (<div className="text-center py-6 space-y-4">
                {activeMode === 'AUDIO_TO_KANA' ? (<div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">听发音，点击选择正确的假名：</p>
                    <button onClick={() => handlePlayAudio(currentDrillKana)} className="mx-auto w-20 h-20 rounded-full bg-wash-amber-500o15 border-2 border-line-amber-500o30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-accent-ink-strong shadow-sm">
                      <Volume2 className="w-8 h-8"/>
                    </button>
                  </div>) : activeMode === 'KANA_TO_ROMAJI' ? (<div className="space-y-2">
                    <p className="text-xs text-ink-stone-500">看假名，选择正确的罗马字发音：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {scriptMode === 'KATAKANA'
                ? currentDrillKana.katakana
                : currentDrillKana.hiragana}
                    </div>
                  </div>) : (<div className="space-y-2">
                    <p className="text-xs text-ink-stone-500">平假名 ➔ 选出对应的片假名：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentDrillKana.hiragana}
                    </div>
                  </div>)}

                {/* 选项矩阵 (4 选 1) */}
                <div className="grid grid-cols-2 gap-3 pt-4 max-w-md mx-auto">
                  {drillOptions.map((opt, idx) => {
            let isCorrectOpt = false;
            if (activeMode === 'AUDIO_TO_KANA') {
                isCorrectOpt =
                    opt ===
                        (scriptMode === 'KATAKANA'
                            ? currentDrillKana.katakana
                            : currentDrillKana.hiragana);
            }
            else if (activeMode === 'KANA_TO_ROMAJI') {
                isCorrectOpt = opt === currentDrillKana.romaji;
            }
            else {
                isCorrectOpt = opt === currentDrillKana.katakana;
            }
            const isSelected = selectedOption === opt;
            const optionKana = allKana.find((kana) => {
                if (activeMode === 'KANA_TO_ROMAJI')
                    return kana.romaji === opt;
                if (activeMode === 'HIRA_TO_KATA')
                    return kana.katakana === opt;
                return (scriptMode === 'KATAKANA' ? kana.katakana : kana.hiragana) === opt;
            });
            let btnStyle = 'bg-tone-white dark:bg-tone-stone-800o80 border-line hover:border-tone-amber-500o50';
            if (isAnswered) {
                if (isCorrectOpt) {
                    btnStyle = 'bg-tone-emerald-500o15 border-tone-emerald-500 text-ink-emerald-800-emerald-300 font-bold';
                }
                else if (isSelected) {
                    btnStyle = 'bg-wash-rose-500o15 border-tone-rose-500 text-ink-rose-800-rose-300';
                }
                else {
                    btnStyle = 'opacity-40 border-line-soft';
                }
            }
            return (<button key={idx} onClick={() => handleSelectDrillOption(opt)} disabled={isAnswered} className={`p-4 rounded-2xl border text-xl font-serif font-bold transition-all flex items-center justify-center gap-2 ${btnStyle}`}>
                        <span className="flex flex-col items-center leading-tight">
                          <span>{opt}</span>
                          {isAnswered && activeMode !== 'KANA_TO_ROMAJI' && optionKana && (<span className="text-xs font-mono font-normal text-ink-ghost">
                              {optionKana.romaji}
                            </span>)}
                        </span>
                        {isAnswered && isCorrectOpt && (<CheckCircle2 className="w-4 h-4 text-tone-emerald-500"/>)}
                        {isAnswered && isSelected && !isCorrectOpt && (<XCircle className="w-4 h-4 text-tone-rose-500"/>)}
                      </button>);
        })}
                </div>
                {isAnswered && activeMode !== 'KANA_TO_ROMAJI' && (<p className="text-xs text-ink-ghost">
                    正确读音：<span className="font-mono font-semibold text-accent-ink-strong">{currentDrillKana.romaji}</span>
                  </p>)}

                {/* 作答后操作区 */}
                {isAnswered && (<div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                    <Button onClick={() => currentDrillKana &&
                handleAskTutor(currentDrillKana, {
                    wasWrong: selectedOption !== drillCorrectAnswer,
                    ...(selectedOption ? { userPick: selectedOption } : {}),
                })} variant="outline" size="sm" className="gap-1.5 text-xs text-accent-ink-strong">
                      <Bot className="w-3.5 h-3.5"/>
                      问 AI 导师
                    </Button>
                    <Button type="button" onClick={() => currentDrillKana && handleOpenKanaGuide(currentDrillKana)} variant="outline" size="sm" className="gap-1.5 text-xs text-accent-ink-strong">
                      <BookOpen className="w-3.5 h-3.5"/>
                      查看详情
                    </Button>
                    <Button onClick={handleNextDrill} disabled={practiceMutation.isPending} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6">
                      下一题 ➔
                    </Button>
                  </div>)}
              </div>);
}
