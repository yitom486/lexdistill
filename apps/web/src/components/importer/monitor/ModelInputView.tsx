import { z } from 'zod';

const inputSchema = z.object({
  message: z.string(), systemPrompt: z.string().optional(),
  model: z.string().nullable().optional(), effort: z.string().nullable().optional(),
  pdfFile: z.object({ path: z.string(), pageCount: z.number().int().positive(), originalPages: z.array(z.number().int().positive()),
    images: z.array(z.object({ page: z.number().int().positive(), originalPage: z.number().int().positive(), path: z.string() })).optional() }).optional(),
});
export function ModelInputView({ detail }: { detail: unknown }) {
  const parsed = inputSchema.safeParse(detail);
  if (!parsed.success) return null;
  const value = parsed.data;
  return <section className="space-y-3" data-testid="model-input-view">
    <p>模型 {value.model ?? '运行时默认'} · 思考等级 {value.effort ?? '运行时默认'}</p>
    {value.pdfFile ? <div className="space-y-1">
      <p>阅读材料：{value.pdfFile.path.split(/[/\\]/).at(-1)} · {value.pdfFile.pageCount} 页{(value.pdfFile.images?.length ?? 0) > 0 ? ` · 扫描版配图 ${value.pdfFile.images!.length} 张` : ''}</p>
      <p className="text-ink-muted">对应原教材物理页：{value.pdfFile.originalPages.join('、')}</p>
      <details open={false}><summary className="cursor-pointer">文件完整路径</summary><p className="break-all">{value.pdfFile.path}</p></details>
    </div> : <p className="text-ink-muted">此记录未提供 PDF 文件摘要；原始输入可在下方查看。</p>}
    <p className="text-ink-muted">本轮上下文包含章节任务、目录参考和阅读说明。Worker 保留历史；写入章节由系统绑定。</p>
    <details data-testid="raw-model-input" open={false}><summary className="cursor-pointer">查看完整输入</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-ink-muted">{value.message}</pre>
    </details>
    {value.systemPrompt && <details open={false}><summary className="cursor-pointer">查看系统提示词</summary>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-ink-muted">{value.systemPrompt}</pre>
    </details>}
  </section>;
}
