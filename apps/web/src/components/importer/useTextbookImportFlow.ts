import { useEffect, useMemo, useRef, useState } from 'react';
import { TextbookPipelineSettingsSchema, type TocEntry } from '@study-studio/document-model';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { getPlatform } from '../../platform/capabilities.js';
import { stripPdfPathQuotes } from '../../lib/pdf-upload-guard.js';
import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import {
  useTextbookImportInspectionQuery, useTextbookLessonSlotsQuery,
  lessonSlotsToTocCandidates, useImportDocumentMutation, useSaveTextbookOutlineMutation,
} from '../../queries/textbooks-annotations.js';
import { useStartPipelineJobMutation } from '../../queries/pipeline-jobs.js';
import { QUERY_KEYS } from '../../queries/query-keys.js';
import { usePipelineJobStore } from '../../stores/usePipelineJobStore.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';

export interface TextbookImportSource {
  pdfFile: File | null;
  pdfPath: string;
  setPdfFile: (file: File | null) => void;
  setPdfPath: (path: string) => void;
  docPath: string;
  setDocPath: (path: string) => void;
  docUrl: string;
  setDocUrl: (url: string) => void;
  setParseError: (error: string | null) => void;
  setDocNote: (note: string | null) => void;
}

export function useTextbookImportFlow(source: TextbookImportSource) {
  const path = stripPdfPathQuotes(source.pdfPath);
  const filename = path.split(/[/\\]/).pop() || source.pdfFile?.name || '';
  const sourceKey = path || (source.pdfFile ? `${source.pdfFile.name}:${source.pdfFile.size}:${source.pdfFile.lastModified}` : '');
  const activeJob = usePipelineJobStore((s) => s.activeJob);
  const traceId = useMemo(() => {
    const previous = usePipelineJobStore.getState().currentImportTrace;
    return previous?.sourceKey === sourceKey ? previous.traceId : crypto.randomUUID();
  }, [sourceKey]);
  useEffect(() => { if (sourceKey) usePipelineJobStore.getState().setImportTrace({ sourceKey, traceId }); }, [sourceKey, traceId]);
  const [step, setStep] = useState<1 | 2 | 3>(() => activeJob ? 3 : 1);
  const [entries, setEntries] = useState<TocRecognitionCandidate[] | null>(null);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [rescanOutline, setRescanOutline] = useState(false);
  const previousSource = useRef(sourceKey);
  const inspection = useTextbookImportInspectionQuery(path ? { filename, filePath: path } : undefined);
  const targetDocument = inspection.data?.matchedDocument;
  const displayDocument = targetDocument;
  const slots = useTextbookLessonSlotsQuery(targetDocument?.documentId ?? (!path ? activeJob?.documentId : undefined));
  const startMutation = useStartPipelineJobMutation();
  const outlineMutation = useSaveTextbookOutlineMutation();
  const documentMutation = useImportDocumentMutation();
  const queryClient = useQueryClient();
  const pipelineRuntimeId = usePreferencesStore((s) => s.pipelineRuntimeId);
  const globalRuntimeId = usePreferencesStore((s) => s.agentRuntimeId);
  const effectivePipelineRuntimeId = pipelineRuntimeId || globalRuntimeId || 'codex-acp';
  const runtimeModels = usePreferencesStore((s) => s.runtimeModels);
  const runtimeEfforts = usePreferencesStore((s) => s.runtimeEfforts);
  const rawPipelineModel = usePreferencesStore((s) => s.pipelineModel);
  const rawPipelineEffort = usePreferencesStore((s) => s.pipelineEffort);

  const scopedPipelineModel = runtimeModels[effectivePipelineRuntimeId];
  const pipelineModel = scopedPipelineModel !== undefined
    ? scopedPipelineModel
    : (effectivePipelineRuntimeId === 'codex-acp' ? rawPipelineModel : '');
  const scopedPipelineEffort = runtimeEfforts[effectivePipelineRuntimeId];
  const pipelineEffort = scopedPipelineEffort !== undefined
    ? scopedPipelineEffort
    : (effectivePipelineRuntimeId === 'codex-acp' ? rawPipelineEffort : '');
  const pipelinePoolSize = usePreferencesStore((s) => s.pipelinePoolSize);
  const pipelineSettings = usePreferencesStore((s) => s.pipelineSettings);
  const pipelineLanguage = usePreferencesStore((s) => s.pipelineLanguage);

  useEffect(() => {
    if (previousSource.current === sourceKey) return;
    previousSource.current = sourceKey;
    setEntries(null); setForceOverwrite(false); setRescanOutline(false); setStep(1);
  }, [sourceKey]);

  useEffect(() => {
    if (!rescanOutline && targetDocument?.outlineConfirmed && slots.data?.length) {
      setEntries(current => current ?? lessonSlotsToTocCandidates(slots.data!));
    }
  }, [rescanOutline, targetDocument?.documentId, targetDocument?.outlineConfirmed, slots.data]);

  const browse = async () => {
    try {
      const chosen = await getPlatform().pickFile({ filterName: '教材文件', extensions: ['pdf', 'epub', 'mobi'] });
      if (!chosen) return;
      source.setPdfFile(null); source.setParseError(null);
      if (/\.(epub|mobi)$/i.test(chosen)) {
        source.setPdfPath(''); source.setDocPath(chosen); source.setDocUrl('');
      } else {
        source.setPdfPath(chosen); source.setDocPath(''); source.setDocUrl('');
      }
    } catch { source.setParseError('无法打开文件选择器，请在下方填写本地教材路径'); }
  };

  const reuseOutline = () => {
    if (slots.isFetching || slots.isError || !slots.data?.length) {
      toast.error('教材目录尚未读取成功，请重新检测后重试'); return;
    }
    setEntries(lessonSlotsToTocCandidates(slots.data)); setStep(3);
  };

  const tocFromCandidates = (candidates: TocRecognitionCandidate[]): TocEntry[] => {
    return candidates.map(entry => {
      return { id: entry.key, title: entry.title.trim(), level: entry.directoryLevel ?? entry.kind, startPage: entry.physicalPage!,
        ...(entry.endPage ? { endPage: entry.endPage } : {}), ...(entry.parentId ? { parentId: entry.parentId } : {}) };
    });
  };

  const confirmOutline = async (candidates: TocRecognitionCandidate[]) => {
    if (!path || candidates.some(entry => !Number.isSafeInteger(entry.physicalPage) || (entry.physicalPage ?? 0) < 1)) {
      throw new Error('请先核对目录条目对应的 PDF 实际页码');
    }
    const saved = await outlineMutation.mutateAsync({
      traceId,
      ...(targetDocument ? { documentId: targetDocument.documentId } : {}),
      title: targetDocument?.title ?? filename.replace(/\.[^/.]+$/, ''),
      filePath: path, language: pipelineLanguage, tocEntries: tocFromCandidates(candidates),
    });
    if (previousSource.current !== sourceKey) return;
    setEntries(saved.entries.map((entry, index) => ({
      ...candidates[index]!, key: entry.id, directoryLevel: entry.level, physicalPage: entry.startPage,
      ...(entry.endPage ? { endPage: entry.endPage } : {}),
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
    })));
    setStep(3); toast.success(`目录已保存，共 ${saved.totalEntries} 个一级提取章节`);
  };

  const beginRescan = () => { setRescanOutline(true); setEntries(null); setStep(2); };

  const start = () => {
    if (startMutation.isPending || outlineMutation.isPending || activeJob?.status === 'running') return;
    if (!path || !entries?.length) { source.setParseError('请先选择本地 PDF 并确认目录'); return; }
    if (entries.some((entry) => (entry.physicalPage ?? 0) < 1 || !Number.isSafeInteger(entry.physicalPage))) {
      source.setParseError('请先核对目录条目对应的 PDF 实际页码'); return;
    }
    const poolSize = Number(pipelinePoolSize);
    const config = TextbookPipelineSettingsSchema.safeParse({ ...pipelineSettings, poolSize });
    if (!config.success) { source.setParseError('提取并发、队列容量或重试预算不符合允许范围'); return; }
    const tocEntries = tocFromCandidates(entries).map((entry, index) => ({ ...entry, sortOrder: index + 1 }));
    source.setParseError(null);
    startMutation.mutate({
      traceId: crypto.randomUUID(),
      ...(targetDocument ? { documentId: targetDocument.documentId } : outlineMutation.variables?.filePath === path && outlineMutation.data ? { documentId: outlineMutation.data.documentId } : {}),
      title: targetDocument?.title ?? filename.replace(/\.[^/.]+$/, ''),
      filePath: path, tocEntries, forceOverwrite, language: pipelineLanguage, ...config.data, ...(pipelineModel ? { model: pipelineModel } : {}),
      ...(pipelineEffort ? { effort: pipelineEffort } : {}),
      ...(pipelineRuntimeId ? { runtimeId: pipelineRuntimeId } : {}),
    }, {
      onSuccess: () => { setStep(3); toast.success('教材提炼已启动，已完成课次会保留'); },
      onError: (error) => source.setParseError(error.message),
    });
  };

  const importDocument = () => {
    const vars = source.docPath.trim() ? { filePath: source.docPath.trim() } : { url: source.docUrl.trim() };
    documentMutation.mutate(vars, {
      onSuccess: (result) => source.setDocNote(`已导入《${result.title}》，共 ${result.lessons} 课，请在教材列表核对内容`),
      onError: (error) => source.setParseError(error.message),
    });
  };

  const recheck = async () => {
    await Promise.all([
      inspection.refetch(), queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DOCUMENTS }),
    ]);
  };

  return {
    path, filename, sourceKey, traceId, step, setStep, entries, setEntries, activeJob, inspection, displayDocument,
    targetDocument, slots, forceOverwrite, setForceOverwrite, startMutation, documentMutation,
    outlineMutation, rescanOutline, confirmOutline, beginRescan,
    browse, reuseOutline, start, importDocument, recheck,
  };
}
