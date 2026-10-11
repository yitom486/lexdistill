import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useExtractTocWithLlmMutation } from '../../queries/useLearnerQueries.js';
import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { nextManualKey } from '../../lib/toc-confirm-flow.js';
import {
  validateTocCandidates,
  tocCandidatesFromEntries,
  changeTocCandidateLevel,
  changeTocCandidateType,
  type TocRecognitionCandidate,
} from '../../lib/toc-recognition.js';
import { sound } from '../../utils/audio.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';

export interface TocRecognitionPanelProps {
  userId?: string | undefined;
  traceId?: string | undefined;
  file: File | null;
  filePath: string;
  initialEntries?: TocRecognitionCandidate[] | undefined;
  existingDocInfo?: {
    documentId: string;
    title: string;
    lessonCount: number;
  } | undefined;
  onTocConfirmed?: ((entries: TocRecognitionCandidate[]) => void | Promise<void>) | undefined;
  confirmPending?: boolean;
  onTocInvalidated?: (() => void) | undefined;
}

export function useTocRecognition({
  userId = DEFAULT_USER_ID,
  traceId,
  file,
  filePath,
  initialEntries,
  existingDocInfo,
  onTocConfirmed,
  confirmPending = false,
  onTocInvalidated,
}: TocRecognitionPanelProps) {
  const extractLlm = useExtractTocWithLlmMutation(userId);
  const [lastExtractedCount, setLastExtractedCount] = useState<number | null>(null);
  const [extractionStartedAt, setExtractionStartedAt] = useState<number | null>(null);
  const modelsQuery = useAgentModelsQuery();
  const models = modelsQuery.data ?? [];
  const tocReviewRuntimeId = usePreferencesStore((s) => s.tocReviewRuntimeId);
  const setTocReviewRuntimeId = usePreferencesStore((s) => s.setTocReviewRuntimeId);
  const globalRuntimeId = usePreferencesStore((s) => s.agentRuntimeId);
  const effectiveRuntimeId = tocReviewRuntimeId || globalRuntimeId || 'codex-acp';
  const runtimeModels = usePreferencesStore((s) => s.runtimeModels);
  const runtimeEfforts = usePreferencesStore((s) => s.runtimeEfforts);
  const rawTocReviewModel = usePreferencesStore((s) => s.tocReviewModel);
  const setTocReviewModel = usePreferencesStore((s) => s.setTocReviewModel);
  const rawTocReviewEffort = usePreferencesStore((s) => s.tocReviewEffort);
  const setTocReviewEffort = usePreferencesStore((s) => s.setTocReviewEffort);

  // 跨运行时模型隔离：若当前运行时在 preferences 字典中有记录则以该记录为准；
  // 若无记录且当前非 codex-acp，杜绝将历史残留的 codex-acp 模型（如 gpt-6.1-sol）跨运行时错误下发。
  const scopedModel = runtimeModels[effectiveRuntimeId];
  const tocReviewModel = scopedModel !== undefined
    ? scopedModel
    : (effectiveRuntimeId === 'codex-acp' ? rawTocReviewModel : '');
  const scopedEffort = runtimeEfforts[effectiveRuntimeId];
  const tocReviewEffort = scopedEffort !== undefined
    ? scopedEffort
    : (effectiveRuntimeId === 'codex-acp' ? rawTocReviewEffort : '');

  const effectiveTocReviewModel = tocReviewModel || '__default__';
  const effectiveTocReviewEffort = tocReviewEffort || '__default__';
  const runtimeCaps = useSelectedRuntimeCaps(effectiveRuntimeId);
  const isKnownModel = models.some(
    (m) => (m.id && m.id === tocReviewModel) || (m.model && m.model === tocReviewModel)
  );

  useEffect(() => {
    // 仅 Codex 目录权威时自动清掉未知 id；ACP 探针归属以后端 400 为准，不在此误删有效选择。
    if (!runtimeCaps.supportsModelPicker) return;
    if (tocReviewModel && models.length > 0 && !isKnownModel) {
      setTocReviewModel('');
    }
  }, [tocReviewModel, models.length, isKnownModel, setTocReviewModel, runtimeCaps.supportsModelPicker]);

  const hasInitial = Boolean(initialEntries && initialEntries.length > 0);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [identifiedTocEnd, setIdentifiedTocEnd] = useState<number>();
  const [entries, setEntries] = useState<TocRecognitionCandidate[]>(() => initialEntries ?? []);
  const [scanned, setScanned] = useState(hasInitial);
  const [confirmed, setConfirmed] = useState(hasInitial);
  const [message, setMessage] = useState<string | null>(null);

  // 当外部 initialEntries 传入或发生变动时同步（如一键载入已存大纲）
  useEffect(() => {
    if (initialEntries && initialEntries.length > 0) {
      setEntries(initialEntries);
      setScanned(true);
      setConfirmed(true);
    }
  }, [initialEntries]);

  const hasSource = Boolean(file || filePath.trim());

  const clearScan = () => {
    setIdentifiedTocEnd(undefined);
    onTocInvalidated?.();
    setEntries([]);
    setScanned(false);
    setConfirmed(false);
    setMessage(null);
  };

  const invalidate = () => {
    onTocInvalidated?.();
    setConfirmed(false);
    setMessage(null);
  };

  const updateEntry = (key: string, patch: Partial<TocRecognitionCandidate>) => {
    setEntries((previous) => previous.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
    invalidate();
  };

  const useDefaultRange = () => { setStart(''); setEnd(''); clearScan(); };

  /**
   * 阶段二：由大模型对确定的目次页进行深度语义解析与结构化提取
   */
  const handleLlmExtractToc = () => {
    if (!hasSource || extractLlm.isPending) return;
    const startPage = Number(start.trim());
    const endPage = Number(end.trim());

    const hasRange = Boolean(start.trim() || end.trim());
    if (hasRange && (!start.trim() || !end.trim() || !Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) || startPage < 1 || endPage < startPage)) {
      setMessage('请填写完整、递增的正整数页码范围；留空时使用前 30 页'); sound.playMistake(); return;
    }

    sound.playClick();
    clearScan();
    setLastExtractedCount(null);
    setExtractionStartedAt(Date.now());

    const vars = {
      ...(file ? { file } : { filePath: filePath.trim() }),
      ...(traceId ? { traceId } : {}),
      ...(hasRange ? { startPage, endPage } : {}),
      ...(effectiveTocReviewModel !== '__default__' ? { model: effectiveTocReviewModel } : {}),
      ...(tocReviewEffort ? { effort: tocReviewEffort } : {}),
      // 教材目录 lane 跟随所选运行时（缺席走 Codex 原通路）。
      ...(effectiveRuntimeId ? { runtimeId: effectiveRuntimeId } : {}),
    };

    extractLlm.mutate(vars, {
      onSuccess: (data) => {
        sound.playCorrect();
        if (!data.entries || data.entries.length === 0) {
          setMessage('大模型在该页码范围内未识别出有效课次条目，请核实页码是否准确');
          sound.playMistake();
          return;
        }

        const candidates = tocCandidatesFromEntries(data.entries, 'printed').map(entry => data.pageOffset !== undefined ? { ...entry, physicalPage: Number(entry.printedPage) + data.pageOffset } : entry);
        setIdentifiedTocEnd(data.tocEndPage);

        setEntries(candidates);
        setScanned(true);
        setLastExtractedCount(candidates.length);
        toast.success(`大模型成功识别出 ${candidates.length} 条规范课次大纲！`);
      },
      onError: (err) => {
        setMessage(err instanceof Error ? err.message : '大模型提炼目录失败，请检查页码范围后重试');
        sound.playMistake();
      },
    });
  };

  const confirm = async () => {
    const error = validateTocCandidates(entries);
    if (error) {
      setMessage(error);
      sound.playMistake();
      return;
    }
    setMessage(null);
    const tocEndPage = identifiedTocEnd ?? Number(end);
    // 用户指定的默认规则：正文紧接目录，印刷页从 1 开始；偏移取本次目录结束页。
    const defaultEntries = Number.isSafeInteger(tocEndPage) && tocEndPage > 0
      ? entries.map(entry => entry.physicalPage !== undefined ? entry : {
          ...entry, physicalPage: Number(entry.printedPage) + tocEndPage,
        })
      : entries;
    try {
      await onTocConfirmed?.(defaultEntries);
      setEntries(defaultEntries); setConfirmed(true); sound.playCorrect();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '目录保存失败，请重试'); sound.playMistake();
    }
  };

  const changeLevel = (key: string, level: number) => {
    setEntries(previous => changeTocCandidateLevel(previous, key, level)); invalidate();
  };
  const changeType = (key: string, type: 'unit' | 'lesson' | 'section') => {
    setEntries(previous => changeTocCandidateType(previous, key, type)); invalidate();
  };
  const removeEntry = (key: string) => { setEntries(previous => previous.filter(entry => entry.key !== key)); invalidate(); };
  const addEntry = () => {
    setEntries(previous => [...previous, { key: nextManualKey(previous), title: '', printedPage: '', kind: 'lesson', level: 1, confidence: null }]); invalidate();
  };
  return { start, end, setStart, setEnd, entries, scanned, confirmed, message, tocReviewEffort, setTocReviewEffort,
    extractLlm, models, effectiveTocReviewModel, setTocReviewModel, hasSource, clearScan,
    useDefaultRange, handleLlmExtractToc, confirm, updateEntry, changeLevel, changeType, removeEntry, addEntry,
    userId, traceId, lastExtractedCount, extractionStartedAt, isExtracting: extractLlm.isPending,
    tocReviewRuntimeId: effectiveRuntimeId, setTocReviewRuntimeId };
}
