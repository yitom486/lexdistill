import { usePipelineProgress, stageLabels } from './usePipelineProgress.js';
import { useState } from 'react';
import type { TextbookPipelineJobSnapshot } from '@lexdistill/protocol';
import { 
  Bot, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  RotateCcw, 
  LayoutGrid, 
  ListTree, 
  Sparkles, 
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { Button } from '../ui/button.js';
import { Progress } from '../ui/progress.js';
import { Badge } from '../ui/badge.js';
import { AgentWorkerCard, type WorkerStatusInfo } from './monitor/AgentWorkerCard.js';
import { AgentSessionDrawer } from './monitor/AgentSessionDrawer.js';

interface Props {
  job: TextbookPipelineJobSnapshot;
  onRecheck: () => void;
  onClose: () => void;
  onReset: () => void;
}

export function TextbookPipelineProgress({ job, onRecheck, onClose, onReset }: Props) {
  const [viewMode, setViewMode] = useState<'workers' | 'chapters'>('workers');
  const [selectedWorker, setSelectedWorker] = useState<WorkerStatusInfo | null>(null);

  const { slots, cancel, cancellingRef, monitorQuery, allEvents, directory, tasks, slotMap, workers, activeWorkerCount } = usePipelineProgress(job);

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-surface p-6 text-ink shadow-sm">
      {/* 顶部任务总览看板 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-line-soft">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="font-serif text-xl font-bold text-ink">
              《{job.title}》教材提炼进度
            </h3>
            <Badge 
              variant={job.status === 'done' ? 'default' : job.status === 'running' ? 'secondary' : 'outline'}
              className="font-sans text-xs px-2.5 py-0.5"
            >
              {job.status === 'running' ? '并发提炼中' : job.status === 'done' ? '全书提炼完成' : job.status === 'cancelled' ? '已暂停' : '部分未完成'}
            </Badge>
          </div>
          <p className="text-xs text-ink-muted">
            正文基于高精度 Agent 并发池进行切片提炼，已完成章节自动整章入库，支持随时中断和增量续跑。
          </p>
        </div>

        {/* 顶部操作动作 */}
        <div className="flex items-center gap-2 shrink-0">
          {job.status === 'running' ? (
            <>
              <Button 
                variant="outline" 
                size="sm" 
                disabled={cancel.isPending} 
                onClick={() => {
                  if (cancellingRef.current || cancel.isPending) return;
                  cancellingRef.current = true;
                  cancel.mutate(job.jobId, { onSettled: () => { cancellingRef.current = false; } });
                }}
                className="text-xs text-status-rose-fg hover:text-status-rose-fg-strong hover:bg-status-rose-wash-hover"
              >
                {cancel.isPending ? '中止中…' : '中止提炼'}
              </Button>
              <Button size="sm" onClick={onClose} className="text-xs">
                后台运行并返回
              </Button>
              {cancel.isError && (
                <p role="alert" className="text-xs text-ink-rose-600">
                  中止失败：{(cancel.error as Error)?.message ?? '请重试'}
                </p>
              )}
            </>
          ) : (
            <>
              <Button size="sm" onClick={onRecheck} className="text-xs">
                核对并载入教材
              </Button>
              <Button variant="outline" size="sm" onClick={onReset} className="text-xs">
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                重新配置
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 进度与关键指标条 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-line-soft bg-paper-soft p-3.5 flex flex-col justify-between">
          <span className="text-xs text-ink-muted">全书提取进度</span>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-ink">
                {job.doneLessons} <span className="text-xs font-normal text-ink-muted">/ {job.totalLessons} 课</span>
              </span>
              <span className="text-xs font-semibold text-accent-ink font-mono">
                {Math.round((job.doneLessons / (job.totalLessons || 1)) * 100)}%
              </span>
            </div>
            <Progress value={job.doneLessons} max={job.totalLessons} className="h-1.5" />
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-paper-soft p-3.5 flex flex-col justify-between">
          <span className="text-xs text-ink-muted">并发 Agent 状态</span>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="text-lg font-bold font-mono text-ink flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-accent-ink" />
              <span>{activeWorkerCount}</span>
              <span className="text-xs font-normal text-ink-muted">/ {job.concurrency ?? 6} 活跃</span>
            </div>
            <span className="text-xs text-ink-muted font-mono truncate max-w-[8rem]" title={job.model ?? '标准模型'}>
              {job.model?.split('/').pop() ?? '标准多模态'}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-paper-soft p-3.5 flex flex-col justify-between">
          <span className="text-xs text-ink-muted">成果收录统计</span>
          <div className="mt-2 flex items-baseline gap-3">
            <div>
              <span className="text-xs text-ink-muted block">成功入库</span>
              <span className="text-lg font-bold font-mono text-status-success-fg">
                {job.successfulLessons}
              </span>
            </div>
            <div title="用完重试仍未成功；增量续跑会捡回这些章节">
              <span className="text-xs text-ink-muted block">本轮失败</span>
              <span className="text-lg font-bold font-mono text-status-rose-fg">
                {job.failedLessons.length}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-paper-soft p-3.5 flex flex-col justify-between">
          <span className="text-xs text-ink-muted">视图模式</span>
          <div className="mt-2 flex items-center gap-1.5 bg-surface rounded-lg p-1 border border-line">
            <button
              onClick={() => setViewMode('workers')}
              aria-pressed={viewMode === 'workers'}
              className={`flex-1 py-1 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors
                ${viewMode === 'workers' ? 'bg-paper-soft text-ink font-semibold shadow-xs' : 'text-ink-muted hover:text-ink'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Agent 并发池
            </button>
            <button
              onClick={() => setViewMode('chapters')}
              aria-pressed={viewMode === 'chapters'}
              className={`flex-1 py-1 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors
                ${viewMode === 'chapters' ? 'bg-paper-soft text-ink font-semibold shadow-xs' : 'text-ink-muted hover:text-ink'}`}
            >
              <ListTree className="w-3.5 h-3.5" />
              章节总表
            </button>
          </div>
        </div>
      </div>

      {/* 视图 1：Agent 并发池实况矩阵 */}
      {viewMode === 'workers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-serif text-sm font-semibold text-ink flex items-center gap-2">
              <Bot className="w-4 h-4 text-accent-ink" />
              Agent 池活跃会话矩阵
            </h4>
            <span className="text-xs text-ink-muted">
              点击任意会话卡片可直接调出「实时思考与提炼成果抽屉」
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {workers.map((worker) => (
              <AgentWorkerCard
                key={worker.workerIndex}
                worker={worker}
                onClickDetails={() => setSelectedWorker(worker)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 视图 2：章节流转总表 */}
      {viewMode === 'chapters' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-serif text-sm font-semibold text-ink flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent-ink" />
              全书章节提炼状态列表
            </h4>
            <span className="text-xs text-ink-muted">
              共 {tasks.length} 章节，点击右侧可追溯该章节的处理记录
            </span>
          </div>

          <div className="rounded-xl border border-line-soft overflow-hidden bg-paper-soft/50">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface border-b border-line-soft text-ink-muted font-medium sticky top-0">
                  <tr>
                    <th className="p-3">章节名称</th>
                    <th className="p-3">页码范围</th>
                    <th className="p-3">提炼状态</th>
                    <th className="p-3">尝试轮次</th>
                    <th className="p-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {tasks.map((slot) => {
                    const failure = job.failedLessons.find((item) => item.lessonId === slot.lessonId);
                    const activity = job.lessonActivities?.[slot.lessonId];
                    const stageKey = job.lessonStages?.[slot.lessonId];
                    const isReady = slot.status === 'ready';

                    return (
                      <tr key={slot.lessonId} className="hover:bg-surface/60 transition-colors">
                        <td className="p-3 font-medium text-ink">
                          {slot.title}
                        </td>
                        <td className="p-3 font-mono text-ink-muted">
                          P{slot.startPage}{slot.endPage ? `–P${slot.endPage}` : ''}
                        </td>
                        <td className="p-3">
                          {isReady ? (
                            <span className="inline-flex items-center gap-1 text-status-success-fg font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> 已入库
                            </span>
                          ) : failure ? (
                            <span className="inline-flex items-center gap-1 text-status-rose-fg font-medium" title={failure.error}>
                              <AlertCircle className="w-3.5 h-3.5" /> 异常 ({failure.error.slice(0, 12)}…)
                            </span>
                          ) : stageKey ? (
                            <span className="inline-flex items-center gap-1 text-status-warn-fg font-medium">
                              <Sparkles className="w-3.5 h-3.5 animate-pulse motion-reduce:animate-none" />
                              {stageLabels[stageKey] ?? stageKey}
                            </span>
                          ) : (
                            <span className="text-ink-muted">等待会话分配</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-ink-muted">
                          {activity ? `第 ${activity.attempt} 次` : '-'}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-accent-ink"
                            onClick={() => {
                              // 构造该章节的临时 Worker 视图展示
                              const matchWorker = workers.find(w => w.nodeId === slot.lessonId);
                              setSelectedWorker(matchWorker ?? {
                                workerIndex: 0,
                                sessionId: '',
                                stage: isReady ? 'saved' : failure ? 'failed' : 'thinking',
                                stageText: isReady ? '已入库' : failure ? '异常' : '处理中',
                                attemptCount: activity?.attempt ?? 1,
                                ...(slot.lessonId ? { nodeId: slot.lessonId } : {}),
                                ...(slot.title ? { lessonTitle: slot.title } : {}),
                              });
                            }}
                          >
                            查看会话详情
                            <ArrowRight className="w-3 h-3 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 会话沉浸式详情抽屉 */}
      {selectedWorker && (
        <AgentSessionDrawer
          open={Boolean(selectedWorker)}
          onClose={() => setSelectedWorker(null)}
          worker={selectedWorker}
          events={allEvents}
          directory={directory}
          userId={job.userId}
          documentId={job.documentId}
        />
      )}
    </section>
  );
}
