/**
 * ACP 批执行支撑（出题/目录提炼等批处理 lane 迁移用；调用方按 lane 逐个 opt-in）。
 *
 * 背景：批处理此前跑在 CodexAdapter 上（systemPrompt＋sandboxMode＋进程内工具态＋
 * interrupt 取消），ACP 无一一对应物，逐项映射如下：
 * - systemPrompt → 首消息前置（ACP session/new 无身份通道，与聊天身份同款做法）；
 * - 工具结果 → 桥调用记录收割（`SessionToolBridge.takeRecords`，close 前收）；
 * - sandboxMode → 无对应物：批工具本就由调用方 allowlist＋作用域收敛，审批用 on-request＋decline；
 * - interrupt 取消 → close＋detach（尽力而为；Agent 侧 orphan 由进程退出/超时回收）；
 * - 历史污染 → lane 统一 `batch:*`，用户历史默认只列 coach/learning；
 * - 模型/档位 → 沿用探针＋建会话同一套（调用方传 model/effort hints）。
 *
 * 开关：`LINGUA_ACP_BATCH=1` 才允许批调用方选用 ACP 适配器；缺席一律走 Codex 通路。
 * 逐 lane 验证后再翻默认（先目录提炼，后出题；教材管线最后）。
 */

export const ACP_BATCH_LANE_PREFIX = 'batch:';

/** 批 lane 命名（用户历史默认排除，以此外缀识别）。 */
export function batchLane(name: string): string {
  const clean = String(name ?? '').trim() || 'job';
  return `${ACP_BATCH_LANE_PREFIX}${clean}`;
}

export function isBatchLane(lane: string): boolean {
  return String(lane ?? '').startsWith(ACP_BATCH_LANE_PREFIX);
}

/** 批处理是否允许选用 ACP 适配器（缺席默认关：Codex 通路）。 */
export function isAcpBatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LINGUA_ACP_BATCH ?? '').trim() === '1';
}

/**
 * 批首消息组装（systemPrompt 无协议通道 → 前置正文；调用方原文原样保留在后）。
 * 空 systemPrompt 原样返回消息，不加料。
 */
export function buildAcpBatchFirstMessage(systemPrompt: string, message: string): string {
  const head = String(systemPrompt ?? '').trim();
  const body = String(message ?? '');
  if (!head) return body;
  return `${head}\n\n${body}`;
}
