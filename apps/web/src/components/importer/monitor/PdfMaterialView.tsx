import { z } from 'zod';
const FileDetail = z.object({ path: z.string(), pageCount: z.number().int().positive(), originalPages: z.array(z.number().int().positive()), readerCommand: z.string() });
export function PdfMaterialView({ detail }: { detail: unknown }) {
  const file = FileDetail.safeParse(detail);
  if (file.success) return <section className="space-y-2">
    <h4 className="font-semibold">本轮章节 PDF · {file.data.pageCount} 页</h4>
    <p className="break-all">{file.data.path}</p>
    <p className="text-ink-muted">原教材物理页：{file.data.originalPages.join('、')}。模型通过本机文件阅读器读取，任务结束后清理临时文件。</p>
    <details><summary className="cursor-pointer">模型收到的读取命令</summary><pre className="overflow-auto whitespace-pre-wrap">{file.data.readerCommand}</pre></details>
  </section>;
  const text = z.object({ text: z.string() }).safeParse(detail);
  return text.success ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{text.data.text}</pre> : null;
}
