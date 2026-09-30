import { BusinessError, err, ok, type Result } from '@study-studio/shared';

export interface TextbookTaskNode {
  id: string;
  level: string;
  parentId?: string | null | undefined;
}
export interface TextbookExtractionTask<T extends TextbookTaskNode> {
  root: T;
  entries: T[];
  ancestors: T[];
}

/** 目录是任务身份源；课次及独立小节承载内容，单元/章容器由子任务汇总。 */
export function planTextbookTasks<T extends TextbookTaskNode>(entries: readonly T[]): Result<TextbookExtractionTask<T>[], BusinessError> {
  const nodes = new Map(entries.map(entry => [entry.id, entry]));
  if (nodes.size !== entries.length) return err(new BusinessError('E_TOC_DUPLICATE_ID', '目录 ID 重复，请核对目录', 'VALIDATION'));
  const ancestors = new Map<string, T[]>();
  for (const entry of entries) {
    if (!['unit', 'chapter', 'lesson', 'section'].includes(entry.level)) return err(new BusinessError('E_TOC_HIERARCHY_INVALID', '目录层级无法识别，请核对目录', 'VALIDATION'));
    const path: T[] = [], visited = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId) {
      const parent = nodes.get(parentId);
      if (!parent || visited.has(parentId)) return err(new BusinessError('E_TOC_HIERARCHY_INVALID', '目录父节点缺失或存在循环，请核对目录', 'VALIDATION'));
      visited.add(parentId); path.unshift(parent); parentId = parent.parentId;
    }
    ancestors.set(entry.id, path);
  }
  const contentNode = (entry: T) => entry.level === 'lesson' || entry.level === 'section';
  const roots = entries.filter(entry => contentNode(entry) && !ancestors.get(entry.id)!.some(contentNode));
  const tasks = roots.map(root => ({ root, ancestors: ancestors.get(root.id)!, entries: entries.filter(entry => entry.id === root.id || ancestors.get(entry.id)!.some(parent => parent.id === root.id)) }));
  if (!tasks.length || entries.some(entry => !contentNode(entry) && !tasks.some(task => task.entries.some(child => child.id === entry.id) || task.ancestors.some(parent => parent.id === entry.id)))) {
    return err(new BusinessError('E_TOC_CONTENT_UNASSIGNED', '目录存在没有内容子节点的容器，请核对其层级和提取范围', 'VALIDATION'));
  }
  return ok(tasks);
}
