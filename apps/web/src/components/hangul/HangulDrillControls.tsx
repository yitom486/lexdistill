import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { ShimmerButton } from '../magicui/index.js';
import { DRILL_COUNTS, DRILL_MODE_LABELS, drillCountLabel, type DrillMode } from './hangul-drill.js';
import type { HangulDrill } from './useHangulDrill.js';

interface DrillControlsProps {
  drill: HangulDrill;
}

/** 自测模式与题量选择（成熟 Select + 明确标签；原生 select 已替换）。 */
export function HangulDrillControls({ drill }: DrillControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium" id="hangul-mode-label">自测模式</span>
      <Select value={drill.drillMode} onValueChange={(v) => v && drill.switchDrillMode(v as DrillMode)}>
        <SelectTrigger className="w-[9rem]" aria-labelledby="hangul-mode-label" aria-label="自测模式">
          <SelectValue>{DRILL_MODE_LABELS[drill.drillMode]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DRILL_MODE_LABELS) as DrillMode[]).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {DRILL_MODE_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm font-medium ml-2" id="hangul-count-label">题量</span>
      <Select value={String(drill.drillCount)} onValueChange={(v) => v && drill.setDrillCount(Number(v))}>
        <SelectTrigger className="w-[7rem]" aria-labelledby="hangul-count-label" aria-label="题量">
          <SelectValue>{drillCountLabel(drill.drillCount)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DRILL_COUNTS.map((c) => (
            <SelectItem key={c} value={String(c)}>
              {drillCountLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!drill.isDrillActive ? (
        <ShimmerButton onClick={drill.startDrill}>开始自测（跟随当前选项卡题池）</ShimmerButton>
      ) : (
        <Button variant="outline" size="sm" onClick={drill.stopDrill}>
          结束自测
        </Button>
      )}
      {drill.isDrillActive && (
        <Badge variant="secondary">
          {drill.drillAnswered} 答 · {drill.drillCorrect} 对
        </Badge>
      )}
    </div>
  );
}
