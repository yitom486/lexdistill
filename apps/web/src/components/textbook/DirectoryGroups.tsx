import type { ReactNode } from 'react';
import type { ContentDirectoryNode } from '@study-studio/document-model';

interface Props<T extends { tocId?: string | undefined }> {
  directory?: readonly ContentDirectoryNode[]; items: readonly T[]; render: (items: T[]) => ReactNode;
}
/** 只按保存的 ID 和父子关系组合视图，不按内容/标题猜分组。 */
export function DirectoryGroups<T extends { tocId?: string | undefined }>({ directory = [], items, render }: Props<T>) {
  if (!directory.length) return <>{render([...items])}</>;
  const ids = new Set(directory.map(node => node.id));
  const byParent = new Map<string, ContentDirectoryNode[]>();
  for (const node of directory) if (node.parentId && ids.has(node.parentId)) byParent.set(node.parentId, [...byParent.get(node.parentId) ?? [], node]);
  const relevant = (node: ContentDirectoryNode): boolean => items.some(item => item.tocId === node.id) || (byParent.get(node.id) ?? []).some(relevant);
  const branch = (node: ContentDirectoryNode): ReactNode => relevant(node) && <section key={node.id} data-toc-id={node.id} className="space-y-3 border-l border-line pl-4">
    <header className="space-y-1"><h3 className="font-semibold text-ink">{node.title}</h3>{node.startPage && <p className="text-xs text-ink-muted">PDF 第 {node.startPage}{node.endPage && node.endPage !== node.startPage ? `–${node.endPage}` : ''} 页</p>}</header>
    {render(items.filter(item => item.tocId === node.id))}
    {(byParent.get(node.id) ?? []).map(branch)}
  </section>;
  const unmatched = items.filter(item => !item.tocId || !ids.has(item.tocId));
  return <div className="space-y-5">{directory.filter(node => !node.parentId || !ids.has(node.parentId)).map(branch)}
    {!!unmatched.length && <section className="space-y-3"><h3 className="font-semibold">目录关联待核对</h3><p className="text-xs text-ink-muted">以下内容没有有效的目录关联；未自动归入任何小节。</p>{render(unmatched)}</section>}
  </div>;
}
