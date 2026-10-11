/**
 * 固定任务显式工具集的会话升级判定（纯函数，可单测）。
 *
 * 背景：turn-tools 的子集只在建新会话时生效，老会话复用原集合。
 * 固定任务（词汇讲解等）通过 agentOptions.tools 声明所需工具：
 * 新会话直接采用；复用会话缺任意一个即升级（关旧建新，换新会话——续接旧会话
 * 工具不变，沿用旧会话等于没升）。
 * 不声明（空数组）时一律不升级，主聊行为不变。
 */

/**
 * resume 决策（纯函数）：旧会话的工具集不可验证（旧 resume 无工具参数，
 * 续接会话永远沿用它创建时的工具），因此显式任务（task/tools 非空）一律放弃 resume、
 * 开新会话保证工具必达；hint 轮保留 resume（尽力而为）。网关重启后的固定任务首轮
 * 会丢一次旧对话历史，后续同进程回合复用新会话，不再丢。
 */
export function resolveResumeThreadId(
  preferredThreadId: string | undefined,
  requestedTools: readonly string[]
): string | undefined {
  if (preferredThreadId && requestedTools.length > 0) return undefined;
  return preferredThreadId;
}
export function needsSessionToolUpgrade(
  sessionToolNames: readonly string[],
  requested: readonly string[]
): boolean {
  if (requested.length === 0) return false;
  const have = new Set(sessionToolNames);
  return requested.some(name => !have.has(name));
}
