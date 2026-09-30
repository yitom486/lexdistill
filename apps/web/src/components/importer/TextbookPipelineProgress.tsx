import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';
import { planTextbookTasks } from '@study-studio/document-model';
import { useTextbookLessonSlotsQuery } from '../../queries/textbooks-annotations.js';
import { useCancelPipelineJobMutation } from '../../queries/pipeline-jobs.js';
import { Button } from '../ui/button.js';
import { Progress } from '../ui/progress.js';

interface Props {
  job: TextbookPipelineJobSnapshot;
  onRecheck: () => void;
  onClose: () => void;
  onReset: () => void;
}
const stageLabels = { ocr: '提取文字 / OCR', queued: '等待会话', extracting: '模型整理', validating: '校验目录与格式', saving: '保存中', saved: '已保存', failed: '未完成' };

export function TextbookPipelineProgress({ job, onRecheck, onClose, onReset }: Props) {
  const slots = useTextbookLessonSlotsQuery(job.documentId);
  const cancel = useCancelPipelineJobMutation();
  const planned = slots.data?.length ? planTextbookTasks(slots.data.map(slot => ({ ...slot, id: slot.lessonId, level: slot.kind }))) : undefined;
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 text-xs">
      <h3 className="font-semibold text-ink">《{job.title}》教材提取</h3>
      <p className="text-ink-muted">
        {job.status === 'running' ? '正在处理' : job.status === 'done' ? '已确认目录内的内容已完成' : job.status === 'cancelled' ? '已中止，已保存内容保留' : '部分内容未完成，请检查后重试'}
      </p>
      <Progress value={job.doneLessons} max={job.totalLessons} aria-label="教材处理进度" />
      <p className="text-ink">已处理 {job.doneLessons}/{job.totalLessons} 个部分 · 成功 {job.successfulLessons} · 失败 {job.failedLessons.length}</p>
      {slots.data && <p className="text-ink-muted">目录 {slots.data.length} 项 · 课次 {slots.data.filter(slot => slot.kind === 'lesson').length} 课</p>}
      {planned && !planned.ok && <p role="alert" className="text-ink-rose-700-rose-400">{planned.error.userMessage}</p>}
      {job.error && <p role="alert" className="text-ink-rose-700-rose-400">{job.error}</p>}
      {slots.isError && <p role="alert" className="text-ink-rose-700-rose-400">{slots.error.message}</p>}
      <div className="max-h-60 space-y-2 overflow-auto">
        {(planned?.ok ? planned.value.map(task => task.root) : []).map((slot) => {
          const failure = job.failedLessons.find((item) => item.lessonId === slot.lessonId);
          return (
            <div key={slot.lessonId} className="flex justify-between gap-2 border-b border-line-soft py-2 text-ink">
              <span>{slot.title}</span>
              <span className="text-ink-muted">{slot.status === 'ready' ? '已保存' : failure ? failure.error : job.status === 'running' && job.lessonStages?.[slot.lessonId] ? stageLabels[job.lessonStages[slot.lessonId]!] : job.status === 'running' ? '等待处理' : '未完成'}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {job.status === 'running' ? (
          <>
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(job.jobId)}>中止提取</Button>
            <Button onClick={onClose}>后台运行并关闭</Button>
          </>
        ) : (
          <>
            <Button onClick={onRecheck}>检测已保存内容</Button>
            <Button variant="outline" onClick={onReset}>返回配置并重试</Button>
          </>
        )}
      </div>
    </section>
  );
}
