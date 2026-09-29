import { useState } from 'react';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { useMapPdfMutation } from '../../queries/useLearnerQueries.js';
import type { PdfAzureCredential } from '../../queries/textbooks-annotations.js';
import { nextManualKey } from '../../lib/toc-confirm-flow.js';
import {
  parseTocScanRange,
  tocCandidatesFromMap,
  validateTocCandidates,
  type TocRecognitionCandidate,
} from '../../lib/toc-recognition.js';

interface TocRecognitionPanelProps {
  file: File | null;
  filePath: string;
  azure?: PdfAzureCredential;
}

export function TocRecognitionPanel({ file, filePath, azure }: TocRecognitionPanelProps) {
  const map = useMapPdfMutation();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [entries, setEntries] = useState<TocRecognitionCandidate[]>([]);
  const [scanned, setScanned] = useState(false);
  const [outlineSource, setOutlineSource] = useState<'embedded' | 'none'>('none');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hasSource = Boolean(file || filePath.trim());

  const clearScan = () => {
    setEntries([]);
    setScanned(false);
    setConfirmed(false);
    setMessage(null);
  };
  const invalidate = () => {
    setConfirmed(false);
    setMessage(null);
  };
  const updateEntry = (key: string, patch: Partial<TocRecognitionCandidate>) => {
    setEntries((previous) => previous.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
    invalidate();
  };
  const scan = () => {
    if (!hasSource || map.isPending) return;
    const range = parseTocScanRange(start, end);
    if (!range.ok) {
      setMessage(range.message);
      return;
    }
    clearScan();
    const source = file ? { file } : { filePath: filePath.trim() };
    map.mutate(
      { ...source, ...(range.startPage !== undefined ? { startPage: range.startPage, endPage: range.endPage } : {}), ...(azure ? { azure } : {}) },
      {
        onSuccess: (result) => {
          const candidates = tocCandidatesFromMap(result);
          setEntries(candidates);
          setOutlineSource(result.outlineSource === 'embedded' ? 'embedded' : 'none');
          setScanned(true);
          if (candidates.length === 0) setMessage('未找到可确认的目录条目。请指定实际目录页，或手动添加条目。');
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '目录识别失败，请重试'),
      },
    );
  };
  const confirm = () => {
    const error = validateTocCandidates(entries);
    if (error) {
      setMessage(error);
      return;
    }
    setMessage(null);
    setConfirmed(true);
  };

  return (
    <div className="space-y-3 text-[11px] text-ink-mute-deep">
      <div>
        <p className="font-bold">目录识别与人工确认</p>
        <p className="text-ink-ghost">先读取 PDF 内嵌目录；没有可用内嵌目录时，提取所选页面的文字或 OCR 目录。确认前不写入教材。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          PDF 目录页
          <input aria-label="目录起始 PDF 页" inputMode="numeric" value={start} disabled={map.isPending} onChange={(event) => { setStart(event.target.value); clearScan(); }} placeholder="起始" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-ink" />
          –
          <input aria-label="目录结束 PDF 页" inputMode="numeric" value={end} disabled={map.isPending} onChange={(event) => { setEnd(event.target.value); clearScan(); }} placeholder="结束" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-ink" />
        </label>
        <Button type="button" size="sm" variant="outline" disabled={!hasSource || map.isPending} onClick={scan}>
          {map.isPending ? '识别中…' : '识别目录'}
        </Button>
        <span className="text-ink-ghost">留空则预览前 30 页；扫描书请填目录所在页。</span>
      </div>
      {message && <p role="status" className="text-ink-amber-800-amber-400">{message}</p>}
      {scanned && (
        <>
          <p className="text-ink-ghost">
            {outlineSource === 'embedded' ? '来源：PDF 内嵌目录。这里只知道 PDF 物理页；请按书上页码填写印刷页。' : '来源：页面文字 / OCR 规则候选。请核对标题、印刷页码和成课类型。'}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {entries.map((entry, index) => (
              <div key={entry.key} className="grid grid-cols-1 gap-1 rounded-xl border border-line bg-surface p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_auto] sm:items-center">
                <input aria-label={`目录标题 ${index + 1}`} value={entry.title} onChange={(event) => updateEntry(entry.key, { title: event.target.value })} className="h-8 min-w-0 rounded-lg border border-line bg-surface px-2 text-ink" />
                <input aria-label={`印刷页码 ${index + 1}`} inputMode="numeric" value={entry.printedPage} onChange={(event) => updateEntry(entry.key, { printedPage: event.target.value })} placeholder="印刷页" className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-ink" />
                <Select value={entry.kind} onValueChange={(value) => { if (value === 'lesson' || value === 'section') updateEntry(entry.key, { kind: value }); }}>
                  <SelectTrigger aria-label={`目录类型 ${index + 1}`} className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="lesson">成课</SelectItem><SelectItem value="section">章节</SelectItem></SelectContent>
                </Select>
                <Select value={String(entry.level)} onValueChange={(value) => { if (value === '1' || value === '2') updateEntry(entry.key, { level: value === '1' ? 1 : 2 }); }}>
                  <SelectTrigger aria-label={`目录层级 ${index + 1}`} className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1">一级</SelectItem><SelectItem value="2">二级</SelectItem></SelectContent>
                </Select>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setEntries((previous) => previous.filter((item) => item.key !== entry.key)); invalidate(); }}>移除</Button>
                {entry.physicalPage !== undefined && <span className="text-ink-ghost sm:col-span-5">PDF 物理页 {entry.physicalPage}</span>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { setEntries((previous) => [...previous, { key: nextManualKey(previous), title: '', printedPage: '', level: 1, kind: 'lesson', confidence: null }]); invalidate(); }}>添加条目</Button>
            <Button type="button" size="sm" disabled={entries.length === 0 || confirmed} onClick={confirm}>确认目录</Button>
            {confirmed && <span className="text-ink-emerald-700-emerald-400">已确认 {entries.length} 条目录。</span>}
          </div>
        </>
      )}
    </div>
  );
}
