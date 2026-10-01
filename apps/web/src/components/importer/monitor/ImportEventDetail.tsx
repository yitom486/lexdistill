import { useState } from 'react';
import { LessonSubmissionSchema, type ImportEvent, type ContentDirectoryNode } from '@study-studio/document-model';
import { useImportEventDetail } from '../../../queries/textbook-import-monitor.js';
import { ContentResultView } from './ContentResultView.js';
import { ChapterSourceView } from './ChapterSourceView.js';
import { ModelInputView } from './ModelInputView.js';

export function ImportEventDetail({ event, expanded = false, directory = [] }: { event: ImportEvent; expanded?: boolean; directory?: readonly ContentDirectoryNode[] }) {
  const [open, setOpen] = useState(expanded);
  const query = useImportEventDetail(event.userId, event.traceId, event.sequence, open);
  const candidate = event.category === 'tool' && event.name === 'candidate' ? LessonSubmissionSchema.safeParse(query.data?.detail) : undefined;
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border border-line-soft p-2">
    <summary className="cursor-pointer text-ink">{event.occurredAt.slice(11, 23)} · {event.name}{event.callId ? ` · ${event.callId}` : ''}</summary>
    {open && <div className="mt-2 space-y-2">
      {query.isPending ? <p>正在读取详情…</p> : query.isError ? <p role="alert">{query.error.message}</p> : <>
        {candidate?.success && <section className="space-y-2"><h4 className="font-semibold">模型提交候选 · 尚不能据此认定已保存</h4><p>教材 {candidate.data.documentId} · 节点 {candidate.data.lessonId} · 尝试 {candidate.data.assignmentId}</p><ContentResultView content={candidate.data.content} directory={directory} /></section>}
        {event.category === 'text' && event.name === 'ready' && <ChapterSourceView detail={query.data?.detail} />}
        {event.category === 'model' && event.name === 'input' && <ModelInputView detail={query.data?.detail} />}
        <details open={(!candidate?.success && !(event.category === 'model' && event.name === 'input')) || undefined}><summary className="cursor-pointer">实际记录字段</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-muted">{JSON.stringify(query.data?.detail, null, 2)}</pre></details>
      </>}
    </div>}
  </details>;
}
