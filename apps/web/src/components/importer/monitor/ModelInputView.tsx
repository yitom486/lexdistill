import { z } from 'zod';
const inputSchema = z.object({ message: z.string(), systemPrompt: z.string().optional(), attachments: z.array(z.object({ label: z.string().optional(), pngBase64: z.string() })).optional() });
export function ModelInputView({ detail }: { detail: unknown }) {
  const parsed = inputSchema.safeParse(detail);
  if (!parsed.success) return null;
  const value = parsed.data;
  return <section className="space-y-2" data-testid="model-input-view">
    {value.systemPrompt && <details><summary className="cursor-pointer">实际系统提示词</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{value.systemPrompt}</pre></details>}
    <details open><summary className="cursor-pointer">实际章节提示词</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{value.message}</pre></details>
    {value.attachments?.map((image, index) => <details key={index}><summary className="cursor-pointer">原页附件 · {image.label ?? index + 1}</summary><img src={'data:image/png;base64,' + image.pngBase64} alt={image.label ?? '当前输入原页'} className="max-h-96 max-w-full object-contain" /></details>)}
  </section>;
}
