import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button.js';
import { sound } from '../../utils/audio.js';
import { useStudySessionStore, type NavigationTab } from '../../stores/useStudySessionStore.js';

export interface NextStep {
  text: string;
  cta: string;
  tab: NavigationTab;
}

/**
 * 下一步行动条：只呈现有真实证据支撑的单个动作（错题 → 到期闪卡 → 首测 → 保持）。
 * 无依据时不渲染，不捏造薄弱项或推荐。
 */
export function NextStepStrip({ step }: { step: NextStep | null }) {
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  if (!step) return null;
  return (
    <div className="surface-card rounded-2xl p-4 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink-faint-soft">下一步</p>
        <p className="mt-1 text-sm font-semibold text-ink">{step.text}</p>
      </div>
      <Button
        size="sm"
        onClick={() => {
          sound.playClick();
          setActiveTab(step.tab);
        }}
        className="gap-1.5 shrink-0"
      >
        {step.cta}
        <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
