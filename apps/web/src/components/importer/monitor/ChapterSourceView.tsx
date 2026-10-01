import { ChapterSourceSchema } from '@study-studio/document-model';

export function ChapterSourceView({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== 'object' || !('source' in detail)) return null;
  if (detail.source === null && 'text' in detail && typeof detail.text === 'string') return <section data-testid="chapter-source"><h4 className="font-semibold">章节文字材料</h4><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{detail.text}</pre></section>;
  const result = ChapterSourceSchema.safeParse(detail.source);
  if (!result.success) return null;
  const source = result.data, pages = [...new Set(source.blocks.map(block => block.page))];
  return <section className="space-y-2" data-testid="chapter-source">
    <h4 className="font-semibold">章节解析材料 · {source.parser}</h4>
    <p>物理页 {pages.join('、')} · {source.blocks.length} 个内容块 · 表格 {source.blocks.filter(block => block.kind === 'TABLE').length} 个</p>
    <p className="text-ink-muted">以下是送入整理流程的解析材料，正式教材以工具成功提交后的保存版本为准。</p>
    {source.blocks.map(block => <details key={block.id} className="rounded-lg border border-line-soft p-2">
      <summary className="cursor-pointer">第 {block.page} 页 · {block.id} · {block.kind}{block.rows?.length ? ` · ${block.rows.length} 行` : ''}</summary>
      {block.bbox && <p className="text-ink-muted">原页位置 {block.bbox.join(' / ')}</p>}
      {block.rows?.length ? <div className="overflow-auto"><table className="w-full text-left"><tbody>{block.rows.map((row, index) => <tr key={index} className="border-b border-line-soft"><th className="p-2 font-normal text-ink-muted">行 {index}</th>{row.map((cell, column) => <td className="whitespace-pre-wrap p-2" key={column}>{cell}</td>)}</tr>)}</tbody></table></div> : <pre className="whitespace-pre-wrap break-words">{block.text || '图片块：参照模型输入的原页附件'}</pre>}
    </details>)}
  </section>;
}
