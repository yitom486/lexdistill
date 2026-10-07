const CATEGORIES = ['VOCABULARY', 'GRAMMAR', 'READING', 'CLOZE', 'LISTENING', 'WRITING'] as const;
const MODES = ['DIALOGUE', 'PASSAGE', 'NEWS'] as const;

/**
 * 预设微调：题型数量与听力形式，精确和以后端校验为准。
 * listeningModes 之和必须等于 LISTENING，否则 resolve 拒绝。
 */
export function PresetAdjustPanel({ counts, modes, onCounts, onModes, disabled }: {
  counts: Record<string, number>; modes: Record<string, number>;
  onCounts: (next: Record<string, number>) => void; onModes: (next: Record<string, number>) => void;
  disabled: boolean;
}) {
  const setCount = (key: string, value: string) => {
    const parsed = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
    onCounts({ ...counts, [key]: parsed });
  };
  const setMode = (key: string, value: string) => {
    const parsed = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
    onModes({ ...modes, [key]: parsed });
  };
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold text-ink">自定义题量（精确和由后端校验）</p>
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map(key => (
          <label key={key} className="space-y-1 text-xs text-ink">{key}
            <input aria-label={`题量 ${key}`} type="number" min={0} max={100} value={counts[key] ?? 0}
              onChange={event => setCount(key, event.target.value)} disabled={disabled}
              className="block w-full rounded-lg border border-line bg-surface p-2 text-ink" />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(key => (
          <label key={key} className="space-y-1 text-xs text-ink">{key}
            <input aria-label={`听力 ${key}`} type="number" min={0} max={100} value={modes[key] ?? 0}
              onChange={event => setMode(key, event.target.value)} disabled={disabled}
              className="block w-full rounded-lg border border-line bg-surface p-2 text-ink" />
          </label>
        ))}
      </div>
    </div>
  );
}
