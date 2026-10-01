import { z } from 'zod';
import { ContentDirectoryNodeSchema } from '@study-studio/document-model';
const inputSchema = z.object({ message: z.string(), systemPrompt: z.string().optional(), model: z.string().nullable().optional(), effort: z.string().nullable().optional(), tocEntries: z.array(ContentDirectoryNodeSchema).optional(), tocPath: z.array(ContentDirectoryNodeSchema).optional(), attachments: z.array(z.object({ label: z.string().optional(), pngBase64: z.string() })).optional() });
export function ModelInputView({ detail }: { detail: unknown }) {
  const parsed = inputSchema.safeParse(detail);
  if (!parsed.success) return null;
  const value = parsed.data;
  return <section className="space-y-2" data-testid="model-input-view">
    <p>模型 {value.model ?? '运行时默认'} · 思考等级 {value.effort ?? '运行时默认'} · 原页附件 {value.attachments?.length ?? 0} 张</p>
    {value.tocEntries ? <details data-testid="sent-directory"><summary className="cursor-pointer">目录已随本轮输入发送 · {value.tocEntries.length} 项</summary>
      <p className="mt-2">所属路径：{value.tocPath?.map(node => node.title).join(' / ') || '根目录'}</p>
      <div className="mt-2 overflow-auto"><table className="w-full text-left"><thead><tr><th>目录项</th><th>层级 / 父节点</th><th>PDF 物理页</th></tr></thead><tbody>{value.tocEntries.map(node => <tr key={node.id}><td className="py-1">{node.title}<span className="block text-ink-muted">{node.id}</span></td><td>{node.level} / {node.parentId ?? '根节点'}</td><td>{node.startPage ?? '未提供'}–{node.endPage ?? '未提供'}</td></tr>)}</tbody></table></div>
    </details> : <p className="text-ink-muted">本轮未捕获独立目录快照；请在实际提示词中核对目录。</p>}
    <p className="text-ink-muted">以下是应用实际发送的本轮输入。线程会保留此前交互；引擎内置提示词与内部历史压缩未由接口返回。</p>
    {value.systemPrompt && <details><summary className="cursor-pointer">实际系统提示词</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{value.systemPrompt}</pre></details>}
    <details open><summary className="cursor-pointer">实际章节提示词</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{value.message}</pre></details>
    {value.attachments?.map((image, index) => <details key={index}><summary className="cursor-pointer">原页附件 · {image.label ?? index + 1}</summary><img src={'data:image/png;base64,' + image.pngBase64} alt={image.label ?? '当前输入原页'} className="max-h-96 max-w-full object-contain" /></details>)}
  </section>;
}
