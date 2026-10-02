import { useAgentModelsQuery } from '../../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

export function ExerciseModelSettings() {
  const models = useAgentModelsQuery(), preferences = usePreferencesStore();
  const selected = models.data?.find(model => (model.id || model.model) === preferences.coachModelId);
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft p-4">
    <span className="text-sm text-ink-muted">主观题 AI 批改</span>
    <Select value={preferences.coachModelId || null} onValueChange={value => preferences.setCoachModelId(value ?? '')}>
      <SelectTrigger className="w-64" aria-label="批改模型"><SelectValue placeholder="选择批改模型" /></SelectTrigger>
      <SelectContent>{models.data?.map(model => <SelectItem key={model.id || model.model} value={model.id || model.model}>{model.displayName || model.model}</SelectItem>)}</SelectContent>
    </Select>
    {!!selected?.supportedReasoningEfforts?.length && <Select value={preferences.coachEffort || null} onValueChange={value => preferences.setCoachEffort(value ?? '')}>
      <SelectTrigger className="w-40" aria-label="批改思考等级"><SelectValue placeholder="思考等级" /></SelectTrigger>
      <SelectContent>{selected.supportedReasoningEfforts.map(effort => <SelectItem key={effort} value={effort}>{effort}</SelectItem>)}</SelectContent>
    </Select>}
    <span className="text-xs text-ink-muted">沿用学习助手偏好；点击批改才调用模型。</span>
  </div>;
}
