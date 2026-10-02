import { useState, useEffect, useRef } from 'react';
import { Sparkles, ScanText, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@study-studio/shared';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
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

interface TocRecognitionPanelProps {
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

export function TocRecognitionPanel({
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

  return (
    <div className="space-y-3 text-xs text-ink">
      {/* 若检测到已有教材大纲，展示复用提示条 */}
      {existingDocInfo && (
        <div className="p-3.5 rounded-2xl bg-wash-emerald-500o10 border border-tone-emerald-600o30 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-ink-emerald-700-emerald-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink">
                  已自动载入本地数据库大纲（《{existingDocInfo.title}》）
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-line font-medium text-ink">
                  共 {existingDocInfo.lessonCount} 课
                </span>
              </div>
              <p className="text-[11px] text-ink-ghost mt-0.5">
                该教材的大纲与课次结构已在数据库中就绪，可直接核对下方草稿推进至下一步；若确需重扫，可点击右侧按钮重新提取。
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={() => {
              sound.playClick();
              clearScan();
              handleProbeTocLocation();
            }}
            disabled={map.isPending || extractLlm.isPending}
          >
            <ScanText className="w-3.5 h-3.5" />
            重新扫描大纲
          </Button>
        </div>
      )}

      {/* 目录页码定位与提取 */}
      <div className="p-3.5 rounded-2xl border border-line bg-surface space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink">目次所在页码：</span>
            <div className="flex items-center gap-1.5">
              <input
                aria-label="目录起始页"
                inputMode="numeric"
                value={start}
                disabled={extractLlm.isPending || map.isPending}
                onChange={(e) => {
                  setStart(e.target.value);
                  clearScan();
                }}
                placeholder="起始页"
                className="h-8 w-16 rounded-xl border border-line bg-surface px-2 text-ink text-center font-mono outline-none focus:border-line-accent"
              />
              <span className="text-ink-ghost">–</span>
              <input
                aria-label="目录结束页"
                inputMode="numeric"
                value={end}
                disabled={extractLlm.isPending || map.isPending}
                onChange={(e) => {
                  setEnd(e.target.value);
                  clearScan();
                }}
                placeholder="结束页"
                className="h-8 w-16 rounded-xl border border-line bg-surface px-2 text-ink text-center font-mono outline-none focus:border-line-accent"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted">
              <Zap className="w-3.5 h-3.5 text-ink-amber-500" />
              <span className="text-[11px] text-ink-ghost">提炼模型:</span>
              <Select
                value={effectiveTocReviewModel}
                onValueChange={(val: string | null) => setTocReviewModel(!val || val === '__default__' ? '' : val)}
              >
                <SelectTrigger className="h-7 w-44 border-0 bg-transparent px-1 text-xs focus:ring-0">
                  <SelectValue placeholder="本机 Codex 默认模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">⚡ 本机 Codex 默认模型</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id || m.model} value={m.id || m.model}>
                      {m.displayName || m.model}
                      {m.isDefault ? '（本机默认）' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!hasSource || map.isPending || extractLlm.isPending}
              onClick={handleProbeTocLocation}
              className="gap-1.5 text-xs"
            >
              <ScanText className="w-3.5 h-3.5" />
              {map.isPending ? '后端分析中…' : '重新探测目录'}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!hasSource || !start.trim() || !end.trim() || extractLlm.isPending}
              onClick={handleLlmExtractToc}
              className="gap-1.5 text-xs shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {extractLlm.isPending ? '大模型提炼目录中…' : '大模型智能提炼目录'}
            </Button>
          </div>
        </div>

        {discoveredCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-ink-ghost">候选项：</span>
            {discoveredCandidates.map((c, idx) => {
              const isSelected = start === String(c.fromPage) && end === String(c.toPage);
              return (
                <button
                  key={`${c.fromPage}-${c.toPage}`}
                  type="button"
                  onClick={() => {
                    setStart(String(c.fromPage));
                    setEnd(String(c.toPage));
                    clearScan();
                  }}
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono transition-colors border ${
                    isSelected
                      ? 'border-line-accent bg-wash-amber-500o10 text-ink font-semibold'
                      : 'border-line bg-surface text-ink-muted hover:text-ink hover:bg-surface-ash'
                  }`}
                >
                  第 {c.fromPage}–{c.toPage} 页{idx === 0 ? ' (推荐)' : ''}
                </button>
              );
            })}
          </div>
        )}

        {detectedHint && (
          <p className="text-[11px] text-ink-muted font-medium">
            {detectedHint}
          </p>
        )}
      </div>

      {message && (
        <div className="p-3 rounded-xl bg-wash-amber-500o10 border border-line-accent flex items-center gap-2 text-ink-amber-800-amber-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* 第二阶段：展示大模型识别出的结构化条目与人工核对 */}
      {scanned && (
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-ink flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-ink-emerald-700-emerald-400" />
              2. 核对大模型提取的课次大纲（共 {entries.length} 条）：
            </p>
            <span className="text-[11px] text-ink-ghost">
              支持人工微调课名、印刷页码或调整类型
            </span>
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {entries.map((entry, index) => {
              const isSubItem = entry.level === 2;
              return (
                <div
                  key={entry.key}
                  className={`grid grid-cols-1 gap-1.5 rounded-xl border p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_auto] sm:items-center shadow-2xs transition-colors ${
                    isSubItem
                      ? 'ml-3 sm:ml-6 border-line-soft bg-surface-ash border-l-2 border-l-line-accent'
                      : 'border-line bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isSubItem ? (
                      <span className="text-ink-ghost text-xs shrink-0 select-none pl-0.5">↳</span>
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-tone-amber-500 shrink-0 ml-1 select-none" />
                    )}
                    <input
                      aria-label={`目录标题 ${index + 1}`}
                      value={entry.title}
                      onChange={(e) => updateEntry(entry.key, { title: e.target.value })}
                      className={`h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-ink text-xs outline-none focus:border-line-accent ${
                        isSubItem ? 'font-normal text-ink-soft' : 'font-semibold'
                      }`}
                    />
                  </div>
                  <input
                    aria-label={`印刷页码 ${index + 1}`}
                    inputMode="numeric"
                    value={entry.printedPage}
                    onChange={(e) => updateEntry(entry.key, { printedPage: e.target.value })}
                    placeholder="印刷页"
                    className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-ink text-xs font-mono text-center outline-none focus:border-line-accent"
                  />
                  <Select
                    value={entry.directoryLevel ?? entry.kind}
                    onValueChange={(val) => {
                      if (val === 'unit' || val === 'chapter' || val === 'lesson' || val === 'section') updateEntry(entry.key, { kind: val === 'lesson' ? 'lesson' : 'section', directoryLevel: val });
                    }}
                  >
                    <SelectTrigger aria-label={`目录类型 ${index + 1}`} className="h-8 text-xs">
                      <SelectValue>{entry.directoryLevel === 'unit' ? '单元' : entry.directoryLevel === 'chapter' ? '章' : entry.kind === 'lesson' ? '成课' : '章节/复习'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unit">单元</SelectItem>
                      <SelectItem value="chapter">章</SelectItem>
                      <SelectItem value="lesson">成课</SelectItem>
                      <SelectItem value="section">章节/复习</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(entry.level)}
                    onValueChange={(val) => {
                      if (val === '1' || val === '2') {
                        setEntries(previous => changeTocCandidateLevel(previous, entry.key, val === '1' ? 1 : 2));
                        invalidate();
                      }
                    }}
                  >
                    <SelectTrigger aria-label={`目录层级 ${index + 1}`} className="h-8 text-xs">
                      <SelectValue>{entry.level === 1 ? '一级' : '子标题'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">一级</SelectItem>
                      <SelectItem value="2" disabled={!entries.slice(0, index).some(item => !item.parentId && item.level === 1)}>子标题</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEntries((previous) => previous.filter((item) => item.key !== entry.key));
                      invalidate();
                    }}
                    className="text-xs text-ink-rose-700-rose-400"
                  >
                    移除
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line-soft">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEntries((prev) => [
                  ...prev,
                  {
                    key: nextManualKey(prev),
                    title: '',
                    printedPage: '',
                    level: 1,
                    kind: 'lesson',
                    confidence: null,
                  },
                ]);
                invalidate();
              }}
              className="text-xs"
            >
              + 手动添加课次条目
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={entries.length === 0 || confirmed || confirmPending}
                onClick={confirm}
                className="gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {confirmPending ? '正在保存目录…' : confirmed ? `已核对 ${entries.length} 条目录` : '确认目录草稿'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
