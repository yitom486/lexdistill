import { Volume2, RefreshCw, CheckCircle2, XCircle, BookOpen } from "lucide-react";
import { sound, speechStudio } from "../../utils/audio.js";
import { Button } from "../ui/button.js";
import { romajiToKana } from "../../lib/kana-input.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
export function KanaWordExercise({ state }: {
    state: KanaStudioState;
}) {
    const { allKana, scriptMode, drillMode, selectedOption, isAnswered, generateWords, collectEntry, wordInput, setWordInput, wordStudyDone, setWordStudyDone, currentWord, meaningOptions, handleSubmitWordInput, handleSelectMeaningOption, handleCollectWord, handleNextWord, handleRefreshWords } = state;
    return (<div className="text-center py-6 space-y-4">
                {!currentWord ? (<p className="text-xs text-ink-stone-500">
                    {generateWords.isPending ? '正在从本地词典抽词…' : '暂无可用词语，请先安装日语词典包。'}
                  </p>) : !wordStudyDone ? (<div className="space-y-4">
                    <p className="text-xs text-ink-stone-500">先学：看读音释义、跟读两遍，再去测验</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentWord.kana}
                    </div>
                    <p className="text-sm text-ink-ghost">
                      {currentWord.headword}
                    </p>
                    <p className="text-sm text-ink-mute-deep">
                      {currentWord.meanings.join('；')}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <Button onClick={() => {
                sound.playClick();
                void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'preview' });
            }} variant="outline" size="sm" className="gap-1.5 text-xs">
                        <Volume2 className="w-3.5 h-3.5"/>
                        跟读
                      </Button>
                      <Button onClick={() => {
                sound.playClick();
                setWordStudyDone(true);
            }} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6">
                        记住了，去测验 ➔
                      </Button>
                    </div>
                  </div>) : drillMode === 'WORD_DICTATION' ? (<div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">听发音，用罗马字拼出假名（自动转换）：</p>
                    <button onClick={() => {
                sound.playClick();
                void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'dictation' });
            }} className="mx-auto w-20 h-20 rounded-full bg-wash-amber-500o15 border-2 border-line-amber-500o30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-accent-ink-strong shadow-sm">
                      <Volume2 className="w-8 h-8"/>
                    </button>
                    <p className="text-sm text-ink-faint">
                      词义提示：{currentWord.meanings.join('；')}
                    </p>
                    <p className="text-4xl font-serif font-bold text-ink min-h-[3rem]">
                      {wordInput
                ? romajiToKana(wordInput, allKana, scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA') || '···'
                : '···'}
                    </p>
                    <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
                      <input value={wordInput} onChange={(e) => setWordInput(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter')
                    handleSubmitWordInput();
            }} disabled={isAnswered} placeholder="输入罗马字，如 ame（长音用 -，如 konpyu-ta-）" className="flex-1 rounded-xl border border-line-stone-300-stone-700 bg-surface-dim px-3 py-2 text-sm font-mono"/>
                      {!isAnswered && (<Button onClick={handleSubmitWordInput} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-5">
                          提交
                        </Button>)}
                    </div>
                    {isAnswered && (<p className="text-sm text-ink-faint">
                        正确答案：<span className="font-bold font-serif">{currentWord.kana}</span>
                        <span className="text-ink-stone-400">（{currentWord.headword}）</span>
                      </p>)}
                  </div>) : (<div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">看单词，选择正确的中文释义：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentWord.kana}
                    </div>
                    <button onClick={() => {
                sound.playClick();
                void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'preview' });
            }} className="text-xs text-accent-ink hover:underline">
                      🔊 播放发音
                    </button>
                    <div className="grid grid-cols-1 gap-3 pt-2 max-w-md mx-auto">
                      {meaningOptions.map((opt, idx) => {
                const correct = currentWord.meanings[0] ?? '';
                const isCorrectOpt = opt === correct;
                const isSelected = selectedOption === opt;
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
                return (<button key={idx} onClick={() => handleSelectMeaningOption(opt)} disabled={isAnswered} className={`p-3 rounded-2xl border text-sm transition-all ${btnStyle}`}>
                            <span>{opt}</span>
                            {isAnswered && isCorrectOpt && (<CheckCircle2 className="w-4 h-4 text-tone-emerald-500 inline ml-2"/>)}
                            {isAnswered && isSelected && !isCorrectOpt && (<XCircle className="w-4 h-4 text-tone-rose-500 inline ml-2"/>)}
                          </button>);
            })}
                    </div>
                  </div>)}

                {/* 单词作答后操作区：转生词卡 / 换一批 / 下一词 */}
                {isAnswered && (<div className="flex items-center justify-center gap-3 pt-4">
                    <Button onClick={handleCollectWord} disabled={collectEntry.isPending} variant="outline" size="sm" className="gap-1.5 text-xs text-accent-ink-strong">
                      <BookOpen className="w-3.5 h-3.5"/>
                      转生词卡
                    </Button>
                    <Button onClick={handleRefreshWords} variant="outline" size="sm" className="gap-1.5 text-xs">
                      <RefreshCw className="w-3.5 h-3.5"/>
                      换一批
                    </Button>
                    <Button onClick={handleNextWord} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6">
                      下一词 ➔
                    </Button>
                  </div>)}
              </div>);
}
