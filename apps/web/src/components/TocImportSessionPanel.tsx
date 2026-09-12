import React, { useState } from 'react';
import { CalendarClock, CirclePlay, ListOrdered } from 'lucide-react';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Dialog,
  DialogContent,
} from './ui/dialog.js';
import {
  useExecuteSessionChunkMutation,
  usePrepareSessionMutation,
  useSessionStatusQuery,
  type TocPdfSource,
} from '../queries/useLearnerQueries.js';
import {
  buildPreviewEntries,
} from '../lib/toc-anchor-flow.js';
import type { EditableTocEntry } from '../lib/toc-confirm-flow.js';
import type { LocalAnchor, PreviewResponseData } from '../lib/toc-anchor-flow.js';
import {
  decideChunkExecute,
  decideSessionPrepare,
  sessionChunkStatusLabel,
  sessionStatusLabel,
  type SessionExecuteResult,
  type SessionView,
} from '../lib/toc-import-session-flow.js';

/**
 * CMD-LINGUA-P5D2D：import session 准备 / 查看 / 手动执行下一课。
 *
 * - 准备：preview 全部可执行才显示按钮；Dialog 明示“只建计划不导内容”；
 *   同 key 重试显示 reused，不重复制造计划；
 * - 执行：只认服务端指定的 next，一次一课；无 documentId 走 execute-first，
 *   否则 execute-next；pending 禁重复；成功刷新 status，失败只显 userMessage；
 * - sessionId / 快照只活在组件 state，刷新即失；恢复靠同 plan 重 prepare；
 * - 无整书/连续/后台/重试按钮；旧导入链路不动。
 */

export interface TocImportSessionPanelProps {
  file: File | null;
  filePath: string;
  entries: EditableTocEntry[];
  anchors: LocalAnchor[];
  preview: PreviewResponseData | null;
  previewValid: boolean;
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

const inputClassName =
  'h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500 text-[11px]';

export interface SessionExecuteDialogView {
  lessonTitle: string;
  printedStart: number;
  physicalFrom: number;
  physicalTo: number;
  pages: number;
}

export interface TocImportSessionPanelViewProps {
  prepareVisible: boolean;
  prepareBlockReason: string | null;
  prepareDialogOpen: boolean;
  docTitle: string;
  preparing: boolean;
  prepareError: string | null;
  session: SessionView | null;
  sessionLoading: boolean;
  sessionError: string | null;
  reusedNote: boolean;
  chunkBlockReasons: Array<{ ordinal: number; message: string }>;
  executeDialog: SessionExecuteDialogView | null;
  executing: boolean;
  executeError: string | null;
  executeResult: SessionExecuteResult | null;
  onOpenPrepareDialog(): void;
  onClosePrepareDialog(): void;
  onDocTitleChange(value: string): void;
  onConfirmPrepare(): void;
  onSelectChunkExecute(ordinal: number): void;
  onCloseExecuteDialog(): void;
  onConfirmExecute(): void;
}

/** 纯展示视图（无 hooks）：session 各态经 props 注入，供 SSR 单测直渲。 */
export function TocImportSessionPanelView(props: TocImportSessionPanelViewProps): React.ReactElement {
  const {
    prepareVisible,
    prepareBlockReason,
    prepareDialogOpen,
    docTitle,
    preparing,
    prepareError,
    session,
    sessionLoading,
    sessionError,
    reusedNote,
    chunkBlockReasons,
    executeDialog,
    executing,
    executeError,
    executeResult,
    onOpenPrepareDialog,
    onClosePrepareDialog,
    onDocTitleChange,
    onConfirmPrepare,
    onSelectChunkExecute,
    onCloseExecuteDialog,
    onConfirmExecute,
  } = props;
  const blockReasonOf = (ordinal: number): string | null =>
    chunkBlockReasons.find((b) => b.ordinal === ordinal)?.message ?? null;
  return (
    <div className="space-y-2 pt-1 mt-1 border-t border-line-emerald-500o20">
      <p className="text-[11px] font-bold text-ink-mute-deep flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5 text-tone-emerald-600" />
        导入会话（可恢复计划，一次只导一课）
      </p>
      <p className="text-[11px] text-ink-ghost">
        刷新后状态丢失；用同一 PDF 与同一确认结果重新准备，可回到同一 session（reused）；plan 不同即新会话，不复用旧进度。
      </p>
      {prepareVisible ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            disabled={preparing}
            onClick={onOpenPrepareDialog}
          >
            <ListOrdered className="w-3.5 h-3.5 text-tone-emerald-600" />
            <span>{preparing ? '准备中…' : '准备导入会话'}</span>
          </Button>
        </div>
      ) : (
        prepareBlockReason && (
          <p className="text-[11px] text-ink-stone-400">{prepareBlockReason}</p>
        )
      )}
      {prepareError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {prepareError}
        </p>
      )}
      {sessionLoading && <p className="text-[11px] text-ink-stone-400">读取会话状态…</p>}
      {sessionError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {sessionError}
        </p>
      )}
      {session && (
        <div className="rounded-xl border border-line-emerald-500o25 bg-wash-emerald-500o5 p-2 space-y-1.5">
          <p className="text-[11px] font-bold text-ink-mute-deep flex flex-wrap items-center gap-1.5">
            <Badge variant="emerald" className="text-[10px]">
              {sessionStatusLabel(session.status)}
            </Badge>
            <span>
              {session.completedChunks}/{session.totalChunks} 课已完成
            </span>
            {session.documentId ? (
              <span className="font-mono font-normal text-ink-stone-500">目标 {session.documentId}</span>
            ) : (
              <span className="font-normal text-ink-stone-400">暂无目标教材</span>
            )}
          </p>
          {reusedNote && (
            <p className="text-[11px] text-ink-ghost">
              已找到相同计划的会话，未重复创建（reused）。
            </p>
          )}
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {session.chunks.map((chunk) => {
              const blocked = blockReasonOf(chunk.ordinal);
              const isNext = session.next?.ordinal === chunk.ordinal;
              return (
                <div
                  key={chunk.ordinal}
                  className="flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg bg-veil-whiteo60-stone-900o40 text-[11px]"
                >
                  <span className="font-mono text-ink-stone-400">#{chunk.ordinal}</span>
                  <span className="font-semibold truncate">{chunk.lessonTitle}</span>
                  <span className="font-mono text-ink-stone-400">
                    物{chunk.range.fromPage}–{chunk.range.toPage}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {sessionChunkStatusLabel(chunk.status)}
                  </Badge>
                  {chunk.attempts > 0 && (
                    <span className="text-[10px] text-ink-stone-400">尝试 {chunk.attempts} 次</span>
                  )}
                  {isNext && session.next && !blocked && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      disabled={executing}
                      onClick={() => onSelectChunkExecute(chunk.ordinal)}
                    >
                      <CirclePlay className="w-3 h-3" />
                      导入下一课
                    </Button>
                  )}
                  {blocked && <span className="text-[10px] text-ink-stone-400">{blocked}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {executeError && (
        <p role="alert" className="text-[11px] font-semibold text-ink-rose-600-rose-400">
          {executeError}
        </p>
      )}
      {executeResult && (
        <div className="p-2 rounded-xl border border-line-emerald-500o30 bg-wash-emerald-500o5 text-[11px] text-ink-faint space-y-1">
          <p className="font-bold">已导入：{executeResult.lessonTitle}</p>
          <p className="font-mono text-[10px]">
            document {executeResult.documentId} · lesson {executeResult.lessonId} · 物理{' '}
            {executeResult.range.fromPage}–{executeResult.range.toPage} 页
          </p>
          <p>仅导入这一课，未自动继续下一课。</p>
        </div>
      )}
      <Dialog open={executeDialog !== null} onOpenChange={(open) => !open && onCloseExecuteDialog()}>
        <DialogContent className="max-w-md" showCloseButton>
          {executeDialog && (
            <SessionExecuteDialogContent
              dialog={executeDialog}
              executing={executing}
              onClose={onCloseExecuteDialog}
              onConfirm={onConfirmExecute}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={prepareDialogOpen} onOpenChange={(open) => !open && onClosePrepareDialog()}>
        <DialogContent className="max-w-md" showCloseButton>
          <SessionPrepareDialogContent
            docTitle={docTitle}
            preparing={preparing}
            onClose={onClosePrepareDialog}
            onDocTitleChange={onDocTitleChange}
            onConfirm={onConfirmPrepare}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 准备 Dialog 内容（纯展示，不依赖 Dialog context，可直测）。 */
export function SessionPrepareDialogContent(props: {
  docTitle: string;
  preparing: boolean;
  onClose(): void;
  onDocTitleChange(value: string): void;
  onConfirm(): void;
}): React.ReactElement {
  const { docTitle, preparing, onClose, onDocTitleChange, onConfirm } = props;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-ink">准备导入会话</h2>
      <p className="text-[11px] text-ink-ghost">
        这会创建可恢复导入计划，但不会立刻导入教材内容。同一计划重复准备将复用同一会话。
      </p>
      <label className="block space-y-1 text-[11px] text-ink-faint">
        <span className="font-bold">新教材标题（首课落库时使用）</span>
        <input
          type="text"
          aria-label="新教材标题"
          value={docTitle}
          onChange={(e) => onDocTitleChange(e.target.value)}
          className={`${inputClassName} w-full`}
        />
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button type="button" size="sm" className="h-7 text-[11px]" disabled={preparing} onClick={onConfirm}>
          {preparing ? '准备中…' : '确认创建'}
        </Button>
      </div>
    </div>
  );
}

/** 执行 Dialog 内容（纯展示，不依赖 Dialog context，可直测）。 */
export function SessionExecuteDialogContent(props: {
  dialog: SessionExecuteDialogView;
  executing: boolean;
  onClose(): void;
  onConfirm(): void;
}): React.ReactElement {
  const { dialog, executing, onClose, onConfirm } = props;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-ink">导入下一课</h2>
      <p className="text-[11px] text-ink-ghost">
        仅导入这一课，不会自动继续下一课。
      </p>
      <div className="space-y-1 text-[11px] text-ink-faint">
        <p className="font-bold text-ink-deep">{dialog.lessonTitle}</p>
        <p>
          印刷 {dialog.printedStart} 页 · PDF 物理 {dialog.physicalFrom}–
          {dialog.physicalTo} 页（共 {dialog.pages} 页）
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClose}>
          取消
        </Button>
        <Button type="button" size="sm" className="h-7 text-[11px]" disabled={executing} onClick={onConfirm}>
          {executing ? '导入中…' : '确认导入'}
        </Button>
      </div>
    </div>
  );
}

/** 容器：TanStack 异步 + 本地会话 state；无自动执行路径。 */
export function TocImportSessionPanel(props: {
  file: File | null;
  filePath: string;
  entries: EditableTocEntry[];
  anchors: LocalAnchor[];
  preview: PreviewResponseData | null;
  previewValid: boolean;
}): React.ReactElement {
  const { file, filePath, entries, anchors, preview, previewValid } = props;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    entries: Array<{ title: string; printedPage: number; level: number; kind: 'lesson' | 'section' }>;
    anchors: Array<{ printedPage: number; physicalPage: number; evidence: 'human-confirmed' }>;
    fingerprint: string;
    docTitle: string;
  } | null>(null);
  const [prepareDialogOpen, setPrepareDialogOpen] = useState(false);
  const [docTitleText, setDocTitleText] = useState('');
  const [reusedNote, setReusedNote] = useState(false);
  const [executeOrdinal, setExecuteOrdinal] = useState<number | null>(null);
  const prepare = usePrepareSessionMutation();
  const status = useSessionStatusQuery(sessionId);
  const execute = useExecuteSessionChunkMutation();

  const source: TocPdfSource | null = file
    ? { file }
    : filePath.trim()
      ? { filePath: filePath.trim() }
      : null;

  const prepareDecision = decideSessionPrepare(preview, previewValid);
  const sessionView = status.data ?? null;
  const chunkBlockReasons: Array<{ ordinal: number; message: string }> = [];
  if (sessionView?.next) {
    const gate = decideChunkExecute(sessionView, preview, previewValid, sessionView.next.ordinal);
    if (!gate.ok) {
      chunkBlockReasons.push({ ordinal: sessionView.next.ordinal, message: gate.message });
    }
  } else if (sessionView) {
    // 无 next：终态/全完成，整块给原因（ordinal -1 表示会话级）。
    const states: Record<string, string> = {
      target_deleted: '目标已删除，该会话不可恢复、不可执行',
      failed: '会话已失败，请检查后重新准备',
      cancelled: '会话已取消，不可执行',
      completed: '会话已完成，无可执行分段',
    };
    const message = states[sessionView.status] ?? '当前无可执行分段';
    chunkBlockReasons.push({ ordinal: -1, message });
  }

  const handleConfirmPrepare = (): void => {
    if (!source || prepare.isPending) return;
    const built = buildPreviewEntries(
      entries.map((e) => ({ title: e.title, printedPage: e.printedPage, level: e.level, kind: e.kind }))
    );
    if (!built.ok || !preview || !preview.fingerprint) return;
    const snap = {
      entries: built.entries,
      anchors: anchors.map((a) => ({
        printedPage: a.printedPage,
        physicalPage: a.physicalPage,
        evidence: a.evidence,
      })),
      fingerprint: preview.fingerprint,
      docTitle: docTitleText.trim(),
    };
    prepare.mutate(
      {
        source,
        entries: snap.entries,
        anchors: snap.anchors,
        fingerprint: snap.fingerprint,
        ...(snap.docTitle ? { docTitle: snap.docTitle } : {}),
      },
      {
        onSuccess: (data) => {
          setSessionId(data.sessionId);
          setSnapshot(snap);
          setReusedNote(data.reused);
          setPrepareDialogOpen(false);
        },
      }
    );
  };

  const handleSelectChunkExecute = (ordinal: number): void => {
    if (!sessionView) return;
    const gate = decideChunkExecute(sessionView, preview, previewValid, ordinal);
    if (!gate.ok) return;
    execute.reset();
    setExecuteOrdinal(ordinal);
  };

  const executeDialog: SessionExecuteDialogView | null = (() => {
    if (executeOrdinal === null || !sessionView) return null;
    const gate = decideChunkExecute(sessionView, preview, previewValid, executeOrdinal);
    if (!gate.ok) return null;
    return {
      lessonTitle: gate.lesson.title,
      printedStart: gate.lesson.printedStart,
      physicalFrom: gate.chunk.range.fromPage,
      physicalTo: gate.chunk.range.toPage,
      pages: gate.chunk.range.toPage - gate.chunk.range.fromPage + 1,
    };
  })();

  const handleConfirmExecute = (): void => {
    if (!source || execute.isPending || executeOrdinal === null || !sessionView || !snapshot) return;
    const gate = decideChunkExecute(sessionView, preview, previewValid, executeOrdinal);
    if (!gate.ok) return;
    execute.mutate(
      {
        sessionId: sessionView.sessionId,
        source,
        entries: snapshot.entries,
        anchors: snapshot.anchors,
        fingerprint: snapshot.fingerprint,
        ...(snapshot.docTitle ? { docTitle: snapshot.docTitle } : {}),
        first: !sessionView.documentId,
      },
      {
        onSuccess: () => {
          setExecuteOrdinal(null);
          void status.refetch();
        },
      }
    );
  };

  return (
    <TocImportSessionPanelView
      prepareVisible={prepareDecision.ok}
      prepareBlockReason={prepareDecision.ok ? null : prepareDecision.message}
      prepareDialogOpen={prepareDialogOpen}
      docTitle={docTitleText}
      preparing={prepare.isPending}
      prepareError={messageOf(prepare.error)}
      session={sessionView}
      sessionLoading={status.isPending}
      sessionError={messageOf(status.error)}
      reusedNote={reusedNote}
      chunkBlockReasons={chunkBlockReasons}
      executeDialog={executeDialog}
      executing={execute.isPending}
      executeError={messageOf(execute.error)}
      executeResult={execute.data ?? null}
      onOpenPrepareDialog={() => {
        if (!prepareDecision.ok) return;
        setDocTitleText('');
        setPrepareDialogOpen(true);
      }}
      onClosePrepareDialog={() => setPrepareDialogOpen(false)}
      onDocTitleChange={setDocTitleText}
      onConfirmPrepare={handleConfirmPrepare}
      onSelectChunkExecute={handleSelectChunkExecute}
      onCloseExecuteDialog={() => setExecuteOrdinal(null)}
      onConfirmExecute={handleConfirmExecute}
    />
  );
}
