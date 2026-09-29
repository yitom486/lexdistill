import React, { useRef, useState } from 'react';
import {
  FileUp,
  FolderOpen,
  X,
  BookOpen,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  ListTree,
  FileCheck2,
  Cpu,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { TextbookAST } from '@study-studio/document-model';
import {
  useImportPdfMutation,
  useMapPdfMutation,
  useAppendPdfMutation,
  useImportDocumentMutation,
  useExecuteTextbookPipelineMutation,
  type ExecuteTextbookPipelineResult,
} from '../../queries/useLearnerQueries.js';
import { Switch } from '../ui/switch.js';
import { useOcrStore } from '../../stores/useOcrStore.js';
import { nextRelayWindow, resolveOcrOverflowWindow, resolvePdfPageRange } from '../../lib/pdf-page-range.js';
import { isPdfUploadTooLarge, pdfTooLargeMessage, stripPdfPathQuotes } from '../../lib/pdf-upload-guard.js';
import { GatewayRequestError } from '../../lib/gateway-error.js';
import { sound } from '../../utils/audio.js';
import { getPlatform } from '../../platform/capabilities.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { TocRecognitionPanel } from '../toc/TocRecognitionPanel.js';
import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';

interface TextbookPipelineImporterTabProps {
  pdfFile: File | null;
  setPdfFile: (f: File | null) => void;
  pdfPath: string;
  setPdfPath: (p: string) => void;
  docPath: string;
  setDocPath: (p: string) => void;
  docUrl: string;
  setDocUrl: (u: string) => void;
  pdfNote: string | null;
  setPdfNote: (n: string | null) => void;
  pdfFileError: string | null;
  setPdfFileError: (e: string | null) => void;
  docNote: string | null;
  setDocNote: (n: string | null) => void;
  setParseError: (err: string | null) => void;
  parsedAST: TextbookAST | null;
  setParsedAST: (ast: TextbookAST | null) => void;
  setInputText: (text: string) => void;
  existingBooks?: Array<{ documentId: string; title: string; lessons: number }>;
  onClose: () => void;
  onSelectJsonFile: (fileOrPath: File | string) => void;
}

export function TextbookPipelineImporterTab({
  pdfFile,
  setPdfFile,
  pdfPath,
  setPdfPath,
  docPath,
  setDocPath,
  docUrl,
  setDocUrl,
  pdfNote,
  setPdfNote,
  pdfFileError,
  setPdfFileError,
  docNote,
  setDocNote,
  setParseError,
  setParsedAST,
  setInputText,
  existingBooks = [],
  onClose,
  onSelectJsonFile,
}: TextbookPipelineImporterTabProps) {
  // 严格时序状态机：1. 选取文件 -> 2. 目录识别与核对 -> 3. 全文解析与提炼入库
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [confirmedToc, setConfirmedToc] = useState<TocRecognitionCandidate[] | null>(null);

  const [pdfStartPage, setPdfStartPage] = useState<string>('');
  const [pdfEndPage, setPdfEndPage] = useState<string>('');
  const [pdfScope, setPdfScope] = useState<'all' | 'range'>('all');
  const [appendTarget, setAppendTarget] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const nativeFileInputRef = useRef<HTMLInputElement>(null);
  const pdfPathInputRef = useRef<HTMLInputElement>(null);

  const importPdf = useImportPdfMutation();
  const mapPdf = useMapPdfMutation();
  const appendPdf = useAppendPdfMutation();
  const importDoc = useImportDocumentMutation();
  const executePipeline = useExecuteTextbookPipelineMutation();
  const queryClient = useQueryClient();

  const modelsQuery = useAgentModelsQuery();
  const codexModels = modelsQuery.data ?? [];

  const pipelineModel = usePreferencesStore((s) => s.pipelineModel);
  const setPipelineModel = usePreferencesStore((s) => s.setPipelineModel);
  const pipelinePoolSize = usePreferencesStore((s) => s.pipelinePoolSize);
  const setPipelinePoolSize = usePreferencesStore((s) => s.setPipelinePoolSize);

  const isKnownCodexModel = codexModels.some(
    (m) => (m.id && m.id === pipelineModel) || (m.model && m.model === pipelineModel)
  );
  const isCustomModel = Boolean(pipelineModel) && !isKnownCodexModel;
  const [isCustomMode, setIsCustomMode] = useState<boolean>(() => isCustomModel);
  const [customModelInput, setCustomModelInput] = useState<string>(
    () => (isCustomModel ? pipelineModel : '')
  );

  const [forceOverwrite, setForceOverwrite] = useState<boolean>(false);
  const [pipelineResult, setPipelineResult] = useState<ExecuteTextbookPipelineResult | null>(null);

  // Azure 云 OCR（备用回填）
  const azureDiEndpoint = useOcrStore((s) => s.azureDiEndpoint);
  const azureDiKey = useOcrStore((s) => s.azureDiKey);
  const setAzureDi = useOcrStore((s) => s.setAzureDi);
  const azureCreds =
    azureDiEndpoint.trim() && azureDiKey.trim()
      ? { endpoint: azureDiEndpoint.trim(), key: azureDiKey.trim() }
      : undefined;

  const hasSourceFile = Boolean(pdfFile || pdfPath.trim() || docPath.trim());

  const handleBrowseLocalFile = async () => {
    sound.playClick();
    const platform = getPlatform();
    if (platform.isDesktop()) {
      const chosen = await platform.pickFile({
        filterName: '教材文件 (PDF, EPUB, MOBI, JSON)',
        extensions: ['pdf', 'epub', 'mobi', 'json'],
      });
      if (chosen) {
        const lower = chosen.toLowerCase();
        if (lower.endsWith('.json')) {
          onSelectJsonFile(chosen);
          return;
        }
        if (lower.endsWith('.epub') || lower.endsWith('.mobi')) {
          setDocPath(chosen);
          setDocUrl('');
          toast.success(`已选定：${chosen.split(/[/\\]/).pop()}`);
          return;
        }
        setPdfPath(chosen);
        setPdfFile(null);
        setPdfFileError(null);
        setParseError(null);
        const fileName = chosen.split(/[/\\]/).pop() || chosen;
        setPdfNote(`已选定：${fileName}（桌面物理直读已就绪）`);
        sound.playCorrect();
        toast.success(`已选定教材：${fileName}`);
      }
      return;
    }
    nativeFileInputRef.current?.click();
  };

  const handleClearFile = () => {
    sound.playClick();
    setPdfFile(null);
    setPdfPath('');
    setDocPath('');
    setPdfFileError(null);
    setPdfNote(null);
    setParseError(null);
    setConfirmedToc(null);
    setCurrentStep(1);
  };

  const handleNativeFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      onSelectJsonFile(file);
      return;
    }

    if (lower.endsWith('.epub') || lower.endsWith('.mobi')) {
      setDocPath(file.name);
      toast.info(`已选定 ${file.name}`);
      return;
    }

    if (isPdfUploadTooLarge(file.size)) {
      const msg = pdfTooLargeMessage(file.name, file.size);
      setPdfFile(null);
      setPdfNote(null);
      setParseError(msg);
      setPdfFileError(msg);
      toast.error(msg);
      sound.playMistake();
      return;
    }
    setPdfFile(file);
    setPdfPath('');
    setPdfFileError(null);
    setParseError(null);
    setPdfNote(`已选择 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB）`);
    sound.playCorrect();
    toast.success(`已就绪：${file.name}`);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      onSelectJsonFile(file);
      return;
    }

    if (lower.endsWith('.epub') || lower.endsWith('.mobi')) {
      setDocPath(file.name);
      toast.info(`已选定 ${file.name}`);
      return;
    }

    if (lower.endsWith('.pdf')) {
      if (isPdfUploadTooLarge(file.size)) {
        const msg = pdfTooLargeMessage(file.name, file.size);
        setPdfFile(null);
        setPdfNote(null);
        setParseError(msg);
        setPdfFileError(msg);
        toast.error(msg);
        sound.playMistake();
        return;
      }
      setPdfFile(file);
      setPdfPath('');
      setPdfFileError(null);
      setParseError(null);
      setPdfNote(`已选择 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB）`);
      sound.playCorrect();
      toast.success(`已就绪：${file.name}`);
      return;
    }

    toast.error('暂不支持该文件格式，请选择 PDF / EPUB / MOBI / JSON 文件');
  };

  const selectedFileName = pdfPath
    ? pdfPath.split(/[/\\]/).pop() || pdfPath
    : pdfFile
      ? pdfFile.name
      : docPath
        ? docPath.split(/[/\\]/).pop() || docPath
        : '';

  const selectedFileMode = pdfPath
    ? '桌面本地直读 (Direct I/O)'
    : pdfFile
      ? `${(pdfFile.size / 1024 / 1024).toFixed(1)} MB`
      : docPath
        ? '电子书文档'
        : '';

  const readPageRange = () => resolvePdfPageRange(pdfScope, pdfStartPage, pdfEndPage);

  const handleDocImport = () => {
    if (importDoc.isPending) return;
    const path = docPath.trim();
    const url = docUrl.trim();
    if (!path && !url) return;
    setParseError(null);
    setDocNote(null);
    sound.playClick();
    importDoc.mutate(path ? { filePath: path } : { url }, {
      onSuccess: (r) => {
        sound.playCorrect();
        setDocNote(`已导入《${r.title}》· ${r.lessons} 课，可在教材列表打开精读`);
        toast.success(`文档导入成功：${r.title}（${r.lessons} 课）`);
      },
      onError: (err) => {
        setParseError(err instanceof Error ? err.message : '文档导入失败');
        sound.playMistake();
      },
    });
  };

  const handlePdfImport = () => {
    if (importPdf.isPending || appendPdf.isPending) return;
    const path = stripPdfPathQuotes(pdfPath);
    const importFile = pdfFile && !isPdfUploadTooLarge(pdfFile.size) ? pdfFile : null;
    if (!importFile && !path) {
      if (pdfFile) {
        const msg = pdfTooLargeMessage(pdfFile.name, pdfFile.size);
        setParseError(msg);
        setPdfFileError(msg);
      }
      return;
    }
    setParseError(null);
    setPdfNote(null);
    const range = readPageRange();
    if (range === 'incomplete-range') {
      setParseError('已选「指定页码」，请同时填写起始页和结束页');
      return;
    }
    sound.playClick();
    const { startPage, endPage } = range;

    if (appendTarget) {
      const vars = importFile
        ? {
            documentId: appendTarget,
            file: importFile,
            ...(startPage !== undefined ? { startPage } : {}),
            ...(endPage !== undefined ? { endPage } : {}),
            ...(azureCreds ? { azure: azureCreds } : {}),
          }
        : {
            documentId: appendTarget,
            filePath: path,
            ...(startPage !== undefined ? { startPage } : {}),
            ...(endPage !== undefined ? { endPage } : {}),
            ...(azureCreds ? { azure: azureCreds } : {}),
          };
      appendPdf.mutate(vars, {
        onSuccess: (r) => {
          sound.playCorrect();
          toast.success(`接力成功：新增 ${r.addedLessons} 课 ${r.addedDialogues} 句，全书共 ${r.totalLessons} 课`);
          onClose();
        },
        onError: (err) => {
          setParseError(err instanceof Error ? err.message : '接力追加失败');
          sound.playMistake();
        },
      });
      return;
    }

    const vars = importFile
      ? {
          file: importFile,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        }
      : {
          filePath: path,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        };
    importPdf.mutate(vars, {
      onSuccess: (result) => {
        setParsedAST(result.book);
        setInputText(JSON.stringify(result.book, null, 2));
        const c = result.classification;
        const kind =
          c.pdfType === 'TextBased' ? '文字版' : c.pdfType === 'Scanned' ? '扫描版（已 OCR）' : c.pdfType;
        const rangeStr =
          c.selectedPages.length > 0
            ? ` · 第 ${c.selectedPages[0]}–${c.selectedPages[c.selectedPages.length - 1]} 页`
            : '';
        const titles = result.book.lessons.map((l) => l.title);
        const next = nextRelayWindow(c.selectedPages, c.pageCount);
        if (c.clampedFromAll === true) {
          const first = c.selectedPages[0] ?? 1;
          const last = c.selectedPages[c.selectedPages.length - 1] ?? first;
          if (next) {
            setPdfScope('range');
            setPdfStartPage(String(next.startPage));
            setPdfEndPage(String(next.endPage));
          }
          setPdfNote(
            `扫描书一次最多 30 页，已导入第 ${first}–${last} 页 · ${result.stats.lessons} 课 ${result.stats.dialogues} 句` +
              (titles.length > 0 ? ` → ${titles.join(' / ')}` : '') +
              (next
                ? `；已预填第 ${next.startPage}–${next.endPage} 页，选「接力到已有书」继续`
                : '；剩余请指定页码并选「接力到已有书」')
          );
          sound.playCorrect();
          toast.success(
            `扫描书一次最多 30 页，已导入第 ${first}–${last} 页` +
              (next ? `，已预填第 ${next.startPage}–${next.endPage} 页待接力` : '，请指定页码接力')
          );
          return;
        }
        setPdfNote(
          `识别为${kind} · ${c.pageCount} 页${rangeStr} · ${result.stats.lessons} 课 ${result.stats.dialogues} 句` +
            (c.ocrUsed ? ' · 已 OCR' : '') +
            ((c.azurePages?.length ?? 0) > 0 ? ` · 云回填 ${c.azurePages?.length} 页` : '') +
            (titles.length > 0 ? ` → ${titles.join(' / ')}` : '')
        );
        sound.playCorrect();
        toast.success(`PDF 解析成功：${result.stats.lessons} 课，课文知识树已就绪，请在底部确认激活！`);
        if (next && c.selectedPages.length > 0) {
          setPdfStartPage(String(next.startPage));
          setPdfEndPage(String(next.endPage));
        }
      },
      onError: (err) => {
        setParseError(err instanceof Error ? err.message : 'PDF 导入失败');
        sound.playMistake();
        if (pdfScope === 'all' && err instanceof GatewayRequestError) {
          const suggestion = resolveOcrOverflowWindow(
            err.details,
            mapPdf.data?.headings,
            mapPdf.data?.classification.pageCount
          );
          if (suggestion) {
            setPdfScope('range');
            setPdfStartPage(String(suggestion.startPage));
            setPdfEndPage(String(suggestion.endPage));
          }
        }
      },
    });
  };

  const handleTocConfirmed = (entries: TocRecognitionCandidate[]) => {
    setConfirmedToc(entries);
    sound.playCorrect();
    toast.success(`已核对 ${entries.length} 条目录草稿，请推进至全文解析`);
  };

  const handleExecutePipeline = () => {
    if (executePipeline.isPending) return;
    if (!confirmedToc || confirmedToc.length === 0) {
      toast.error('请先在第 2 步核对并确认教材目录大纲');
      return;
    }
    const path = stripPdfPathQuotes(pdfPath);
    if (!path && !pdfFile) {
      toast.error('未找到有效的教材文件，请返回第 1 步重新选取');
      return;
    }

    sound.playClick();
    setParseError(null);
    setPipelineResult(null);

    const docTitle = selectedFileName.replace(/\.[^/.]+$/, '').trim() || '未命名教材';
    const tocEntries = confirmedToc.map((c, idx) => ({
      id: `l${idx + 1}`,
      title: c.title.trim(),
      level: c.kind === 'section' ? 'section' : 'lesson',
      startPage: Number(c.printedPage) || c.physicalPage || (idx + 1),
      sortOrder: idx + 1,
    }));

    executePipeline.mutate(
      {
        title: docTitle,
        language: 'ja',
        ...(path ? { filePath: path } : {}),
        ...(pipelineModel && pipelineModel !== '__default__' && pipelineModel !== 'default'
          ? { model: pipelineModel.trim() }
          : {}),
        poolSize: Number(pipelinePoolSize) || 3,
        forceOverwrite,
        tocEntries,
      },
      {
        onSuccess: (res) => {
          sound.playCorrect();
          setPipelineResult(res);
          queryClient.invalidateQueries({ queryKey: ['textbooks'] });
          toast.success(`教材《${res.title}》全书提炼完成！共 ${res.successfulLessons} 课就绪`);
        },
        onError: (err) => {
          sound.playMistake();
          const msg = err instanceof Error ? err.message : '教材提炼流水线执行异常';
          setParseError(msg);
          toast.error(msg);
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      {/* 隐藏的真实文件 input 供 Web 端 fallback */}
      <input
        ref={nativeFileInputRef}
        type="file"
        accept=".pdf,.epub,.mobi,.json"
        className="hidden"
        disabled={importPdf.isPending || mapPdf.isPending}
        onChange={handleNativeFileInput}
      />

      {/* 严格时序步骤指示器（Stepper Wizard Header） */}
      <div className="flex items-center justify-between p-2 rounded-2xl bg-surface border border-line">
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl transition-all ${
            currentStep === 1
              ? 'bg-surface-elevated text-ink font-semibold border border-line shadow-xs'
              : hasSourceFile
                ? 'text-ink-muted hover:text-ink font-medium'
                : 'text-ink font-medium'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-line ${
              currentStep === 1
                ? 'bg-surface text-ink border-line'
                : hasSourceFile
                  ? 'bg-surface text-ink-muted'
                  : 'bg-surface text-ink-ghost'
            }`}
          >
            {hasSourceFile && currentStep !== 1 ? '✓' : '1'}
          </span>
          1. 选取教材文件
        </button>

        <ChevronRight className="w-3.5 h-3.5 text-ink-ghost shrink-0" />

        {/* Step 2 */}
        <button
          type="button"
          disabled={!hasSourceFile}
          onClick={() => hasSourceFile && setCurrentStep(2)}
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl transition-all ${
            currentStep === 2
              ? 'bg-surface-elevated text-ink font-semibold border border-line shadow-xs'
              : confirmedToc
                ? 'text-ink-muted hover:text-ink font-medium'
                : hasSourceFile
                  ? 'text-ink font-medium'
                  : 'text-ink-ghost opacity-50 cursor-not-allowed'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-line ${
              currentStep === 2
                ? 'bg-surface text-ink'
                : confirmedToc
                  ? 'bg-surface text-ink-muted'
                  : 'bg-surface text-ink-ghost'
            }`}
          >
            {confirmedToc && currentStep !== 2 ? '✓' : '2'}
          </span>
          2. 目录识别与草稿核对
          {confirmedToc && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono text-ink">
              已核对 {confirmedToc.length} 条
            </Badge>
          )}
        </button>

        <ChevronRight className="w-3.5 h-3.5 text-ink-ghost shrink-0" />

        {/* Step 3 */}
        <button
          type="button"
          disabled={!confirmedToc}
          onClick={() => confirmedToc && setCurrentStep(3)}
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl transition-all ${
            currentStep === 3
              ? 'bg-surface-elevated text-ink font-semibold border border-line shadow-xs'
              : importPdf.isSuccess
                ? 'text-ink-muted hover:text-ink font-medium'
                : confirmedToc
                  ? 'text-ink font-medium'
                  : 'text-ink-ghost opacity-50 cursor-not-allowed'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-line ${
              currentStep === 3
                ? 'bg-surface text-ink'
                : importPdf.isSuccess
                  ? 'bg-surface text-ink-muted'
                  : 'bg-surface text-ink-ghost'
            }`}
          >
            {importPdf.isSuccess ? '✓' : '3'}
          </span>
          3. 课文解析与知识点提炼
        </button>
      </div>

      {/* ======================= Step 1: 选取教材文件 ======================= */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {!selectedFileName ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleBrowseLocalFile}
              className={`cursor-pointer border-2 border-dashed rounded-3xl p-8 text-center transition-all duration-200 flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? 'border-tone-amber-500 bg-wash-amber-500o15 scale-[0.99]'
                  : 'border-line-soft hover:border-tone-amber-500/60 bg-wash-amber-500o5 hover:bg-wash-amber-500o10'
              }`}
            >
              <div className="p-3.5 rounded-2xl bg-wash-amber-500o15 text-accent-ink">
                <FileUp className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">
                  点击浏览本地教材文件，或将文件拖拽至此处
                </h4>
                <p className="text-xs text-ink-ghost mt-1">
                  支持 PDF 电子课本（文字版或扫描件自动 OCR）、EPUB、MOBI
                </p>
              </div>
              <Button variant="secondary" size="sm" className="mt-1 shadow-xs pointer-events-none">
                <FolderOpen className="w-3.5 h-3.5" />
                浏览本地文件
              </Button>
            </div>
          ) : (
            <div className="p-4 rounded-3xl border border-tone-amber-500o30 bg-wash-amber-500o10 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-wash-amber-500o15 text-accent-ink border border-line-accent shadow-xs">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink">{selectedFileName}</span>
                    <Badge variant="amber" className="text-[10px]">
                      {selectedFileMode}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-ghost mt-0.5">
                    {pdfNote || '已选定教材文件，请点击下一步进行目录识别与课次核对'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleBrowseLocalFile}>
                  <FolderOpen className="w-3.5 h-3.5" />
                  更换文件
                </Button>
                <Button variant="ghost" size="sm" onClick={handleClearFile} title="清除选择">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {pdfFileError && (
            <p role="alert" className="text-xs font-semibold text-ink-red-600-red-400">
              {pdfFileError}
            </p>
          )}

          {/* 高级选项（可折叠） */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="pt-1">
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-semibold text-ink-ghost hover:text-ink transition-colors">
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              高级配置（手动修改绝对物理路径 / EPUB 网页导入 / Azure 备用 OCR）
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 p-4 rounded-2xl bg-wash-amber-500o5 border border-line-soft space-y-3.5 text-xs">
              <div className="space-y-1">
                <span className="font-semibold text-ink">本机物理绝对路径（已由选择器自动填充，如需微调）：</span>
                <input
                  ref={pdfPathInputRef}
                  type="text"
                  placeholder="已选文件物理绝对路径"
                  value={pdfPath}
                  onChange={(e) => {
                    setPdfPath(e.target.value);
                    if (e.target.value.trim()) {
                      setPdfFile(null);
                      setPdfFileError(null);
                    }
                  }}
                  disabled={importPdf.isPending || mapPdf.isPending}
                  className="w-full h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1 pt-2 border-t border-line-soft">
                <span className="font-semibold text-ink">EPUB / MOBI / 网页直链导入：</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="EPUB 文件路径"
                    value={docPath}
                    onChange={(e) => {
                      setDocPath(e.target.value);
                      if (e.target.value.trim()) setDocUrl('');
                    }}
                    disabled={importDoc.isPending}
                    className="flex-1 min-w-44 h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="或粘贴网页网址 (https://...)"
                    value={docUrl}
                    onChange={(e) => {
                      setDocUrl(e.target.value);
                      if (e.target.value.trim()) setDocPath('');
                    }}
                    disabled={importDoc.isPending}
                    className="flex-1 min-w-44 h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                  />
                  <Button
                    size="sm"
                    disabled={(!docPath.trim() && !docUrl.trim()) || importDoc.isPending}
                    onClick={handleDocImport}
                  >
                    {importDoc.isPending ? '导入中…' : '导入文档'}
                  </Button>
                </div>
                {docNote && (
                  <p className="text-[11px] font-semibold text-ink-emerald-700-emerald-400 mt-1">{docNote}</p>
                )}
              </div>

              <div className="space-y-1 pt-2 border-t border-line-soft">
                <span className="font-semibold text-ink">Azure 云端 OCR 回填（选填，备用）：</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Endpoint (https://xxx.cognitiveservices.azure.com)"
                    value={azureDiEndpoint}
                    onChange={(e) => setAzureDi(e.target.value, azureDiKey)}
                    disabled={importPdf.isPending || mapPdf.isPending}
                    className="flex-1 min-w-44 h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                  />
                  <input
                    type="password"
                    placeholder="Key"
                    value={azureDiKey}
                    onChange={(e) => setAzureDi(azureDiEndpoint, e.target.value)}
                    disabled={importPdf.isPending || mapPdf.isPending}
                    className="w-32 h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 推进到 Step 2 的主引导按钮 */}
          <div className="flex items-center justify-end pt-3 border-t border-line-soft">
            <Button
              disabled={!hasSourceFile}
              onClick={() => {
                sound.playClick();
                setCurrentStep(2);
              }}
              className="gap-2"
            >
              下一步：识别教材目录 (Step 2)
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ======================= Step 2: 目录识别与槽位核对 ======================= */}
      {currentStep === 2 && (
        <div className="space-y-4">
          {/* 文件信息小摘要条 */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-surface border border-line text-xs">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent-ink" />
              <span className="font-semibold text-ink">当前处理教材：</span>
              <span className="font-mono text-ink font-medium truncate max-w-md">{selectedFileName}</span>
              <Badge variant="secondary" className="text-[10px]">{selectedFileMode}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)} className="text-xs">
              更换文件
            </Button>
          </div>

          {/* 目录识别面板 */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-3">
            <div className="flex items-center gap-2">
              <ListTree className="w-4 h-4 text-accent-ink" />
              <h3 className="text-xs font-bold text-ink">目录识别与核对</h3>
            </div>
            <p className="text-[11px] text-ink-muted">
              核对目录标题和印刷页码，然后进入全文解析。正文页的 PDF 位置将在后续步骤确定。
            </p>

            <TocRecognitionPanel
              key={pdfFile ? `${pdfFile.name}:${pdfFile.size}:${pdfFile.lastModified}` : stripPdfPathQuotes(pdfPath)}
              file={pdfFile && !isPdfUploadTooLarge(pdfFile.size) ? pdfFile : null}
              filePath={stripPdfPathQuotes(pdfPath)}
              {...(azureCreds ? { azure: azureCreds } : {})}
              onTocConfirmed={handleTocConfirmed}
            />
          </div>

          {/* 辅助参考：扫描预览检测到的标题 */}
          {(mapPdf.data?.headings.length ?? 0) > 0 && (
            <div className="text-xs text-ink-faint space-y-1.5 p-3 rounded-2xl bg-surface border border-line">
              <p className="font-bold text-ink">辅助参考：页面扫出的疑似课次标题</p>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                {mapPdf.data?.headings.slice(0, 30).map((h, i) => (
                  <div key={`${h.page}-${i}`} className="flex items-center justify-between text-[11px] text-ink-ghost">
                    <span className="truncate">{h.text}</span>
                    <span className="shrink-0 font-mono">p{h.page}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 底部操作条 */}
          <div className="flex items-center justify-between pt-3 border-t border-line-soft">
            <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)} className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />
              返回重选文件
            </Button>

            <div className="flex items-center gap-2">
              {!confirmedToc ? (
                <span className="text-[11px] text-ink-muted font-medium">
                  请先在上方核对目录草稿
                </span>
              ) : (
                <Button
                  onClick={() => {
                    sound.playClick();
                    setCurrentStep(3);
                  }}
                  className="gap-2"
                >
                  目录已核对，进入全文解析 (Step 3)
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================= Step 3: 全文解析与提炼入库 ======================= */}
      {currentStep === 3 && (
        <div className="space-y-4">
          {/* 已核对的目录草稿预览；此时尚未写入课次槽位。 */}
          <div className="p-4 rounded-2xl bg-wash-amber-500o10 border border-tone-amber-500o30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-ink-emerald-700-emerald-400" />
                <span className="text-xs font-bold text-ink">
                  目录草稿已核对（共 {confirmedToc?.length ?? 0} 条）
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCurrentStep(2)} className="text-xs h-7">
                返回修改目录
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {confirmedToc?.slice(0, 30).map((t, idx) => (
                <span
                  key={t.key || idx}
                  className="px-2 py-0.5 rounded-lg border border-line bg-surface text-[11px] font-medium text-ink"
                >
                  {t.title || `第${idx + 1}课`} (p{t.printedPage})
                </span>
              ))}
              {(confirmedToc?.length ?? 0) > 30 && (
                <span className="text-[11px] text-ink-ghost self-center">
                  …等共 {confirmedToc?.length} 课
                </span>
              )}
            </div>
          </div>

          {/* Agent 池与专精大模型分级配置（AGENTS.md §1.6b 用户配置权） */}
          <div className="p-4 rounded-2xl border border-line bg-surface space-y-4">
            <div className="flex items-center justify-between border-b border-line-soft pb-2.5">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent" />
                <span className="text-xs font-bold text-ink">AI Agent 池与模型算力配置</span>
              </div>
              <Badge variant="outline" className="text-[10px] text-ink-ghost">
                AGENTS.md §1.6b 规范
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-ink">
                    专职提炼大模型（Model Tiering）：
                  </label>
                  {modelsQuery.isFetching ? (
                    <span className="text-[10px] text-ink-ghost">拉取本地 Codex 模型中…</span>
                  ) : codexModels.length > 0 ? (
                    <span className="text-[10px] text-tone-amber-600 dark:text-tone-amber-400">
                      已识别 {codexModels.length} 个本机模型
                    </span>
                  ) : null}
                </div>
                <Select
                  value={isCustomMode ? '__custom__' : (pipelineModel || '__default__')}
                  onValueChange={(v) => {
                    if (v === '__custom__') {
                      setIsCustomMode(true);
                      if (customModelInput.trim()) {
                        setPipelineModel(customModelInput.trim());
                      }
                    } else if (v === '__default__') {
                      setIsCustomMode(false);
                      setPipelineModel('');
                    } else if (v) {
                      setIsCustomMode(false);
                      setPipelineModel(v);
                    }
                  }}
                  disabled={executePipeline.isPending}
                >
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue placeholder="选择本地 Codex 模型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">
                      ⚡ 本地 Codex 默认模型（跟随本机全局配置）
                    </SelectItem>
                    {codexModels.map((m) => (
                      <SelectItem key={m.id || m.model} value={m.id || m.model}>
                        {m.displayName || m.model}
                        {m.isDefault ? '（本机推荐/默认）' : ''}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">
                      ✏️ 手动输入模型标识 (Custom Model)...
                    </SelectItem>
                  </SelectContent>
                </Select>

                {isCustomMode && (
                  <div className="mt-2 space-y-1">
                    <input
                      type="text"
                      placeholder="输入本地可用模型标识（留空则跟随默认）"
                      value={customModelInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomModelInput(val);
                        setPipelineModel(val.trim());
                      }}
                      className="w-full h-8 px-2.5 rounded-xl border border-line bg-surface text-ink text-xs outline-none focus:border-tone-amber-500 font-mono"
                    />
                    <p className="text-[10px] text-ink-ghost">
                      请输入本地 Codex App Server 已接入或支持的模型标识
                    </p>
                  </div>
                )}

                <p className="mt-1 text-[11px] text-ink-ghost">
                  依托本机 Codex App Server 实时提供可用模型；选默认则自动采用本地环境配置。
                </p>
              </div>

              <div>
                <label className="block font-medium text-ink mb-1.5">
                  Agent 池并发 Worker 数量（Concurrency）：
                </label>
                <Select
                  value={pipelinePoolSize || '3'}
                  onValueChange={(v) => v && setPipelinePoolSize(v)}
                  disabled={executePipeline.isPending}
                >
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue placeholder="选择并发 Worker 数量" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 个 Worker（单任务串行·最低资源占用）</SelectItem>
                    <SelectItem value="2">2 个 Worker（温和·适合较低 API 限额）</SelectItem>
                    <SelectItem value="3">3 个 Worker（默认推荐·平衡吞吐）</SelectItem>
                    <SelectItem value="4">4 个 Worker（高效提炼）</SelectItem>
                    <SelectItem value="6">6 个 Worker（高速吞吐·需足够限额）</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-ink-ghost">
                  在单进程内开启指定数量的长连接 Session 并发，互不抢占。
                </p>
              </div>
            </div>

            {/* 幂等性保护开关 */}
            <div className="pt-2 border-t border-line-soft flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-ink">强制重新提炼全书（覆盖已就绪课次）</span>
                <p className="text-[11px] text-ink-ghost">
                  默认关闭：自动跳过数据库中状态已为 ready 的课次，保护已有学习与复习记录，省算力防覆盖。
                </p>
              </div>
              <Switch
                checked={forceOverwrite}
                onCheckedChange={setForceOverwrite}
                disabled={executePipeline.isPending}
              />
            </div>

            {/* 提炼行动按钮 */}
            <div className="pt-3 border-t border-line-soft flex flex-wrap items-center justify-between gap-3">
              <Button
                size="sm"
                disabled={executePipeline.isPending}
                onClick={handleExecutePipeline}
                className="gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {executePipeline.isPending ? 'AI Agent 池并发提炼与落库中…' : '启动 AI Agent 池并发提炼与落库'}
              </Button>
              <span className="text-[11px] text-ink-ghost">
                一课一个 Worker 任务，原子提炼预习导学、课文 Markdown、生词语法与习题
              </span>
            </div>
          </div>

          {/* 解析完成结果卡片 */}
          {pipelineResult && (
            <div className="p-4 rounded-2xl bg-wash-emerald-500o10 border border-tone-emerald-600o30 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="w-5 h-5 text-ink-emerald-700-emerald-400" />
                <div>
                  <h4 className="text-xs font-bold text-ink">
                    教材《{pipelineResult.title}》全书提炼已落库！
                  </h4>
                  <p className="text-[11px] text-ink-ghost mt-0.5">
                    全书共 {pipelineResult.lessonCount} 课，成功就绪 {pipelineResult.successfulLessons} 课
                    {pipelineResult.failedLessons > 0 && `（${pipelineResult.failedLessons} 课失败）`}，可在教材列表立即开始学习！
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="emerald" className="text-xs">
                  {pipelineResult.allLessonsReady ? '全书就绪' : '部分就绪'}
                </Badge>
                <Button size="sm" onClick={onClose} className="h-7 text-xs gap-1">
                  进入学习
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 底部导航 */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)} className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />
              返回核对目录
            </Button>
            <span className="text-[11px] text-ink-ghost">
              提炼已直接原子落库，可随时关闭弹窗或在课程列表查看
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
