import { LearningContentPanel } from '../../textbook/LearningContentPanel.js';
import type { SavedTextbookContent } from '@study-studio/document-model';
import { ContentResultView } from './ContentResultView.js';
const statusLabels = { pending: '正文待提取', ready: '已保存', failed: '未完成' };
export function SavedContentResult({ result }: { result: SavedTextbookContent }) {
  return <div className="space-y-3" data-testid="saved-result"><header><h3 className="font-semibold">数据库当前保存版本 · {result.title}</h3><p>{result.status ? statusLabels[result.status] : '状态未提供'} · 读取时间 {result.readAt}</p><p className="break-all text-ink-muted">教材 {result.documentId} · 节点 {result.nodeId}</p></header>
    {result.learningContent ? <LearningContentPanel content={result.learningContent} /> : result.content ? <ContentResultView content={result.content} directory={result.directory} {...(result.counts ? { counts: result.counts } : {})} /> : <p>此节点尚无已保存的结构化内容。</p>}
    <details className="rounded-lg border border-line p-2"><summary className="cursor-pointer">查看数据库返回字段</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre></details>
  </div>;
}
