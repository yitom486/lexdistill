import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { getPlatform } from '../../platform/capabilities.js';
import { stripPdfPathQuotes } from '../../lib/pdf-upload-guard.js';
import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import {
  useTextbookImportInspectionQuery, useTextbookLessonSlotsQuery,
  lessonSlotsToTocCandidates, useImportDocumentMutation,
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
  const [step, setStep] = useState<1 | 2 | 3>(() => activeJob ? 3 : 1);
  const [entries, setEntries] = useState<TocRecognitionCandidate[] | null>(null);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const previousSource = useRef(sourceKey);
  const inspection = useTextbookImportInspectionQuery(path ? { filename, filePath: path } : undefined);
  const targetDocument = inspection.data?.matchedDocument;
  const displayDocument = targetDocument;
  const slots = useTextbookLessonSlotsQuery(targetDocument?.documentId ?? (!path ? activeJob?.documentId : undefined));
  const startMutation = useStartPipelineJobMutation();
  const documentMutation = useImportDocumentMutation();
  const queryClient = useQueryClient();
  const pipelineModel = usePreferencesStore((s) => s.pipelineModel);
  const pipelineEffort = usePreferencesStore((s) => s.pipelineEffort);
  const pipelinePoolSize = usePreferencesStore((s) => s.pipelinePoolSize);

  useEffect(() => {
    if (previousSource.current === sourceKey) return;
    previousSource.current = sourceKey;
    setEntries(null); setForceOverwrite(false); setStep(1);
  }, [sourceKey]);

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

  const start = () => {
    if (startMutation.isPending || activeJob?.status === 'running') return;
    if (!path || !entries?.length) { source.setParseError('请先选择本地 PDF 并确认目录'); return; }
    if (entries.some((entry) => !entry.physicalPage || !Number.isSafeInteger(entry.physicalPage))) {
      source.setParseError('请先核对目录条目对应的 PDF 实际页码'); return;
    }
    const poolSize = Number(pipelinePoolSize);
    if (!Number.isSafeInteger(poolSize) || poolSize < 1) { source.setParseError('并发 Worker 数量必须为正整数'); return; }
    const oldSlots = slots.data ?? [];
    const identities = new Map(entries.map((entry) => {
      const existing = oldSlots.find((s) => s.title === entry.title.trim() && (s.startPage === null || s.startPage === entry.physicalPage));
      const id = existing?.lessonId ?? (oldSlots.some((s) => s.lessonId === entry.key) ? crypto.randomUUID() : entry.key);
      return [entry.key, id];
    }));
    let parentLesson: string | undefined;
    const tocEntries = entries.map((entry, index) => {
      const id = identities.get(entry.key)!;
      if (entry.kind === 'lesson') parentLesson = id;
      const parentId = entry.parentId ? identities.get(entry.parentId) : entry.kind === 'section' && entry.level === 2 ? parentLesson : undefined;
      return {
        id, title: entry.title.trim(), level: entry.kind, startPage: entry.physicalPage!, sortOrder: index + 1,
        ...(entry.endPage ? { endPage: entry.endPage } : {}), ...(parentId ? { parentId } : {}),
      };
    });
    source.setParseError(null);
    startMutation.mutate({
      ...(targetDocument ? { documentId: targetDocument.documentId } : {}),
      title: targetDocument?.title ?? filename.replace(/\.[^/.]+$/, ''),
      filePath: path, tocEntries, forceOverwrite, ...(pipelineModel ? { model: pipelineModel } : {}), poolSize,
      ...(pipelineEffort ? { effort: pipelineEffort } : {}),
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
    path, filename, sourceKey, step, setStep, entries, setEntries, activeJob, inspection, displayDocument,
    targetDocument, slots, forceOverwrite, setForceOverwrite, startMutation, documentMutation,
    browse, reuseOutline, start, importDocument, recheck,
  };
}
