import { z } from 'zod';
const inputSchema = z.object({ message: z.string(), systemPrompt: z.string().optional(), model: z.string().nullable().optional(), effort: z.string().nullable().optional() });
export function ModelInputView({ detail }: { detail: unknown }) {
 const parsed=inputSchema.safeParse(detail);if(!parsed.success)return null;const value=parsed.data;
 return <section className="space-y-2" data-testid="model-input-view">
  <p>模型 {value.model ?? '运行时默认'} · 思考等级 {value.effort ?? '运行时默认'}</p>
  <p className="text-ink-muted">以下是应用实际发送的本轮输入：章节标题、教材内容和工具名称。线程会保留此前交互；引擎内置提示词与历史压缩未由接口返回。</p>
  {value.systemPrompt && <details><summary className="cursor-pointer">实际系统提示词</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{value.systemPrompt}</pre></details>}
  <details open><summary className="cursor-pointer">实际章节提示词与材料</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{value.message}</pre></details>
 </section>;
}
