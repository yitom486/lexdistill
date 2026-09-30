import { useState } from 'react';
import type { ImportEvent } from '@study-studio/document-model';
import { useImportEventDetail } from '../../../queries/textbook-import-monitor.js';

export function ImportEventDetail({ event, expanded = false }: { event: ImportEvent; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const query = useImportEventDetail(event.userId, event.traceId, event.sequence, open);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border border-line-soft p-2">
    <summary className="cursor-pointer text-ink">{event.occurredAt.slice(11, 23)} · {event.name}{event.callId ? ` · ${event.callId}` : ''}</summary>
    {open && <div className="mt-2 space-y-2">
      {query.isPending ? <p>正在读取详情…</p> : query.isError ? <p role="alert">{query.error.message}</p> :
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-muted">{JSON.stringify(query.data?.detail, null, 2)}</pre>}
    </div>}
  </details>;
}
