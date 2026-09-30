import { useState } from 'react';
import type { TocRecognitionCandidate } from '../../lib/toc-recognition.js';
import { Button } from '../ui/button.js';

interface Props {
  entries: TocRecognitionCandidate[];
  onChange: (entries: TocRecognitionCandidate[]) => void;
}

/** 目录确认时已按目录结束页填入默认物理页；这里允许整体或逐项调整。 */
export function TextbookPageMapping({ entries, onChange }: Props) {
  const [firstPhysicalPage, setFirstPhysicalPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = entries[0];
  const physicalPageInput = firstPhysicalPage ?? String(first?.physicalPage ?? '');
  const applyOffset = () => {
    const physical = Number(physicalPageInput);
    const printed = Number(first?.printedPage);
    if (!Number.isSafeInteger(physical) || physical < 1 || !Number.isSafeInteger(printed) || printed < 1) {
      setError('请填写核对后的 PDF 实际页码'); return;
    }
    const offset = physical - printed;
    const mapped = entries.map((entry) => ({ ...entry, physicalPage: Number(entry.printedPage) + offset }));
    if (mapped.some((entry) => !Number.isSafeInteger(entry.physicalPage) || entry.physicalPage < 1)) {
      setError('换算后的页码无效，请逐条核对'); return;
    }
    setError(null); onChange(mapped);
  };
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs">
      <h3 className="font-semibold text-ink">正文的 PDF 页码</h3>
      <p className="text-ink-muted">目录识别后，默认按“印刷页码 + 目录结束页”填入 PDF 页码，可直接开始提取。需要调整时，可修改一组对应关系后换算；有插页或页码重新编号时，可逐条修改。</p>
      {first?.printedPage && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{first.title} · 印刷第 {first.printedPage} 页，对应 PDF 第</span>
          <input aria-label="第一条目录对应的 PDF 页" inputMode="numeric" value={physicalPageInput} onChange={(event) => setFirstPhysicalPage(event.target.value)} className="w-20 rounded-lg border border-line bg-surface p-2 text-ink" />
          <Button size="sm" variant="outline" onClick={applyOffset}>确认页码对应并换算</Button>
        </div>
      )}
      {error && <p role="alert" className="text-ink-rose-700-rose-400">{error}</p>}
      <div className="max-h-52 space-y-2 overflow-auto">
        {entries.map((entry) => (
          <label key={entry.key} className="flex items-center justify-between gap-2 text-ink">
            <span>{entry.title}（{entry.printedPage ? `印刷页 ${entry.printedPage}` : 'PDF 起始页'}）</span>
            <input aria-label={`${entry.title} PDF 起始页`} inputMode="numeric" value={entry.physicalPage ?? ''}
              onChange={(event) => onChange(entries.map((item) => item.key === entry.key ? { ...item, physicalPage: Number(event.target.value) } : item))}
              className="w-20 shrink-0 rounded-lg border border-line bg-surface p-2 text-ink" />
          </label>
        ))}
      </div>
      <p className="text-ink-muted">每课提取到下一课前一页；最后一课默认到文件末页，可在下方填写实际结束页，排除附录。</p>
      {entries.filter((entry) => entry.kind === 'lesson').slice(-1).map((last) => (
        <label key={last.key} className="flex items-center gap-2 text-ink">最后一课的 PDF 结束页（可选）
          <input aria-label="最后一课 PDF 结束页" inputMode="numeric" value={last.endPage ?? ''}
            onChange={(event) => onChange(entries.map((item) => {
              if (item.key !== last.key) return item;
              const { endPage: _previous, ...rest } = item;
              return event.target.value.trim() ? { ...rest, endPage: Number(event.target.value) } : rest;
            }))}
            className="w-20 rounded-lg border border-line bg-surface p-2 text-ink" />
        </label>
      ))}
    </section>
  );
}
