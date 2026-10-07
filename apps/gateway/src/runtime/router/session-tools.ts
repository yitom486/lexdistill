/**
 * 固定任务显式工具集的会话升级判定（纯函数，可单测）。
 *
 * 背景：turn-tools 的子集只在建新会话时生效，老会话复用原集合。
 * 固定任务（词汇讲解等）通过 agentOptions.tools 声明所需工具：
 * 新会话直接采用；复用会话缺任意一个即升级（关旧建新，thread 续接）。
 * 不声明（空数组）时一律不升级，主聊行为不变。
 */
export function needsSessionToolUpgrade(
  sessionToolNames: readonly string[],
  requested: readonly string[]
): boolean {
  if (requested.length === 0) return false;
  const have = new Set(sessionToolNames);
  return requested.some(name => !have.has(name));
}
