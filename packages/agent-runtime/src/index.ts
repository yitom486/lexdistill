/**
 * M2-1 统一 Agent Runtime 公共入口（外观包，不含实现）。
 *
 * 布局：
 * - `./contracts`：provider-neutral 契约（转出 agent-core）；
 * - `./adapters`：Codex / Responses 适配器入口（具名收敛，不含工具桥）。
 *
 * 不变量：contracts 内禁 provider/厂商内容（单测锁定）；具体厂商实现
 * 只许位于 adapters 各包内部；Codex 专有动态工具桥禁上浮到本入口；
 * TTS 不并入（保持 tts-core 独立）。
 */
export * from './contracts/index.js';
export * from './adapters/index.js';
