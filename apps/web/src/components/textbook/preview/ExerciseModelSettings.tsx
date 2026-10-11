import { useAgentRuntimeOptionsQuery } from '../../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

export function ExerciseModelSettings() {
  const preferences = usePreferencesStore();
  // 模型/档位一律走当前运行时的探针目录（旧 model/list 已退役）。
  const runtimeOptions = useAgentRuntimeOptionsQuery(preferences.agentRuntimeId || 'codex-acp', true);
  const models = runtimeOptions.data?.models ?? [];
  const efforts = runtimeOptions.data?.efforts ?? [];
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft p-4">
    <span className="text-sm text-ink-muted">主观题 AI 批改</span>
    <Select value={preferences.coachModelId || null} onValueChange={value => preferences.setCoachModelId(value ?? '')}>
      <SelectTrigger className="w-64" aria-label="批改模型"><SelectValue placeholder="选择批改模型" /></SelectTrigger>
      <SelectContent>{models.map(model => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent>
    </Select>
    {!!efforts.length && <Select value={preferences.coachEffort || null} onValueChange={value => preferences.setCoachEffort(value ?? '')}>
      <SelectTrigger className="w-40" aria-label="批改思考等级"><SelectValue placeholder="思考等级" /></SelectTrigger>
      <SelectContent>{efforts.map(effort => <SelectItem key={effort} value={effort}>{effort}</SelectItem>)}</SelectContent>
    </Select>}
    <span className="text-xs text-ink-muted">沿用学习助手偏好；点击批改才调用模型。</span>
  </div>;
}
