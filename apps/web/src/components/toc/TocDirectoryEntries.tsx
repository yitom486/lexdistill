import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

export function TocDirectoryEntries({ entries, editing, pending, onUpdate, onType, onLevel: _onLevel, onRemove }: {
  entries: TocRecognitionCandidate[]; editing: boolean; pending: boolean;
  onUpdate: (key: string, patch: Partial<TocRecognitionCandidate>) => void;
  onType?: ((key: string, type: 'unit' | 'lesson' | 'section') => void) | undefined;
  onLevel?: ((key: string, level: number) => void) | undefined;
  onRemove: (key: string) => void;
}) {
  return <div className="max-h-72 space-y-2 overflow-y-auto" aria-label="目录层级列表">{entries.map((entry, index) => {
    const indentClass = entry.level === 3 ? 'ml-10 border-l-4 border-l-line-accent' : entry.level === 2 ? 'ml-5 border-l-2 border-l-line-accent' : '';
    const prefix = entry.level === 3 ? '↳↳ ' : entry.level === 2 ? '↳ ' : '';
    const currentType = entry.directoryLevel === 'unit' ? 'unit' : (entry.directoryLevel === 'lesson' || entry.kind === 'lesson') ? 'lesson' : 'section';

    return <div key={entry.key} className={`rounded-xl border border-line-soft bg-paper-soft p-3 ${indentClass}`}>
      {editing ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_auto]">
        <input aria-label={`目录标题 ${index + 1}`} value={entry.title} disabled={pending} onChange={event => onUpdate(entry.key, { title: event.target.value })} className="min-w-0 rounded-lg border border-line bg-surface p-2" />
        <input aria-label={`印刷页码 ${index + 1}`} inputMode="numeric" value={entry.printedPage} disabled={pending} onChange={event => onUpdate(entry.key, { printedPage: event.target.value })} className="min-w-0 rounded-lg border border-line bg-surface p-2" />
        <Select value={currentType} disabled={pending} onValueChange={value => {
          if (value === 'unit' || value === 'lesson' || value === 'section') {
            if (onType) onType(entry.key, value);
            else onUpdate(entry.key, { kind: value === 'lesson' ? 'lesson' : 'section', directoryLevel: value });
          }
        }}>
          <SelectTrigger aria-label={`目录类型 ${index + 1}`}>
            <SelectValue>{currentType === 'unit' ? '单元' : currentType === 'lesson' ? '课' : '课内小节'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unit">单元</SelectItem>
            <SelectItem value="lesson">课</SelectItem>
            <SelectItem value="section">课内小节</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onRemove(entry.key)}>移除</Button>
      </div> : <div className="flex items-start justify-between gap-4">
        <span className={entry.level === 1 ? 'font-medium' : 'text-ink-muted'}>
          {prefix && <span aria-hidden="true">{prefix}</span>}
          {entry.title}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          {currentType === 'unit' ? '单元 · ' : currentType === 'lesson' ? '课 · ' : '节 · '}
          印刷页 {entry.printedPage || '待填写'}
        </span>
      </div>}
    </div>;
  })}</div>;
}
