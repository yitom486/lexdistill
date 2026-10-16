import React, { useMemo, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { useCurriculumHangulQuery } from '../queries/useLearnerQueries.js';
import type { HangulItem } from '@lexdistill/protocol';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useHangulDrill } from './hangul/useHangulDrill.js';
import { HangulMatrix } from './hangul/HangulMatrix.js';
import { HangulDrillControls } from './hangul/HangulDrillControls.js';
import { HangulLetterDrill } from './hangul/HangulLetterDrill.js';
import { HangulWordDrill } from './hangul/HangulWordDrill.js';
import { HangulReport } from './hangul/HangulReport.js';
import type { MatrixTab } from './hangul/hangul-drill.js';

interface HangulStudioWorkbenchProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

/**
 * 谚文工作室：容器只做底座查询与矩阵状态编排，
 * 自测交互归 useHangulDrill，展示归 Matrix/Drill/Report。
 */
export function HangulStudioWorkbench({ onOpenTutor }: HangulStudioWorkbenchProps) {
  const hangulQuery = useCurriculumHangulQuery();
  const allHangul = hangulQuery.data ?? [];

  // 矩阵状态
  const [matrixTab, setMatrixTab] = useState<MatrixTab>('CONSONANT');
  const [showRomaji, setShowRomaji] = useState(true);
  const [activeHangul, setActiveHangul] = useState<HangulItem | null>(null);

  // 题池跟随矩阵选项卡（进阶 = y 系母音 + 复合母音 + 收音代表音）
  const pool = useMemo(
    () =>
      matrixTab === 'ADVANCED'
        ? allHangul.filter((h) => h.type !== 'CONSONANT' && h.type !== 'VOWEL')
        : allHangul.filter((h) => h.type === matrixTab),
    [allHangul, matrixTab]
  );

  const drill = useHangulDrill({ pool, allHangul });

  // 标题计数来自真实数据，不写死
  const consonantCount = allHangul.filter((h) => h.type === 'CONSONANT').length;
  const vowelCount = allHangul.filter((h) => h.type === 'VOWEL').length;
  const advancedCount = allHangul.filter((h) => h.type !== 'CONSONANT' && h.type !== 'VOWEL').length;

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent-ink-warm" />
          <h2 className="text-lg font-semibold">谚文工作室</h2>
          <Badge variant="secondary">
            {hangulQuery.isPending
              ? '读取中…'
              : hangulQuery.isError
                ? '读取失败'
                : `子音 ${consonantCount} · 母音 ${vowelCount} · 进阶 ${advancedCount}`}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowRomaji((v) => !v);
              sound.playClick();
            }}
            aria-pressed={showRomaji}
          >
            {showRomaji ? '隐藏罗马字' : '显示罗马字'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void hangulQuery.refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {hangulQuery.isPending ? (
        <p role="status" className="rounded-xl border p-8 text-center text-sm text-ink-ghost">
          谚文底座加载中…
        </p>
      ) : hangulQuery.isError && !allHangul.length && !drill.isDrillActive ? (
        <div role="alert" className="rounded-xl border p-8 text-center text-sm text-ink-ghost space-y-2">
          <p>谚文底座读取失败，请检查网关后重试。</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void hangulQuery.refetch()} className="gap-1 text-xs">
            重新读取
          </Button>
        </div>
      ) : allHangul.length === 0 ? (
        <div className="rounded-xl border p-8 text-center text-sm text-ink-ghost">
          暂无谚文数据，可稍后刷新。
        </div>
      ) : (
        <>
          {hangulQuery.isError && <p role="alert" className="text-xs text-ink-ghost">更新谚文数据失败，已读取内容和当前练习仍保留。</p>}
          <HangulMatrix
            pool={pool}
            matrixTab={matrixTab}
            onTabChange={setMatrixTab}
            showRomaji={showRomaji}
            activeHangul={activeHangul}
            onSelect={setActiveHangul}
          />

          {/* 自测区 */}
          <div className="rounded-xl border p-4 space-y-4">
            <HangulDrillControls drill={drill} />

            {drill.isDrillActive && !drill.roundDone && !drill.isWordMode && drill.current && (
              <HangulLetterDrill drill={drill} {...(onOpenTutor ? { onOpenTutor } : {})} />
            )}

            {drill.isDrillActive && drill.isWordMode && !drill.roundDone && (
              <HangulWordDrill drill={drill} {...(onOpenTutor ? { onOpenTutor } : {})} />
            )}

            {drill.isDrillActive && drill.roundDone && (
              <HangulReport
                accuracy={drill.accuracy}
                answered={drill.drillAnswered}
                correct={drill.drillCorrect}
                isWordMode={drill.isWordMode}
                writeFailed={drill.writeFailed}
                onRestart={drill.startDrill}
                onExit={drill.stopDrill}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
