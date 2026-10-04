import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

export function TocDirectoryEntries({ entries, editing, pending, onUpdate, onLevel, onRemove }: {
  entries: TocRecognitionCandidate[]; editing: boolean; pending: boolean;
  onUpdate: (key: string, patch: Partial<TocRecognitionCandidate>) => void;
  onLevel: (key: string, level: 1 | 2) => void; onRemove: (key: string) => void;
}) {
  return <div className="max-h-72 space-y-2 overflow-y-auto" aria-label="目录层级列表">{entries.map((entry, index) => <div key={entry.key} className={`rounded-xl border border-line-soft bg-paper-soft p-3 ${entry.level === 2 ? 'ml-5 border-l-2 border-l-line-accent' : ''}`}>
    {editing ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_5rem_auto]">
      <input aria-label={`目录标题 ${index + 1}`} value={entry.title} disabled={pending} onChange={event => onUpdate(entry.key, { title: event.target.value })} className="min-w-0 rounded-lg border border-line bg-surface p-2" />
      <input aria-label={`印刷页码 ${index + 1}`} inputMode="numeric" value={entry.printedPage} disabled={pending} onChange={event => onUpdate(entry.key, { printedPage: event.target.value })} className="min-w-0 rounded-lg border border-line bg-surface p-2" />
      <Select value={entry.directoryLevel ?? entry.kind} disabled={pending} onValueChange={value => {
        if (value === 'unit' || value === 'chapter' || value === 'lesson' || value === 'section') onUpdate(entry.key, { kind: value === 'lesson' ? 'lesson' : 'section', directoryLevel: value });
      }}>
        <SelectTrigger aria-label={`目录类型 ${index + 1}`}><SelectValue>{entry.directoryLevel === 'unit' ? '单元' : entry.directoryLevel === 'chapter' ? '章' : entry.kind === 'lesson' ? '课' : '小节'}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="unit">单元</SelectItem><SelectItem value="chapter">章</SelectItem><SelectItem value="lesson">课</SelectItem><SelectItem value="section">小节</SelectItem></SelectContent>
      </Select>
      <Select value={String(entry.level)} disabled={pending} onValueChange={value => { if (value === '1' || value === '2') onLevel(entry.key, value === '1' ? 1 : 2); }}>
        <SelectTrigger aria-label={`目录层级 ${index + 1}`}><SelectValue>{entry.level === 1 ? '一级标题' : '子标题'}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="1">一级标题</SelectItem><SelectItem value="2" disabled={!entries.slice(0, index).some(item => item.level === 1)}>子标题</SelectItem></SelectContent>
      </Select>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => onRemove(entry.key)}>移除</Button>
    </div> : <div className="flex items-start justify-between gap-4"><span className={entry.level === 1 ? 'font-medium' : 'text-ink-muted'}>{entry.level === 2 && <span aria-hidden="true">↳ </span>}{entry.title}</span><span className="shrink-0 text-xs text-ink-muted">印刷页 {entry.printedPage || '待填写'}</span></div>}
  </div>)}</div>;
}
