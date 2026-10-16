import { motion } from 'framer-motion';
import { Award } from 'lucide-react';
import { Button } from '../ui/button.js';
import { ShimmerButton } from '../magicui/index.js';

interface HangulReportProps {
  accuracy: number;
  answered: number;
  correct: number;
  isWordMode: boolean;
  /** 回写失败题数：>0 时如实说明，不宣称全部已回写 */
  writeFailed: number;
  onRestart: () => void;
  onExit: () => void;
}

/** 本轮战报（纯展示）：正确率与回写诚实说明。 */
export function HangulReport({ accuracy, answered, correct, isWordMode, writeFailed, onRestart, onExit }: HangulReportProps) {
  const unit = isWordMode ? '词' : '题';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2 py-4">
      <Award className="h-8 w-8 mx-auto text-accent-ink-warm" />
      <div className="text-lg font-semibold">本轮战报 · 正确率 {accuracy}%</div>
      <div className="text-sm text-ink-ghost">
        共 {answered} {unit} · 答对 {correct} {unit}
        {writeFailed > 0
          ? `（${writeFailed} ${unit}成绩回写失败，请检查网关后重练）`
          : '（已回写学情画像与打卡）'}
      </div>
      <div className="flex justify-center gap-2 pt-2">
        <ShimmerButton onClick={onRestart}>再来一轮</ShimmerButton>
        <Button variant="outline" onClick={onExit}>
          返回矩阵
        </Button>
      </div>
    </motion.div>
  );
}
