import React from 'react';
import { ScanLine } from 'lucide-react';
import { Badge } from './ui/badge.js';
import { useDocumentStructureQuery } from '../queries/useLearnerQueries.js';

/**
 * 教材结构存档行（回来查看）：导入时 AI 分类判了什么、用的哪个模型。
 * 无存档时静默隐藏（老书不受影响）；纯展示，不参与导入决策。
 */
export function BookStructureRow({
  documentId,
  bookTitle,
}: {
  documentId: string | undefined;
  bookTitle: string;
}) {
  const { data: saved, isError, refetch, isFetching } = useDocumentStructureQuery(documentId);
  const classes = Array.isArray(saved?.classes) ? saved.classes : [];
  if (classes.length === 0 && !isError) return null;
  const lessons = classes.filter((c) => c.kind === 'lesson').length;
  const skills = [...new Set(classes.map((c) => c.skillId).filter((s): s is string => !!s))];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-ghost">
      {isError && <>
        <span role="status">结构存档读取失败{classes.length > 0 ? '，以下为上次读取结果。' : '。'}</span>
        <button type="button" disabled={isFetching} onClick={() => void refetch()} className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          {isFetching ? '正在重试…' : '重新读取结构存档'}
        </button>
      </>}
      {classes.length > 0 && <>
      <span className="inline-flex items-center gap-1 font-bold">
        <ScanLine className="w-3.5 h-3.5 text-tone-amber-600" />
        AI 结构存档
      </span>
      <span>
        《{bookTitle}》判出 {lessons} 课
        {saved && saved.dropped > 0 && `（丢弃 ${saved.dropped} 条）`}
      </span>
      {skills.slice(0, 6).map((s) => (
        <Badge key={s} variant="amber" className="text-xs font-mono">
          {s}
        </Badge>
      ))}
      {skills.length > 6 && <span>+{skills.length - 6}</span>}
      {saved?.model && <span className="font-mono text-ink-stone-400">by {saved.model}</span>}
      </>}
    </div>
  );
}
