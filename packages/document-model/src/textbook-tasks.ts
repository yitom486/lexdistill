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

/** 每个无父节点的一级标题是一个任务；类型不决定切分，所有子标题随根任务处理。 */
export function planTextbookTasks<T extends TextbookTaskNode>(entries: readonly T[]): Result<TextbookExtractionTask<T>[], BusinessError> {
  if (!entries.length) return err(new BusinessError('E_TOC_EMPTY', '目录条目不能为空', 'VALIDATION'));
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
  const roots = entries.filter(entry => !entry.parentId);
  const tasks = roots.map(root => ({ root, ancestors: ancestors.get(root.id)!, entries: entries.filter(entry => entry.id === root.id || ancestors.get(entry.id)!.some(parent => parent.id === root.id)) }));
  return ok(tasks);
}
