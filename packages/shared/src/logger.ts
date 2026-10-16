/**
 * 轻量分级日志门面（@lexdistill/shared，运行中立：Web / Gateway / Adapter 通用）。
 *
 * 约定（配合 AGENTS.md §2 错误链）：
 * - 面向用户的失败一律走 `BusinessError.userMessage`（toast / 空状态），不得依赖控制台。
 * - `console.*` 不得散落在业务文件中；需要诊断日志时统一走本门面。
 * - `debug` / `info` 默认静默（生产控制台零刷屏），`warn` / `error` 透出；
 *   本地联调时用 `setLogLevel('debug')` 打开。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'warn';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else if (level === 'info') console.info(...args);
  else console.debug(...args);
}

export const logger = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
};
