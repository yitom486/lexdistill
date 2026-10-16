import { Award, BookOpen } from "lucide-react";
import { sound } from "../../utils/audio.js";
import { ShimmerButton } from "../magicui/index.js";
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from "../ui/tabs.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
import { MatrixTab } from './types.js';
export function KanaStudioHeader({ state }: {
    state: KanaStudioState;
}) {
    const { focusKanaIds, matrixTab, setMatrixTab, scriptMode, setScriptMode, showRomaji, setShowRomaji, setIsMemoryGuideOpen, isDrillActive, setIsDrillActive, setSelectedOption, setIsAnswered, setDrillRound, resetRoundStats, setWordIndex, setWordInput, setWordStudyDone, allKana, isKanaLoading } = state;
    // 自测需要假名表真实可用；无数据时禁用并说明原因，不伪装能开始
    const drillUnavailable = isKanaLoading || allKana.length === 0;
    const drillDisabledReason = isKanaLoading ? '假名表加载中，稍候可自测' : '暂无假名数据，无法开始自测';
    return (<div className="bg-paper-soft rounded-2xl p-4 sm:p-6 border border-line-accent shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="amber">假名入门</Badge>
              <span className="text-xs text-ink-ghost">
                平假名与片假名的认读、发音与自测
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-ink mt-1">
              五十音工作室 (Kana Studio)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 平/片假名切换 */}
            <div className="flex items-center bg-veil-stone-200o70-stone-800o80 rounded-xl p-1 text-xs">
              <button onClick={() => {
            sound.playClick();
            setScriptMode('HIRAGANA');
        }} className={`px-3 py-1.5 rounded-lg font-medium transition-all ${scriptMode === 'HIRAGANA'
            ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
            : 'text-ink-stone-500 hover:text-ink-soft'}`}>
                平假名
              </button>
              <button onClick={() => {
            sound.playClick();
            setScriptMode('KATAKANA');
        }} className={`px-3 py-1.5 rounded-lg font-medium transition-all ${scriptMode === 'KATAKANA'
            ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
            : 'text-ink-stone-500 hover:text-ink-soft'}`}>
                片假名
              </button>
              <button onClick={() => {
            sound.playClick();
            setScriptMode('BOTH');
        }} className={`px-3 py-1.5 rounded-lg font-medium transition-all ${scriptMode === 'BOTH'
            ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
            : 'text-ink-stone-500 hover:text-ink-soft'}`}>
                平片对照
              </button>
            </div>

            {/* 罗马音注音显示开关 */}
            <Button variant="outline" size="sm" onClick={() => {
            sound.playClick();
            setShowRomaji(!showRomaji);
        }} className="text-xs gap-1.5">
              <span>罗马字: {showRomaji ? '开' : '关'}</span>
            </Button>

            <Button variant="amber" size="sm" onClick={() => {
            sound.playClick();
            setIsMemoryGuideOpen(true);
        }} className="gap-1.5 text-xs shadow-sm" aria-label="打开五十音记忆法">
              <BookOpen className="h-3.5 w-3.5"/>
              <span>五十音记忆法</span>
            </Button>

            {/* 自测模式切换：数据门槛只限制进入，返回矩阵始终可用 */}
            <ShimmerButton onClick={() => {
            sound.playClick();
            const enteringDrill = !isDrillActive;
            setIsDrillActive(enteringDrill);
            if (enteringDrill)
                setDrillRound((round) => round + 1);
            setSelectedOption(null);
            setIsAnswered(false);
            setWordIndex(0);
            setWordInput('');
            setWordStudyDone(false);
            resetRoundStats();
        }} disabled={!isDrillActive && drillUnavailable} className="px-3.5 py-1.5 text-xs font-semibold gap-1.5 shadow-md" title={isDrillActive ? '返回假名矩阵' : (drillUnavailable ? drillDisabledReason : '启动假名自测')}>
              <Award className="w-3.5 h-3.5"/>
              <span>{isDrillActive ? '返回假名矩阵' : '启动假名自测'}</span>
            </ShimmerButton>
          </div>
        </div>

        {/* 矩阵选项卡 (清音 / 浊音&半浊音 / 拗音) */}
        {!isDrillActive && !focusKanaIds && (<div className="mt-4 pt-4 border-t border-line-amber-900o10-amber-500o10 flex items-center justify-between">
            <Tabs value={matrixTab} onValueChange={(val) => {
                if (!val)
                    return;
                sound.playClick();
                setMatrixTab(val as MatrixTab);
            }}>
              <TabsList className="bg-transparent p-0 border-0">
                <TabsIndicator className="bg-tone-amber-500 shadow-sm"/>
                <TabsTrigger value="SEION" className="px-3 py-1.5 text-xs aria-selected:text-tone-stone-950">
                  清音矩阵 (46)
                </TabsTrigger>
                <TabsTrigger value="DAKUON_HANDAKUON" className="px-3 py-1.5 text-xs aria-selected:text-tone-stone-950">
                  浊音与半浊音 (25)
                </TabsTrigger>
                <TabsTrigger value="YOON" className="px-3 py-1.5 text-xs aria-selected:text-tone-stone-950">
                  常用拗音 (33)
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <span className="text-xs text-ink-stone-400 font-mono hidden sm:inline">
              点击假名播放发音 · 点击“详情”打开讲义
            </span>
          </div>)}
      </div>);
}
