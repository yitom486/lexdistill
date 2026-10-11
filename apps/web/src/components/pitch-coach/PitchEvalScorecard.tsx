import { motion } from 'framer-motion';
import type { PitchEvalResult } from './usePitchRecorder.js';

interface PitchEvalScorecardProps {
  result: PitchEvalResult;
}

/**
 * 声调评测报告：沉稳的语言学发音报告（音高吻合度 / 节拍流畅度 / 走势诊断）。
 * 分数克制呈现，不做玩具式大号打分与轻佻文案。
 */
export function PitchEvalScorecard({ result }: PitchEvalScorecardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="surface-card rounded-xl p-4 space-y-3"
      role="status"
      aria-label="声调评测报告"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink-faint-soft">
          声调评测报告
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold font-mono text-ink tracking-tight">
            {result.score}
          </span>
          <span className="text-xs text-ink-faint-soft font-mono">/ 100</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 rounded-lg bg-surface-coal/60 border border-line-hairline flex justify-between gap-2">
          <span className="text-ink-faint-soft">音高吻合度</span>
          <span className="font-bold font-mono text-ink">{result.pitchMatch}%</span>
        </div>
        <div className="p-2 rounded-lg bg-surface-coal/60 border border-line-hairline flex justify-between gap-2">
          <span className="text-ink-faint-soft">节拍流畅度</span>
          <span className="font-bold font-mono text-ink">{result.fluency}%</span>
        </div>
      </div>

      <p className="text-xs text-ink-faint-soft leading-relaxed font-serif">
        {result.comment}
      </p>
    </motion.div>
  );
}
