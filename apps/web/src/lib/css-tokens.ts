type CssCustomProperty = `--${string}`;

export function readCssCustomProperty(property: CssCustomProperty): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  return window.getComputedStyle(document.documentElement).getPropertyValue(property).trim();
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
