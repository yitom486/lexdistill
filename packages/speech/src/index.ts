/**
 * M2-2 Speech 稳定公开入口（兼容外观，不含实现）。
 *
 * 本包只转出 `@study-studio/tts-core` 的全部公共表面；TTS 行为、配置、
 * 网络请求与客户端协议一律不动，实现与兼容出口仍归 tts-core 所有。
 * 不变量：本包及 tts-core 不得依赖 Agent 侧包或厂商 SDK；
 * TTS 是独立能力，不归 Agent（单测锁定）。
 */
export * from '@study-studio/tts-core';
