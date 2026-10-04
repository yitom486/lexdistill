import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useMapPdfMutation, useExtractTocWithLlmMutation } from '../../queries/useLearnerQueries.js';
import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import type { PdfAzureCredential } from '../../queries/textbooks-annotations.js';
import { nextManualKey } from '../../lib/toc-confirm-flow.js';
import {
  validateTocCandidates,
  tocCandidatesFromEntries,
  changeTocCandidateLevel,
  type TocRecognitionCandidate,
} from '../../lib/toc-recognition.js';
import { sound } from '../../utils/audio.js';

export interface TocDetectedCandidate {
  fromPage: number;
  toPage: number;
  score: number;
  reasons?: string[];
}

export interface TocRecognitionPanelProps {
  traceId?: string;
  file: File | null;
  filePath: string;
  azure?: PdfAzureCredential | undefined;
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
  traceId,
  file,
  filePath,
  azure,
  initialEntries,
  existingDocInfo,
  onTocConfirmed,
  confirmPending = false,
  onTocInvalidated,
}: TocRecognitionPanelProps) {
  const map = useMapPdfMutation();
  const extractLlm = useExtractTocWithLlmMutation();
  const modelsQuery = useAgentModelsQuery();
  const models = modelsQuery.data ?? [];
  const tocReviewModel = usePreferencesStore((s) => s.tocReviewModel);
  const setTocReviewModel = usePreferencesStore((s) => s.setTocReviewModel);

  const isKnownModel = models.some(
    (m) => (m.id && m.id === tocReviewModel) || (m.model && m.model === tocReviewModel)
  );
  const effectiveTocReviewModel = isKnownModel ? tocReviewModel : '__default__';

  useEffect(() => {
    if (tocReviewModel && models.length > 0 && !isKnownModel) {
      setTocReviewModel('');
    }
  }, [tocReviewModel, models.length, isKnownModel, setTocReviewModel]);

  const hasInitial = Boolean(initialEntries && initialEntries.length > 0);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [entries, setEntries] = useState<TocRecognitionCandidate[]>(() => initialEntries ?? []);
  const [scanned, setScanned] = useState(hasInitial);
  const [confirmed, setConfirmed] = useState(hasInitial);
  const [message, setMessage] = useState<string | null>(null);
  const [detectedHint, setDetectedHint] = useState<string | null>(null);
  const [discoveredCandidates, setDiscoveredCandidates] = useState<TocDetectedCandidate[]>([]);
  const autoProbedRef = useRef(hasInitial);

  // 当外部 initialEntries 传入或发生变动时同步（如一键载入已存大纲）
  useEffect(() => {
    if (initialEntries && initialEntries.length > 0) {
      setEntries(initialEntries);
      setScanned(true);
      setConfirmed(true);
      autoProbedRef.current = true;
    }
  }, [initialEntries]);

  const hasSource = Boolean(file || filePath.trim());

  const clearScan = () => {
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

  /**
   * 阶段一：向后端 Gateway 发起结构探测
   * 领域分析（书签提取、OCR 特征加权、跨页聚合）100% 由后端闭环完成，前端仅接收标准契约并组合呈现。
   */
  const handleProbeTocLocation = () => {
    if (!hasSource || map.isPending) return;
    sound.playClick();
    setMessage(null);
    setDetectedHint(null);

    const vars = file
      ? {
          file,
          ...(azure ? { azure } : {}),
        }
      : {
          filePath: filePath.trim(),
          ...(azure ? { azure } : {}),
        };

    map.mutate({ ...vars, ...(traceId ? { traceId } : {}) }, {
      onSuccess: (result) => {
        sound.playCorrect();
        if (result.detectedTocRange) {
          const { startPage, endPage, reason, candidates = [] } = result.detectedTocRange;
          setStart(String(startPage));
          setEnd(String(endPage));
          const list = candidates.length > 0 ? candidates : [{ fromPage: startPage, toPage: endPage, score: 10, reasons: [reason] }];
          setDiscoveredCandidates(list);
          const hint = `💡 推荐第 ${startPage}–${endPage} 页（${reason}）`;
          setDetectedHint(hint);
          toast.success(hint);
          return;
        }

        setDiscoveredCandidates([]);
        const hint = '前 30 页未自动识别出明确目次区间，请翻看教材后手动输入目录所在页码';
        setDetectedHint(hint);
        toast.info(hint);
      },
      onError: (err) => {
        setMessage(err instanceof Error ? err.message : 'OCR 探测失败，请直接手动填写目录所在页码');
        sound.playMistake();
      },
    });
  };

  // 仅在无已有大纲且未曾探测过时才自动触发后端探测，绝不强刷已有大纲
  useEffect(() => {
    if (
      hasSource &&
      !start &&
      !map.isPending &&
      !autoProbedRef.current &&
      (!initialEntries || initialEntries.length === 0)
    ) {
      autoProbedRef.current = true;
      handleProbeTocLocation();
    }
  }, [hasSource, initialEntries]);

  /**
   * 阶段二：由大模型对确定的目次页进行深度语义解析与结构化提取
   */
  const handleLlmExtractToc = () => {
    if (!hasSource || extractLlm.isPending) return;
    const startPage = Number(start.trim());
    const endPage = Number(end.trim());

    if (!start.trim() || !end.trim() || !Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage)) {
      setMessage('请先填写目录（目次）所在的起始页与结束页（如第 6 至 8 页）');
      sound.playMistake();
      return;
    }

    if (startPage < 1 || endPage < startPage) {
      setMessage('目录起始页与结束页必须为递增的正整数');
      sound.playMistake();
      return;
    }

    if (endPage - startPage + 1 > 8) {
      setMessage('一次最多识别 8 张目录页图片，请缩小范围');
      sound.playMistake();
      return;
    }

    sound.playClick();
    clearScan();

    const vars = {
      ...(file ? { file } : { filePath: filePath.trim() }),
      ...(traceId ? { traceId } : {}),
      startPage,
      endPage,
      ...(effectiveTocReviewModel !== '__default__' ? { model: effectiveTocReviewModel } : {}),
    };

    extractLlm.mutate(vars, {
      onSuccess: (data) => {
        sound.playCorrect();
        if (!data.entries || data.entries.length === 0) {
          setMessage('大模型在该页码范围内未识别出有效课次条目，请核实页码是否准确');
          sound.playMistake();
          return;
        }

        const candidates = tocCandidatesFromEntries(data.entries, 'printed');

        setEntries(candidates);
        setScanned(true);
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
    const tocEndPage = Number(end);
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

  const changeLevel = (key: string, level: 1 | 2) => {
    setEntries(previous => changeTocCandidateLevel(previous, key, level)); invalidate();
  };
  const removeEntry = (key: string) => { setEntries(previous => previous.filter(entry => entry.key !== key)); invalidate(); };
  const addEntry = () => {
    setEntries(previous => [...previous, { key: nextManualKey(previous), title: '', printedPage: '', kind: 'lesson', level: 1, confidence: null }]); invalidate();
  };
  return { start, end, setStart, setEnd, entries, scanned, confirmed, message, detectedHint, discoveredCandidates,
    map, extractLlm, models, effectiveTocReviewModel, setTocReviewModel, hasSource, clearScan,
    handleProbeTocLocation, handleLlmExtractToc, confirm, updateEntry, changeLevel, removeEntry, addEntry };
}
