import { BusinessError, err, ok, type Result } from '@lexdistill/shared';

export interface TextbookTaskNode {
  id: string;
  level: string;
  parentId?: string | null | undefined;
  startPage?: number | null | undefined;
  endPage?: number | null | undefined;
  title?: string | undefined;
}
export interface TextbookExtractionTask<T extends TextbookTaskNode> {
  root: T;
  entries: T[];
  ancestors: T[];
}

/**
 * 依据目录树结构与排版层级规划切分任务：
 * 1. 若单元 (unit) 下没有 session (课/独立模块)，则将整个 unit 作为一个切分面；
 * 2. 若单元 (unit) 下包含 session，则以 session (成课及与课平齐的单元总结/小节) 为单位切分；
 * 3. 课内更深层级的细分小节 (如会话场景、语法点) 归入对应 session 任务中，所属单元保留在 ancestors 中。
 */
export function planTextbookTasks<T extends TextbookTaskNode>(entries: readonly T[]): Result<TextbookExtractionTask<T>[], BusinessError> {
  if (!entries.length) return err(new BusinessError('E_TOC_EMPTY', '目录条目不能为空', 'VALIDATION'));
  const nodes = new Map(entries.map(entry => [entry.id, entry]));
  if (nodes.size !== entries.length) return err(new BusinessError('E_TOC_DUPLICATE_ID', '目录 ID 重复，请核对目录', 'VALIDATION'));

  const ancestors = new Map<string, T[]>();
  for (const entry of entries) {
    if (!['unit', 'chapter', 'lesson', 'section', 'session'].includes(entry.level)) {
      return err(new BusinessError('E_TOC_HIERARCHY_INVALID', '目录层级无法识别，请核对目录', 'VALIDATION'));
    }
    const path: T[] = [], visited = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId) {
      const parent = nodes.get(parentId);
      if (!parent || visited.has(parentId)) {
        return err(new BusinessError('E_TOC_HIERARCHY_INVALID', '目录父节点缺失或存在循环，请核对目录', 'VALIDATION'));
      }
      visited.add(parentId);
      path.unshift(parent);
      parentId = parent.parentId;
    }
    ancestors.set(entry.id, path);
  }

  const childrenMap = new Map<string, T[]>();
  for (const entry of entries) {
    if (entry.parentId) {
      const list = childrenMap.get(entry.parentId) ?? [];
      list.push(entry);
      childrenMap.set(entry.parentId, list);
    }
  }

  function collectSubtreeIds(root: T): Set<string> {
    const ids = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      for (const child of childrenMap.get(currId) ?? []) {
        ids.add(child.id);
        queue.push(child.id);
      }
    }
    return ids;
  }

  function resolveCuttingRoots(node: T): T[] {
    const children = childrenMap.get(node.id) ?? [];
    if (node.level === 'unit') {
      // 单元下若没有子节点/session，则把整个 unit 自身作为切分面
      if (children.length === 0) return [node];
      // 单元下有子条目：以直接子条目 (session: 成课、与课平齐的单元总结/小节) 为切分面
      const roots: T[] = [];
      for (const child of children) {
        if (child.level === 'chapter' && (childrenMap.get(child.id) ?? []).some(c => c.level === 'lesson' || c.level === 'session')) {
          roots.push(...resolveCuttingRoots(child));
        } else {
          roots.push(child);
        }
      }
      return roots;
    }
    if (node.level === 'chapter') {
      const hasSessions = children.some(c => c.level === 'lesson' || c.level === 'session');
      if (hasSessions) {
        return children.filter(c => c.level === 'lesson' || c.level === 'session' || c.level === 'section');
      }
      return [node];
    }
    // lesson / session / section 自身作为独立切分面
    return [node];
  }

  const rootEntries = entries.filter(entry => !entry.parentId);
  const cuttingRoots: T[] = [];
  for (const root of rootEntries) {
    cuttingRoots.push(...resolveCuttingRoots(root));
  }

  const tasks: TextbookExtractionTask<T>[] = cuttingRoots.map(cutRoot => {
    const subtreeIds = collectSubtreeIds(cutRoot);
    const taskEntries = entries.filter(e => subtreeIds.has(e.id));
    return {
      root: cutRoot,
      ancestors: ancestors.get(cutRoot.id) ?? [],
      entries: taskEntries,
    };
  });

  return ok(tasks);
}

