type CssCustomProperty = `--${string}`;

export function readCssCustomProperty(property: CssCustomProperty): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  return window.getComputedStyle(document.documentElement).getPropertyValue(property).trim();
}

/**
 * R10：系统“减少动态效果”偏好的运行时读取（matchMedia，每次调用都读当前值，
 * 不在模块加载时缓存；jsdom 等无 matchMedia 环境回落为 false）。
 * Confetti 等一次性动效在触发时调用；需要跟踪变化时用 watchReducedMotion。
 */
export function isReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * R10：订阅系统偏好变化，返回取消订阅函数。主题/偏好切换与动效收敛共用。
 */
export function watchReducedMotion(listener: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener(handler);
  }
  return () => {};
}

export function readCssDurationMilliseconds(property: CssCustomProperty): number {
  const value = readCssCustomProperty(property);
  const match = /^(-?(?:\d+|\d*\.\d+))(ms|s)$/.exec(value);
  if (!match) return 0;

  const amountText = match[1];
  const unit = match[2];
  if (amountText === undefined || unit === undefined) return 0;

  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return 0;
  return unit === 's' ? amount * 1000 : amount;
}

export function readCssDurationSeconds(property: CssCustomProperty): number {
  return readCssDurationMilliseconds(property) / 1000;
}

/**
 * Phase 1: 非 CSS 绘制（Canvas / Confetti / 第三方可视化）必须通过此函数
 * 读取当前主题下计算后的语义 token，禁止硬编码颜色字面量。
 * 例：readCssColor('--visual-agent-beam-from')
 */
export function readCssColor(property: CssCustomProperty, fallback = ''): string {
  const value = readCssCustomProperty(property);
  return value === '' ? fallback : value;
}

/** Phase 1 暗色表面阶梯（Canvas / Panel / Surface / Raised）的 token 名，供 JS 按需读取。 */
export const SURFACE_ELEVATION_TOKENS = [
  '--surface-abyss',
  '--surface-coal',
  '--surface-warm',
  '--surface',
] as const satisfies readonly CssCustomProperty[];
