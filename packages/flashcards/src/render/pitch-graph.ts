/**
 * M7-2 自 learner-core 迁入 flashcard-core（字节一致，行为不变）。
 *
 * 声调阶梯 SVG 生成器（纯函数，自研视觉语言，未复制任何外部项目的渲染代码）。
 *
 * 输入：读音假名 + 声调核位置（0=平板，1=头高，k=第 k 拍后降），输出内联 SVG 字符串。
 * 可直接嵌入卡片 HTML（含 Anki 卡片）与 Web 面板；模板 JS 永不参与。
 * 长音“ー”单独成拍以对齐核序号，但音高保持前一拍（符合实际发音）。
 */

const SMALL_Y = new Set(['ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ゎ', 'ヮ']);

/**
 * 读音切拍（拗音合并，如 きゃ=1 拍；促音/拨音/长音独立成拍以保序号）。
 * 非假名字符原样单列（防丢字；调用方负责转义，见 escapeXml）。
 */
export function splitMorae(reading: string): string[] {
  const units: string[] = [];
  for (const ch of reading) {
    const last = units[units.length - 1];
    if (last !== undefined && SMALL_Y.has(ch) && !isSokuon(last)) {
      units[units.length - 1] = last + ch;
    } else {
      units.push(ch);
    }
  }
  return units;
}

function isSokuon(unit: string): boolean {
  return unit === 'っ' || unit === 'ッ';
}

function isLongMark(unit: string): boolean {
  return unit === 'ー';
}

/**
 * 各拍高低（H/L）：首拍低（头高除外），核后降，平板除首拍全高。
 * 长音拍继承前一拍（保持）；多核取首核（Kanjium 偶有并列，以首核为准并如实只画首核）。
 */
export function moraPitchPattern(units: string[], positions: number[]): Array<'H' | 'L'> {
  const nucleus = positions.find((p) => Number.isFinite(p) && p >= 0) ?? 0;
  return units.map((unit, i) => {
    if (isLongMark(unit) && i > 0) {
      return patternAt(i - 1, nucleus);
    }
    return patternAt(i, nucleus);
  });
}

function patternAt(i: number, nucleus: number): 'H' | 'L' {
  if (nucleus <= 0) return i === 0 ? 'L' : 'H';
  if (nucleus === 1) return i === 0 ? 'H' : 'L';
  if (i === 0) return 'L';
  return i < nucleus ? 'H' : 'L';
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PitchGraphOptions {
  /** 每拍宽度（缺省 30） */
  moraWidth?: number | undefined;
  /** 无障碍标题后缀（如 ⓪；缺省无） */
  label?: string | undefined;
}

/**
 * 声调阶梯 SVG（高拍实心、低拍空心圆点 + 台阶连线 + 拍假名）。
 * 空读音返回空串（不臆造图形）。
 */
export function buildPitchGraphSvg(
  reading: string,
  positions: number[],
  options: PitchGraphOptions = {}
): string {
  const units = splitMorae(reading.trim());
  if (units.length === 0) return '';
  const moraWidth = options.moraWidth ?? 30;
  const padX = 10;
  const highY = 12;
  const lowY = 32;
  const textY = 52;
  const width = padX * 2 + moraWidth * units.length;
  const height = 62;
  const pattern = moraPitchPattern(units, positions);
  const cx = (i: number) => padX + moraWidth * i + moraWidth / 2;
  const cy = (i: number) => (pattern[i] === 'H' ? highY : lowY);
  let path = `M ${cx(0)} ${cy(0)}`;
  for (let i = 1; i < units.length; i += 1) {
    const prevY = cy(i - 1);
    const curY = cy(i);
    if (prevY === curY) {
      path += ` H ${cx(i)}`;
    } else {
      path += ` H ${cx(i)} V ${curY}`;
    }
  }
  const dots = units
    .map((_, i) => {
      const high = pattern[i] === 'H';
      return `<circle cx="${cx(i)}" cy="${cy(i)}" r="4.5" fill="${high ? '#d97706' : '#ffffff'}" stroke="#d97706" stroke-width="2"/>`;
    })
    .join('');
  const labels = units
    .map((unit, i) => `<text x="${cx(i)}" y="${textY}" text-anchor="middle" font-size="13">${escapeXml(unit)}</text>`)
    .join('');
  const titleText = options.label ? `${reading} ${options.label}` : reading;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>${escapeXml(titleText)}</title><path d="${path}" fill="none" stroke="#d97706" stroke-width="2"/>${dots}${labels}</svg>`;
}
