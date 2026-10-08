import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { sound } from "../../utils/audio.js";
import { Badge } from "../ui/badge.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
import type { DrillMode } from './types.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { KanaWordExercise } from './KanaWordExercise.js';
import { KanaRecognitionExercise } from './KanaRecognitionExercise.js';
import { KanaDrillEmpty } from './KanaDrillEmpty.js';
export function KanaDrill({ state }: {
    state: KanaStudioState;
}) {
    const { focusKanaIds, matrixTab, drillMode, setDrillMode, drillIndex, setDrillIndex, drillStreak, setSelectedOption, setIsAnswered, drillCount, setDrillCount, setDrillRound, drillAnswered, drillCorrect, resetRoundStats, generateWords, wordList, wordIndex, setWordIndex, setWordInput, setWordStudyDone, isWordMode, adaptiveKanaQueueQuery, drillItems, currentDrillKana } = state;
    return (<motion.div key="drill" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="max-w-2xl mx-auto bg-paper-soft rounded-3xl p-6 sm:p-8 border border-line-amber-900o15-amber-500o20 shadow-md space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="amber">考核冲刺</Badge>
                <span className="text-xs text-ink-stone-500">
                  {isWordMode ? (wordList.length === 0 ? (<>{generateWords.isPending ? '抽词中…' : '暂无词语'}</>) : (<>第 {wordIndex + 1} / {wordList.length} 词</>)) : drillItems.length === 0 ? (<>{adaptiveKanaQueueQuery.isLoading ? '正在按练习记录组题…' : '暂无题目'}</>) : (<>第 {drillIndex + 1} / {drillItems.length} 题</>)}
                </span>
                {!isWordMode && drillItems.length > 0 && (<span className="text-[10px] px-1.5 py-0.5 rounded-md bg-veil-stone-200o70-stone-800 text-ink-ghost" title="题池跟随矩阵选项卡范围">
                    {matrixTab === 'SEION'
                ? '清音矩阵'
                : matrixTab === 'DAKUON_HANDAKUON'
                    ? '浊音·半浊音'
                    : '常用拗音'}
                  </span>)}
              </div>

              <div className="flex items-center gap-3">
                {drillStreak > 0 && (<div className="flex items-center gap-1 text-xs font-bold text-accent-ink">
                    <Flame className="w-4 h-4 fill-tone-amber-500 text-tone-amber-500 animate-pulse"/>
                    <span>{drillStreak} 连对</span>
                  </div>)}
                {drillAnswered > 0 && (<div className="text-xs text-ink-ghost" title="本轮战报会随画像回写，导师可见你的假名薄弱项">
                    本轮 {drillCorrect}/{drillAnswered} ·{' '}
                    {Math.round((drillCorrect / drillAnswered) * 100)}%
                  </div>)}
                {/* 自测题型切换 */}
                <Select value={drillMode} onValueChange={(value) => {
            if (value === null)
                return;
            sound.playClick();
            setDrillMode(value as DrillMode);
            setDrillRound((round) => round + 1);
            setSelectedOption(null);
            setIsAnswered(false);
            setWordIndex(0);
            setWordInput('');
            setWordStudyDone(false);
            resetRoundStats();
        }}>
                  <SelectTrigger aria-label="自测题型" className="w-auto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="AUDIO_TO_KANA">听音辨字</SelectItem>
                  <SelectItem value="KANA_TO_ROMAJI">看字辨音</SelectItem>
                  <SelectItem value="HIRA_TO_KATA">平片互转</SelectItem>
                  <SelectItem value="MIXED">综合混合</SelectItem>
                  {!focusKanaIds && <SelectItem value="WORD_DICTATION">单词听写</SelectItem>}
                  {!focusKanaIds && <SelectItem value="WORD_MEANING">词义回想</SelectItem>}
                </SelectContent></Select>
                {!isWordMode && (<Select value={drillCount} onValueChange={(value) => {
                if (value === null)
                    return;
                sound.playClick();
                setDrillCount(Number(value));
                setDrillRound((round) => round + 1);
                setDrillIndex(0);
                setSelectedOption(null);
                setIsAnswered(false);
                resetRoundStats();
            }}>
                    <SelectTrigger aria-label="每轮题量" className="w-auto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={10}>10 题</SelectItem>
                    <SelectItem value={20}>20 题</SelectItem>
                    <SelectItem value={50}>50 题</SelectItem>
                    <SelectItem value={0}>全部</SelectItem>
                  </SelectContent></Select>)}
              </div>
            </div>

            {/* 题干区域 */}
            {isWordMode ? <KanaWordExercise state={state}/> : currentDrillKana ? <KanaRecognitionExercise state={state}/> : <KanaDrillEmpty state={state}/>}
          </motion.div>);
}
