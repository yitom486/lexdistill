import React, { useReducer, useState } from 'react';
import { Anchor, Eye, FileSearch, X } from 'lucide-react';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Dialog,
  DialogContent,
} from './ui/dialog.js';
import {
  useFolioCandidatesMutation,
  useImportTocLessonMutation,
  usePreviewTocSegmentsMutation,
  type TocPdfSource,
} from '../queries/useLearnerQueries.js';
import {
  anchorFlowReducer,
  buildPreviewEntries,
  decideAnchorConfirm,
  decideLessonImport,
  findCorroboratedFolios,
  fingerprintAnchors,
  initialAnchorFlowState,
  parseAnchorCheckPages,
  type FolioCandidateData,
  type FolioResponseData,
  type LocalAnchor,
  type PreviewResponseData,
  type TocLessonImportResult,
} from '../lib/toc-anchor-flow.js';
import type { EditableTocEntry } from '../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P5C：页码 anchor 与分段预览（挂在 P4C 确认之后）。
 *
 * - folio 候选只是弱证据：Arabic 经用户点击才成 anchor，Roman 永不成 anchor，
 *   冲突/低置信/多候选永不自动选；
 * - anchor / preview 只活在本地 reducer（刷新即失，不落 localStorage）；
 * - 预览只有表格与文案，没有任何“开始导入 / 写入教材”按钮。
 */

export interface TocAnchorPanelProps {
  file: File | null;
  filePath: string;
  /** P4C 已确认条目（编辑态，页码为字符串，预览前转数值）。 */
  entries: EditableTocEntry[];
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'anchor-exact':
      return 'anchor 精确命中';
    case 'verified-interval':
      return '已验证区间';
    case 'consistent-extrapolation':
      return '一致外推';
    case 'single-anchor-extrapolation':
      return '单 anchor 外推';
    case 'no-anchors':
      return '无 anchor';
    case 'between-conflicting-offsets':
      return 'offset 冲突（歧义）';
    case 'maps-before-page-1':
      return '映射出界（<1）';
    case 'maps-beyond-pagecount':
      return '映射超页数';
    default:
      return reason;
  }
}

const inputClassName =
  'h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500 text-[11px]';

export interface LessonImportGateView {
  lessonIndex: number;
  ok: boolean;
}

export interface ImportDialogView {
  lessonIndex: number;
  lessonTitle: string;
  printedStart: number;
  physicalFrom: number;
  physicalTo: number;
  pages: number;
  docTitle: string;
}

export interface TocAnchorPanelViewProps {
  hasSource: boolean;
  checkText: string;
  checkError: string | null;
  checking: boolean;
  folioError: string | null;
  folio: FolioResponseData | null;
  corroborated: Array<{ physicalPage: number; value: number }>;
  anchors: LocalAnchor[];
  previewBuildError: string | null;
  requestingPreview: boolean;
  previewError: string | null;
  preview: PreviewResponseData | null;
  previewValid: boolean;
  importGates: LessonImportGateView[];
  importDialog: ImportDialogView | null;
  importing: boolean;
  importError: string | null;
  importResult: TocLessonImportResult | null;
  onCheckTextChange(value: string): void;
  onCheckFolio(): void;
  onConfirmAnchor(physicalPage: number, candidateIndex: number): void;
  onRemoveAnchor(printedPage: number): void;
  onRequestPreview(): void;
  onSelectLessonImport(lessonIndex: number): void;
  onCloseImportDialog(): void;
  onDocTitleChange(value: string): void;
  onConfirmImport(): void;
}

/** 纯展示视图（无 hooks）：anchor/预览各态经 props 注入，供 SSR 单测直渲。 */
export function TocAnchorPanelView(props: TocAnchorPanelViewProps): React.ReactElement {
  const {
    hasSource,
    checkText,
    checkError,
    checking,
    folioError,
    folio,
    corroborated,
    anchors,
    previewBuildError,
    requestingPreview,
    previewError,
    preview,
    previewValid,
    importGates,
    importDialog,
    importing,
    importError,
    importResult,
    onCheckTextChange,
    onCheckFolio,
    onConfirmAnchor,
    onRemoveAnchor,
    onRequestPreview,
    onSelectLessonImport,
    onCloseImportDialog,
    onDocTitleChange,
    onConfirmImport,
  } = props;
  const corroboratedKey = (physicalPage: number, value: number): boolean =>
    corroborated.some((c) => c.physicalPage === physicalPage && c.value === value);
  return (
    <div className="space-y-2 pt-1 mt-1 border-t border-amber-500/20">
      <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
        <Anchor className="w-3.5 h-3.5 text-amber-600" />
        页码 anchor 与分段预览（只读）
      </p>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        候选只是弱证据；只有你点击确认后才成为本次会话 anchor；anchor 与预览只保存在当前页面，刷新即丢失。
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
        <span className="font-bold text-stone-700 dark:text-stone-200">检查 folio 页：</span>
        <input
          type="text"
          aria-label="检查物理页号"
          placeholder="如 26,31（最多 8 页）"
          value={checkText}
          onChange={(e) => onCheckTextChange(e.target.value)}
          className={`${inputClassName} w-44 font-mono`}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 text-[11px] gap-1.5"
          disabled={!hasSource || checking}
          onClick={onCheckFolio}
          title={hasSource ? '看这些物理页的页眉/页脚印刷码（只读）' : '先选择 PDF 文件或填写本机路径'}
        >
          <FileSearch className="w-3.5 h-3.5 text-amber-600" />
          <span>{checking ? '检查中…' : '检查 folio'}</span>
        </Button>
      </div>
      {checkError && (
        <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {checkError}
        </p>
      )}
      {folioError && (
        <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {folioError}
        </p>
      )}
      {folio && (
        <div className="space-y-1.5">
          {folio.pages.map((page) => (
            <div
              key={page.physicalPage}
              className="rounded-xl border border-stone-200 dark:border-stone-700 p-2 space-y-1"
            >
              <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200">
                PDF 物理页 {page.physicalPage}
                {page.candidates.length === 0 && <span className="font-normal text-stone-400">（无候选）</span>}
              </p>
              {page.candidates.map((candidate, index) => {
                const arabic = candidate.normalized.kind === 'arabic';
                const value = candidate.normalized.kind === 'arabic' ? candidate.normalized.value : null;
                const dup = value !== null && anchors.some((a) => a.printedPage === value);
                const agreed =
                  arabic && value !== null && corroboratedKey(page.physicalPage, value);
                return (
                  <div
                    key={`${candidate.location}-${candidate.raw}-${index}`}
                    className="flex flex-wrap items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-white/60 dark:bg-stone-900/40"
                  >
                    <span className="font-mono font-bold">{candidate.raw}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {candidate.normalized.kind === 'arabic' ? `印${candidate.normalized.value}` : candidate.normalized.value}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {candidate.location === 'header' ? '页眉' : '页脚'}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {candidate.source === 'native' ? '原生' : 'OCR'}
                    </Badge>
                    <Badge variant={candidate.confidence === 'medium' ? 'emerald' : 'amber'} className="text-[10px]">
                      {candidate.confidence === 'medium' ? '中置信' : '低置信'}
                    </Badge>
                    {candidate.normalized.kind === 'roman' && (
                      <Badge variant="amber" className="text-[10px]">
                        Roman·前言证据，不可成 anchor
                      </Badge>
                    )}
                    {agreed && (
                      <Badge variant="emerald" className="text-[10px]">
                        双源一致（辅助提示，仍需手动确认）
                      </Badge>
                    )}
                    {arabic && value !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        disabled={dup}
                        onClick={() => onConfirmAnchor(page.physicalPage, index)}
                        title={dup ? '该印刷页已有 anchor，先移除再确认' : '显式确认为本次会话 anchor'}
                      >
                        {`确认为 anchor（印${value} ↔ 物${page.physicalPage}）`}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-stone-600 dark:text-stone-300 space-y-1">
        <p className="font-bold">
          本地 anchors（{anchors.length} 个，初始为零，只增于你的确认点击）：
        </p>
        {anchors.length === 0 && (
          <p className="text-stone-400">暂无 anchor。请先检查 folio，再逐条确认。</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {anchors.map((anchor) => (
            <span
              key={anchor.printedPage}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] font-semibold"
            >
              {anchor.label}
              <button
                type="button"
                aria-label={`移除anchor印${anchor.printedPage}`}
                onClick={() => onRemoveAnchor(anchor.printedPage)}
                className="p-0.5 rounded hover:bg-amber-500/20 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px] gap-1.5"
          disabled={anchors.length === 0 || requestingPreview}
          onClick={onRequestPreview}
          title={anchors.length === 0 ? '先确认至少一个 anchor' : '用 P5-A 纯函数算分段（只读）'}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{requestingPreview ? '预览中…' : '请求分段预览'}</span>
        </Button>
        {anchors.length === 0 && <span className="text-[11px] text-stone-400">先确认至少一个 anchor</span>}
      </div>
      {previewBuildError && (
        <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {previewBuildError}
        </p>
      )}
      {previewError && (
        <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {previewError}
        </p>
      )}
      {preview && !previewValid && (
        <p role="alert" className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          anchor 已变更，当前预览已失效，请重新请求分段预览。
        </p>
      )}
      {preview && previewValid && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-2 space-y-1.5">
          <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
            <Badge variant="amber" className="text-[10px]">
              仅预览，尚未 OCR/导入
            </Badge>
            <span>
              {preview.diagnostics.mappedCount}/{preview.diagnostics.lessonCount} 课已映射 ·{' '}
              {preview.diagnostics.chunksPlanned} 段计划
            </span>
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {preview.lessons.map((lesson) => (
              <div
                key={lesson.lessonIndex}
                className="px-2 py-1 rounded-lg bg-white/60 dark:bg-stone-900/40 text-[11px] space-y-0.5"
              >
                <p className="truncate font-semibold">
                  {lesson.title}
                  <span className="ml-1 font-mono font-normal text-stone-400">印{lesson.printedStart}页</span>
                </p>
                <p className="font-mono text-[10px] text-stone-500">
                  {lesson.status === 'mapped'
                    ? `物${lesson.physicalStart}–${lesson.physicalEnd ?? '?'}`
                    : '未映射'}{' '}
                  · {lesson.status === 'mapped' ? '已映射' : '未映射'} · {reasonLabel(lesson.reason)}
                  {lesson.regionId && ` · 区${lesson.regionId}`} ·{' '}
                  {lesson.offsetUsed === null ? 'offset –' : `offset ${lesson.offsetUsed >= 0 ? '+' : ''}${lesson.offsetUsed}`}
                </p>
                {importGates.some((g) => g.lessonIndex === lesson.lessonIndex && g.ok) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px]"
                    onClick={() => onSelectLessonImport(lesson.lessonIndex)}
                  >
                    试导入这一课
                  </Button>
                )}
              </div>
            ))}
          </div>
          {preview.chunks.length > 0 && (
            <div className="text-[11px] text-stone-600 dark:text-stone-300 space-y-0.5">
              <p className="font-bold">chunk 计划（仅预览）：</p>
              {preview.chunks.map((chunk) => (
                <p key={`${chunk.lessonIndex}-${chunk.chunkIndex}`} className="font-mono text-[10px]">
                  第{chunk.chunkIndex + 1}段 · 物{chunk.physicalFrom}–{chunk.physicalTo} · {chunk.title}
                </p>
              ))}
            </div>
          )}
          {preview.diagnostics.unresolvedCount > 0 ? (
            <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
              当前目录不能自动导入；请补充或修正 anchor。（未映射 {preview.diagnostics.unresolvedCount} 课）
            </p>
          ) : (
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
              分段计划已验证；下一阶段才可能执行导入。
            </p>
          )}
        </div>
      )}
      {importError && (
        <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {importError}
        </p>
      )}
      {importResult && (
        <div className="p-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-[11px] text-stone-600 dark:text-stone-300 space-y-1">
          <p className="font-bold">已创建新教材 document：{importResult.lessonTitle}</p>
          <p className="font-mono text-[10px]">
            document {importResult.documentId} · lesson {importResult.lessonId} · 物理{' '}
            {importResult.range.fromPage}–{importResult.range.toPage} 页 · 对话{' '}
            {importResult.stats.dialogues} 句
          </p>
          <p>不是整本教材导入；不会继续接力导入后续章节。</p>
        </div>
      )}
      <Dialog open={importDialog !== null} onOpenChange={(open) => !open && onCloseImportDialog()}>
        <DialogContent className="max-w-md" showCloseButton>
          {importDialog && (
            <LessonImportDialogContent
              dialog={importDialog}
              importing={importing}
              onClose={onCloseImportDialog}
              onDocTitleChange={onDocTitleChange}
              onConfirm={onConfirmImport}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 最终确认 Dialog 内容（纯展示；不依赖 Dialog context，可直测；外层壳仍是 shadcn Dialog）。 */
export function LessonImportDialogContent(props: {
  dialog: ImportDialogView;
  importing: boolean;
  onClose(): void;
  onDocTitleChange(value: string): void;
  onConfirm(): void;
}): React.ReactElement {
  const { dialog, importing, onClose, onDocTitleChange, onConfirm } = props;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">确认导入这一课</h2>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        将导入这一课；这会创建教材数据。不是整本教材导入；不会继续接力导入后续章节。
      </p>
      <div className="space-y-1.5 text-[11px] text-stone-600 dark:text-stone-300">
        <p className="font-bold text-stone-800 dark:text-stone-100">{dialog.lessonTitle}</p>
        <p>
          印刷 {dialog.printedStart} 页 · PDF 物理 {dialog.physicalFrom}–
          {dialog.physicalTo} 页（共 {dialog.pages} 页）
        </p>
        <p>将创建新教材 document（单课本，含 1 课）。</p>
        <label className="block space-y-1">
          <span className="font-bold">新教材标题</span>
          <input
            type="text"
            aria-label="新教材标题"
            value={dialog.docTitle}
            onChange={(e) => onDocTitleChange(e.target.value)}
            className={`${inputClassName} w-full`}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px]"
          disabled={importing}
          onClick={onConfirm}
        >
          {importing ? '导入中…' : '确认导入'}
        </Button>
      </div>
    </div>
  );
}

/** 容器：TanStack 异步 + 本地 anchor 状态；确认/预览外唯一的写路径是单课导入确认。 */
export function TocAnchorPanel({ file, filePath, entries }: TocAnchorPanelProps): React.ReactElement {
  const [flow, dispatch] = useReducer(anchorFlowReducer, initialAnchorFlowState);
  const [importTarget, setImportTarget] = useState<{ lessonIndex: number; docTitle: string } | null>(null);
  const folio = useFolioCandidatesMutation();
  const preview = usePreviewTocSegmentsMutation();
  const lessonImport = useImportTocLessonMutation();

  const source: TocPdfSource | null = file
    ? { file }
    : filePath.trim()
      ? { filePath: filePath.trim() }
      : null;

  const checkValidation = parseAnchorCheckPages(flow.checkText);
  const buildValidation = buildPreviewEntries(
    entries.map((e) => ({ title: e.title, printedPage: e.printedPage, level: e.level, kind: e.kind }))
  );
  const corroborated = folio.data ? findCorroboratedFolios(folio.data.pages) : [];
  const previewValid =
    flow.previewSig !== null &&
    flow.previewSig === fingerprintAnchors(flow.anchors) &&
    preview.data !== undefined;
  const importGates: LessonImportGateView[] = (preview.data && previewValid
    ? preview.data.lessons
    : []
  ).map((lesson) => ({
    lessonIndex: lesson.lessonIndex,
    ok: decideLessonImport(preview.data ?? null, previewValid, lesson.lessonIndex).ok,
  }));

  const handleCheck = (): void => {
    if (!source || folio.isPending) return;
    const decision = parseAnchorCheckPages(flow.checkText);
    if (!decision.ok) return;
    folio.reset();
    folio.mutate({ source, pageNumbers: decision.pages });
  };

  const handleConfirmAnchor = (physicalPage: number, candidateIndex: number): void => {
    const page = folio.data?.pages.find((p) => p.physicalPage === physicalPage);
    const candidate: FolioCandidateData | undefined = page?.candidates[candidateIndex];
    if (!candidate) return;
    const decision = decideAnchorConfirm(candidate, physicalPage, flow.anchors);
    if (!decision.ok) return;
    dispatch({ type: 'confirm-anchor', anchor: decision.anchor });
  };

  const handleRemoveAnchor = (printedPage: number): void => {
    dispatch({ type: 'remove-anchor', printedPage });
    preview.reset();
  };

  const handleRequestPreview = (): void => {
    if (!source || preview.isPending || flow.anchors.length === 0) return;
    const built = buildPreviewEntries(
      entries.map((e) => ({ title: e.title, printedPage: e.printedPage, level: e.level, kind: e.kind }))
    );
    if (!built.ok) return;
    preview.reset();
    dispatch({ type: 'preview-requested', sig: fingerprintAnchors(flow.anchors) });
    preview.mutate({
      source,
      entries: built.entries,
      anchors: flow.anchors.map((a) => ({
        printedPage: a.printedPage,
        physicalPage: a.physicalPage,
        evidence: a.evidence,
      })),
    });
  };

  const handleSelectLessonImport = (lessonIndex: number): void => {
    const decision = decideLessonImport(preview.data ?? null, previewValid, lessonIndex);
    if (!decision.ok) return;
    lessonImport.reset();
    setImportTarget({ lessonIndex, docTitle: decision.lesson.title });
  };

  const handleCloseImportDialog = (): void => {
    // 取消只关弹窗，不发任何请求。
    setImportTarget(null);
  };

  const handleConfirmImport = (): void => {
    if (!source || lessonImport.isPending || !importTarget || !preview.data) return;
    if (!buildValidation.ok) return;
    const decision = decideLessonImport(preview.data, previewValid, importTarget.lessonIndex);
    if (!decision.ok) return;
    lessonImport.mutate({
      source,
      entries: buildValidation.entries,
      anchors: flow.anchors.map((a) => ({
        printedPage: a.printedPage,
        physicalPage: a.physicalPage,
        evidence: a.evidence,
      })),
      lessonIndex: importTarget.lessonIndex,
      fingerprint: preview.data.fingerprint,
      ...(importTarget.docTitle.trim() ? { docTitle: importTarget.docTitle.trim() } : {}),
    });
  };

  const importDialog: ImportDialogView | null = (() => {
    if (!importTarget || !preview.data) return null;
    const decision = decideLessonImport(preview.data, previewValid, importTarget.lessonIndex);
    if (!decision.ok) return null;
    const { lesson } = decision;
    if (lesson.physicalStart === null || lesson.physicalEnd === null) return null;
    return {
      lessonIndex: lesson.lessonIndex,
      lessonTitle: lesson.title,
      printedStart: lesson.printedStart,
      physicalFrom: lesson.physicalStart,
      physicalTo: lesson.physicalEnd,
      pages: lesson.physicalEnd - lesson.physicalStart + 1,
      docTitle: importTarget.docTitle,
    };
  })();

  return (
    <TocAnchorPanelView
      hasSource={source !== null}
      checkText={flow.checkText}
      checkError={!checkValidation.ok && flow.checkText !== '' ? checkValidation.message : null}
      checking={folio.isPending}
      folioError={messageOf(folio.error)}
      folio={folio.data ?? null}
      corroborated={corroborated}
      anchors={flow.anchors}
      previewBuildError={!buildValidation.ok ? buildValidation.message : null}
      requestingPreview={preview.isPending}
      previewError={messageOf(preview.error)}
      preview={preview.data ?? null}
      previewValid={previewValid}
      importGates={importGates}
      importDialog={importDialog}
      importing={lessonImport.isPending}
      importError={messageOf(lessonImport.error)}
      importResult={lessonImport.data ?? null}
      onCheckTextChange={(value) => dispatch({ type: 'set-check-text', text: value })}
      onCheckFolio={handleCheck}
      onConfirmAnchor={handleConfirmAnchor}
      onRemoveAnchor={handleRemoveAnchor}
      onRequestPreview={handleRequestPreview}
      onSelectLessonImport={handleSelectLessonImport}
      onCloseImportDialog={handleCloseImportDialog}
      onDocTitleChange={(value) =>
        setImportTarget((prev) => (prev ? { ...prev, docTitle: value } : prev))
      }
      onConfirmImport={handleConfirmImport}
    />
  );
}
