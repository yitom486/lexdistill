import { useState } from 'react';
import { LessonSubmissionSchema, type ImportEvent, type ContentDirectoryNode } from '@study-studio/document-model';
import { useImportEventDetail } from '../../../queries/textbook-import-monitor.js';
import { ContentResultView } from './ContentResultView.js';
import { ChapterSourceView } from './ChapterSourceView.js';
import { ModelInputView } from './ModelInputView.js';
import { ImportRecordView } from './ImportRecordView.js';

const labels: Record<string, string> = { input: '实际模型输入与目录', opened: '本会话模型与工具说明', candidate: '系统生成 ID 后的规范内容', requested: '模型工具调用', proposal: '模型提交参数', result: '工具回执', rejected: '校验拒绝与修正反馈', accepted: '校验通过', committed: '数据库事务提交成功', commit_failed: '保存失败', message: '模型回复', retry: '重试原因', failed: '失败原因', error: '模型运行错误', check_passed: '逐项校验', turn_started: '原生轮次身份' };

export function ImportEventDetail({ event, expanded = false, directory = [] }: { event: ImportEvent; expanded?: boolean; directory?: readonly ContentDirectoryNode[] }) {
  const [open, setOpen] = useState(expanded);
  const query = useImportEventDetail(event.userId, event.traceId, event.sequence, open);
  const candidate = event.category === 'tool' && event.name === 'candidate' ? LessonSubmissionSchema.safeParse(query.data?.detail) : undefined;
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border border-line-soft p-2">
    <summary className="cursor-pointer text-ink">{event.occurredAt.slice(11, 23)} · {event.category === 'text' && event.name === 'ready' ? '章节解析结果' : labels[event.name] ?? event.name}</summary>
    {open && <div className="mt-2 space-y-2">
      {query.isPending ? <p>正在读取详情…</p> : query.isError ? <p role="alert">{query.error.message}</p> : <>
        {candidate?.success && <section className="space-y-2"><h4 className="font-semibold">系统生成 ID 后的候选 · 尚不能据此认定已保存</h4><ContentResultView content={candidate.data.content} directory={directory} /></section>}
        {event.category === 'text' && event.name === 'ready' && <ChapterSourceView detail={query.data?.detail} />}
        {event.category === 'model' && event.name === 'input' && <ModelInputView detail={query.data?.detail} />}
        {!candidate?.success && !(event.category === 'text' && event.name === 'ready') && !(event.category === 'model' && event.name === 'input') && <ImportRecordView event={event} detail={query.data?.detail} />}
      </>}
    </div>}
  </details>;
}
