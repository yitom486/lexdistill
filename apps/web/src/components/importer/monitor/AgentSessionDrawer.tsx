import React, { useState } from 'react';
import { 
  X, 
  Bot, 
  Cpu, 
  Sparkles, 
  FileText, 
  BookOpen, 
  CheckCircle2, 
  AlertTriangle, 
  RotateCcw, 
  Clock, 
  Code2, 
  ListOrdered, 
  Layers,
  ArrowRight,
  Database
} from 'lucide-react';
import type { ImportEvent, ContentDirectoryNode } from '@study-studio/document-model';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../ui/sheet.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.js';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { useSavedTextbookContent } from '../../../queries/textbook-import-monitor.js';
import type { WorkerStatusInfo } from './AgentWorkerCard.js';

interface AgentSessionDrawerProps {
  open: boolean;
  onClose: () => void;
  worker?: WorkerStatusInfo | null | undefined;
  events: ImportEvent[];
  directory: readonly ContentDirectoryNode[];
  userId: string;
  documentId?: string | undefined;
}

export function AgentSessionDrawer({
  open,
  onClose,
  worker,
  events,
  directory,
  userId,
  documentId,
}: AgentSessionDrawerProps) {
  // 智能默认 Tab：已入库的直接看成果，正在提炼的优先看实时会话思考流！
  const defaultTab = worker?.stage === 'saved' ? 'extracted' : 'activity';
  const [activeTab, setActiveTab] = useState<'extracted' | 'activity' | 'diagnostics'>(defaultTab);
  const [queryDatabase, setQueryDatabase] = useState(false);

  // 当切换 Worker 时自动调整最适合的展示 Tab
  React.useEffect(() => {
    if (worker) {
      setActiveTab(worker.stage === 'saved' ? 'extracted' : 'activity');
      setQueryDatabase(false);
    }
  }, [worker?.sessionId, worker?.nodeId, worker?.stage]);

  // 查询已保存结果（无条件调用 Hook，通过 enabled 参数安全控制）
  const savedQuery = useSavedTextbookContent(
    userId,
    documentId ?? '',
    worker?.nodeId ?? '',
    open && Boolean(worker) && Boolean(documentId) && Boolean(worker?.nodeId) && (worker?.stage === 'saved' || queryDatabase)
  );

  if (!worker) return null;

  // 过滤本 session 的相关事件
  const sessionEvents = events.filter(e => 
    (worker.sessionId && e.sessionId === worker.sessionId) || 
    (worker.nodeId && e.nodeId === worker.nodeId)
  );

  const errors = sessionEvents.filter(e => e.name === 'error' || e.name === 'failed' || e.name === 'rejected');
  const content = savedQuery.data?.content;
  const isFetchingDb = savedQuery.isFetching;

  return (
    <Sheet open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 flex flex-col h-full bg-surface-warm text-ink border-l border-line shadow-2xl">
        {/* 抽屉头部 */}
        <SheetHeader className="px-6 py-4.5 border-b border-line bg-paper-soft shrink-0">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-surface border border-line flex items-center justify-center font-mono font-bold text-accent-ink text-sm shadow-xs">
                #{worker.workerIndex}
              </div>
              <div>
                <SheetTitle className="font-serif text-base text-ink flex items-center gap-2">
                  <span>{worker.lessonTitle || '未分配具体章节'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-sans font-medium border
                    ${worker.stage === 'saved' ? 'bg-status-success-wash text-status-success-fg border-status-success-line-soft' :
                      worker.stage === 'failed' ? 'bg-status-danger-wash text-status-danger-fg border-status-danger-line-soft' :
                      'bg-status-warn-wash text-status-warn-fg border-status-warn-line-soft'}`}>
                    {worker.stageText}
                  </span>
                </SheetTitle>
                <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5 font-mono">
                  <span>Session: {worker.sessionId ? worker.sessionId.slice(0, 16) : '等待分配'}</span>
                  {worker.threadId && <span>· Thread: {worker.threadId.slice(0, 12)}</span>}
                </div>
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* 顶部标签页切换 */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b border-line bg-surface shrink-0">
            <TabsList className="h-10 bg-transparent p-0 gap-6">
              <TabsTrigger 
                value="activity" 
                className="data-[state=active]:border-b-2 data-[state=active]:border-accent-ink data-[state=active]:text-accent-ink rounded-none px-1 text-xs gap-1.5 h-full"
              >
                <Sparkles className="w-3.5 h-3.5" />
                会话与思考流
                <span className="text-xs text-ink-muted ml-0.5">({sessionEvents.length})</span>
              </TabsTrigger>
              <TabsTrigger 
                value="extracted" 
                className="data-[state=active]:border-b-2 data-[state=active]:border-accent-ink data-[state=active]:text-accent-ink rounded-none px-1 text-xs gap-1.5 h-full"
              >
                <Database className="w-3.5 h-3.5" />
                提炼成果
                {content && (
                  <Badge variant="secondary" className="text-xs h-4 px-1.5 ml-1">
                    就绪
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="diagnostics" 
                className="data-[state=active]:border-b-2 data-[state=active]:border-accent-ink data-[state=active]:text-accent-ink rounded-none px-1 text-xs gap-1.5 h-full"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                异常与重试
                {errors.length > 0 && (
                  <Badge variant="destructive" className="text-xs h-4 px-1.5 ml-1">
                    {errors.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab 1: 提炼成果预览 */}
          <TabsContent value="extracted" className="flex-1 overflow-auto p-6 space-y-6 m-0">
            {isFetchingDb ? (
              <div className="flex flex-col items-center justify-center py-12 text-ink-muted">
                <Clock className="w-6 h-6 animate-spin text-accent-ink mb-2" />
                <p className="text-xs">正在读取数据库成果…</p>
              </div>
            ) : content ? (
              <div className="space-y-6">
                {/* 成果总览 */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-line-soft bg-surface p-3 text-center">
                    <span className="text-xs text-ink-muted">提取生词</span>
                    <div className="text-xl font-bold font-mono text-ink mt-0.5">
                      {content.vocabularies.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line-soft bg-surface p-3 text-center">
                    <span className="text-xs text-ink-muted">知识语法</span>
                    <div className="text-xl font-bold font-mono text-ink mt-0.5">
                      {content.knowledgePoints.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line-soft bg-surface p-3 text-center">
                    <span className="text-xs text-ink-muted">练习题目</span>
                    <div className="text-xl font-bold font-mono text-ink mt-0.5">
                      {content.exercises.length}
                    </div>
                  </div>
                </div>

                {/* 生词列表预览 */}
                {content.vocabularies.length > 0 && (
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                      <ListOrdered className="w-3.5 h-3.5 text-accent-ink" />
                      核心生词表
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-auto p-1">
                      {content.vocabularies.map((v, i) => (
                        <div key={v.id ?? i} className="rounded-xl border border-line-soft bg-surface p-2.5 text-xs flex flex-col justify-between">
                          <div className="flex items-baseline justify-between gap-1 mb-1">
                            <span className="font-semibold text-sm text-ink">{v.surface}</span>
                            {v.reading && <span className="text-ink-muted font-mono">[{v.reading}]</span>}
                          </div>
                          <p className="text-ink-muted line-clamp-1">{v.gloss || v.aiExplanation || '无详细释义'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 知识点与语法预览 */}
                {content.knowledgePoints.length > 0 && (
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-accent-ink" />
                      语法表达与知识点
                    </h4>
                    <div className="space-y-2 max-h-64 overflow-auto p-1">
                      {content.knowledgePoints.map((g, i) => (
                        <div key={g.id ?? i} className="rounded-xl border border-line-soft bg-surface p-3 text-xs space-y-1">
                          <div className="font-semibold text-accent-ink text-sm">{g.title}</div>
                          <p className="text-ink">{g.textbookExplanation || g.aiExplanation || '原书知识点'}</p>
                          {g.examples?.[0] && (
                            <div className="mt-1.5 pl-2.5 border-l-2 border-line text-ink-muted font-serif">
                              <div>{g.examples[0].text}</div>
                              {g.examples[0].translation && (
                                <div className="text-xs">{g.examples[0].translation}</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center text-ink-muted">
                <BookOpen className="w-10 h-10 stroke-1 text-ink-stone-400 mb-3" />
                <h4 className="font-serif text-sm font-semibold text-ink">本课成果正在提炼中</h4>
                <p className="text-xs text-ink-muted mt-1 max-w-sm">
                  该章节目前正在由 Agent 进行深度阅读与结构化提炼，尚未写入 SQLite 数据库。
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <Button 
                    size="sm" 
                    className="text-xs gap-1.5" 
                    onClick={() => setActiveTab('activity')}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    查看该会话实时思考与提炼日志
                  </Button>
                  {!queryDatabase && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-xs" 
                      onClick={() => setQueryDatabase(true)}
                    >
                      检测数据库
                    </Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tab 2: 会话流与时间线 */}
          <TabsContent value="activity" className="flex-1 overflow-auto p-6 space-y-3 m-0">
            {sessionEvents.length === 0 ? (
              <p className="text-xs text-ink-muted text-center py-8">暂无该会话的交互流数据</p>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-line-soft">
                {sessionEvents.map((evt, idx) => (
                  <div key={evt.sequence ?? idx} className="relative group">
                    {/* 节点原点 */}
                    <div className="absolute -left-6 top-1 w-4 h-4 rounded-full border-2 border-surface bg-accent-ink flex items-center justify-center" />
                    
                    {/* 记录卡片 */}
                    <div className="rounded-xl border border-line-soft bg-surface p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-medium text-accent-ink">
                          [{evt.category}] {evt.name}
                        </span>
                        <span className="text-xs text-ink-muted font-mono">
                          {new Date(evt.occurredAt).toLocaleTimeString()}
                        </span>
                      </div>

                      {/* 详细描述 */}
                      {evt.detail ? (
                        <pre className="mt-2 p-2 rounded-lg bg-paper-soft border border-line-soft/80 text-xs font-mono text-ink-muted overflow-x-auto max-h-40">
                          {typeof evt.detail === 'string' ? evt.detail : JSON.stringify(evt.detail, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Tab 3: 异常与重试 */}
          <TabsContent value="diagnostics" className="flex-1 overflow-auto p-6 space-y-4 m-0">
            {errors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-ink-muted">
                <CheckCircle2 className="w-8 h-8 text-status-success-dot mb-2" />
                <p className="text-xs font-medium text-ink">运行平稳，无异常阻断</p>
                <p className="text-xs text-ink-muted mt-0.5">本会话当前未检测到格式冲突或模型拒收记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {errors.map((err, i) => (
                  <div key={i} className="rounded-xl border border-status-rose-line bg-status-rose-wash-faint p-4 text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-status-rose-fg">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{err.name} 异常记录</span>
                    </div>
                    <p className="text-ink">
                      {typeof err.detail === 'object' && err.detail !== null && 'message' in err.detail
                        ? String((err.detail as Record<string, unknown>).message)
                        : JSON.stringify(err.detail ?? { category: err.category, nodeId: err.nodeId, sessionId: err.sessionId, attemptId: err.attemptId, callId: err.callId })}
                    </p>
                    <span className="text-xs text-ink-muted font-mono block">
                      时间: {new Date(err.occurredAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
