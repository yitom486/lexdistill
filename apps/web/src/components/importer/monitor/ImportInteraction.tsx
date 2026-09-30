import type { ImportEvent, ContentDirectoryNode } from '@study-studio/document-model';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs.js';
import { ImportEventDetail } from './ImportEventDetail.js';

const sections = [
  { key: 'input', title: '输入', match: (e: ImportEvent) => e.category === 'text' || (e.category === 'model' && e.name === 'input') },
  { key: 'model', title: '模型交互', match: (e: ImportEvent) => e.category === 'model' && e.name !== 'input' },
  { key: 'tool', title: '工具', match: (e: ImportEvent) => e.category === 'tool' || e.category === 'session' },
  { key: 'validation', title: '校验与重试', match: (e: ImportEvent) => e.category === 'validation' || e.name === 'retry' },
  { key: 'storage', title: '保存结果', match: (e: ImportEvent) => e.category === 'storage' },
];
export function ImportInteraction({ events, title, current, directory }: { events: ImportEvent[]; title: string; current: boolean; directory?: readonly ContentDirectoryNode[] }) {
  return <details open={current || undefined} className="rounded-xl border border-line p-3 text-xs" data-testid={current ? 'current-interaction' : 'history-interaction'}>
    <summary className="cursor-pointer font-medium text-ink">{current ? '当前交互' : '已结束交互'} · {title} · {events[0]?.sessionId ?? '未分配会话'} · {events[0]?.attemptId}</summary>
    <Tabs defaultValue="input" className="mt-3">
      <TabsList className="flex flex-wrap">{sections.map(section => <TabsTrigger key={section.key} value={section.key}>{section.title}</TabsTrigger>)}</TabsList>
      {sections.map(section => <TabsContent key={section.key} value={section.key} className="space-y-2 pt-3">
        {events.filter(section.match).map(event => <ImportEventDetail key={event.sequence} event={event} expanded={current && event.name === 'input'} {...(directory ? { directory } : {})} />)}
        {!events.some(section.match) && <p className="text-ink-muted">本轮暂无该类记录</p>}
      </TabsContent>)}
    </Tabs>
  </details>;
}
