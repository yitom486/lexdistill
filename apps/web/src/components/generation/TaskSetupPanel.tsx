import { useMemo, useState } from 'react';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { useTtsStore } from '../../stores/useTtsStore.js';
import { PresetAdjustPanel } from './PresetAdjustPanel.js';
import { useCreateGenerationTaskMutation, useGenerationPresetsQuery, useGenerationSuggestionQuery,
  useResolvePresetMutation, useStartGenerationRunMutation } from '../../queries/generation.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';

export const GENERATION_LEVELS: Record<TrackLanguage, string[]> = {
  ja: ['N5', 'N4', 'N3', 'N2', 'N1'],
  en: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  ko: ['TOPIK_1', 'TOPIK_2', 'TOPIK_3', 'TOPIK_4', 'TOPIK_5', 'TOPIK_6'],
};

const DEFAULT_LEVEL: Record<TrackLanguage, string> = { ja: 'N5', en: 'A1', ko: 'TOPIK_1' };

function newHostTurn(): { sessionId: string; turnId: string } {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return { sessionId: `ui-session-${stamp}-${rand}`, turnId: `ui-turn-${stamp}-${rand}` };
}

/**
 * 出题任务创建面板：预设＋等级＋模型＋语音，预算由后端计算验证。
 * 智能建议仅供确认，不擅自生效。
 */
export function TaskSetupPanel({ userId, track, onStarted }: {
  userId: string; track: TrackLanguage; onStarted: (taskId: string) => void;
}) {
  const presetsQuery = useGenerationPresetsQuery();
  const presets = useMemo(() => presetsQuery.data ?? [], [presetsQuery.data]);
  const [presetId, setPresetId] = useState('comprehensive');
  const [level, setLevel] = useState(DEFAULT_LEVEL[track]);
  const [model, setModel] = useState('');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [modes, setModes] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const modelsQuery = useAgentModelsQuery();
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const suggestion = useGenerationSuggestionQuery(userId, track);
  const preferredService = useTtsStore(s => s.preferredService);
  const ttsModelId = useTtsStore(s => s.modelId);
  const voiceMale = useTtsStore(s => s.voiceIdMale);
  const voiceFemale = useTtsStore(s => s.voiceIdFemale);
  const rate = useTtsStore(s => s.rate);
  const resolvePreset = useResolvePresetMutation();
  const createTask = useCreateGenerationTaskMutation(userId);
  const startRun = useStartGenerationRunMutation(userId);
  const busy = resolvePreset.isPending || createTask.isPending || startRun.isPending;
  const preset = presets.find(p => p.id === presetId);
  const activeCounts = counts ?? preset?.categoryCounts ?? {};
  const activeModes = modes ?? preset?.listeningModes ?? { DIALOGUE: 0, PASSAGE: 0, NEWS: 0 };
  const totalItems = Object.values(activeCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const listeningCount = activeCounts['LISTENING'] ?? 0;
  const voicesReady = listeningCount === 0 || Boolean(voiceMale && voiceFemale && preferredService && ttsModelId);

  const start = async () => {
    setError(null);
    try {
      const chosenModel = model || models[0]?.id || models[0]?.model || '';
      if (!chosenModel) throw new Error('暂无可用出题模型，请检查本机模型配置。');
      if (!voicesReady) throw new Error('听力需要语音偏好中的服务、模型与男女声：请先在语音设置中配置。');
      const resolved = await resolvePreset.mutateAsync({
        presetId, language: track, targetLevel: level, modelId: chosenModel,
        ...(listeningCount > 0 ? { audio: { providerId: preferredService, modelId: ttsModelId,
          maleVoice: voiceMale, femaleVoice: voiceFemale, narratorVoice: voiceMale, speed: rate || 1, timeoutMs: 60000 } } : {}),
        categoryCounts: activeCounts, listeningModes: listeningCount > 0 ? activeModes : undefined,
      });
      const { sessionId, turnId } = newHostTurn();
      const created = await createTask.mutateAsync({ sessionId, turnId,
        config: resolved.config, blueprint: resolved.blueprint, objective: resolved.objective });
      await startRun.mutateAsync(created.taskId);
      onStarted(created.taskId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '启动出题失败');
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      {suggestion.data && !suggestionApplied && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3" aria-label="出题建议">
          <ul className="space-y-1 text-xs leading-5 text-ink-muted">
            {suggestion.data.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
          <Button variant="outline" aria-label="应用建议" disabled={busy} onClick={() => {
            setPresetId(suggestion.data.presetId);
            setLevel(suggestion.data.targetLevel);
            setCounts(null);
            setModes(null);
            setSuggestionApplied(true);
          }}>应用建议</Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-2 text-sm text-ink">预设
          <Select value={presetId} onValueChange={value => { if (value) { setPresetId(value); setCounts(null); setModes(null); } }} disabled={busy}>
            <SelectTrigger aria-label="出题预设"><SelectValue>{preset?.name ?? presetId}</SelectValue></SelectTrigger>
            <SelectContent>{presets.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="space-y-2 text-sm text-ink">目标等级
          <Select value={level} onValueChange={value => { if (value) setLevel(value); }} disabled={busy}>
            <SelectTrigger aria-label="目标等级"><SelectValue>{level}</SelectValue></SelectTrigger>
            <SelectContent>{GENERATION_LEVELS[track].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="space-y-2 text-sm text-ink">出题模型
          <Select value={model || '__default__'} onValueChange={value => value && setModel(value === '__default__' ? '' : value)} disabled={busy || modelsQuery.isPending}>
            <SelectTrigger aria-label="出题模型"><SelectValue>{model || models[0]?.displayName || models[0]?.model || '选择模型'}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="__default__">自动选择</SelectItem>
              {models.map(item => <SelectItem key={item.id || item.model} value={item.id || item.model}>{item.displayName || item.model}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </div>
      <p className="text-xs leading-5 text-ink-muted">
        {preset?.description}最多新生成 {totalItems} 题（题库复用时实际更少），最终试卷固定 {totalItems} 题。
        {listeningCount > 0 && (voicesReady
          ? `听力使用语音偏好：男声 ${voiceMale} / 女声 ${voiceFemale} / 旁白 ${voiceMale}（默认同男声），服务 ${preferredService}。`
          : '听力需要语音偏好中的服务、模型与男女声：请先在语音设置中配置。')}
      </p>
      <PresetAdjustPanel counts={activeCounts} modes={activeModes}
        onCounts={setCounts} onModes={setModes} disabled={busy} />
      {(error || resolvePreset.isError || createTask.isError || startRun.isError) && (
        <p role="alert" className="text-xs leading-5 text-ink-rose-600">
          {error || (resolvePreset.error as Error | null)?.message || (createTask.error as Error | null)?.message || (startRun.error as Error | null)?.message}
        </p>
      )}
      {presetsQuery.isError && <p role="alert" className="text-xs text-ink-rose-600">{presetsQuery.error.message}</p>}
      <Button onClick={() => void start()} disabled={busy || modelsQuery.isPending || !preset} aria-label="开始出题">
        {busy ? '正在启动…' : modelsQuery.isPending ? '模型加载中…' : '开始出题'}
      </Button>
    </div>
  );
}
