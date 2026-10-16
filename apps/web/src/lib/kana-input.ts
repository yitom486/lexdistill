/**
 * 罗马字 → 假名运行时转换（听写输入用）。
 * 映射表由课程假名种子在运行时构建，不设静态表；非法输入返回 ''（判错，不臆造）。
 */
import type { KanaItem } from '@lexdistill/protocol';

export type KanaScript = 'HIRAGANA' | 'KATAKANA';

type KanaPair = { hira: string; kata: string };

/** 由课程表构建罗马字映射（hepburn 拼写与种子 romaji 列一致）。 */
export function buildRomajiMap(kanaList: KanaItem[]): Map<string, KanaPair> {
  const map = new Map<string, KanaPair>();
  for (const k of kanaList) {
    if (!k.romaji || !k.hiragana || !k.katakana) continue;
    const key = k.romaji.toLowerCase();
    if (!map.has(key)) map.set(key, { hira: k.hiragana, kata: k.katakana });
  }
  return map;
}

const SMALL_TSU_HIRA = 'っ';
const SMALL_TSU_KATA = 'ッ';

/**
 * 罗马字转假名：贪婪最长匹配 + 促音（双辅音）+ ん（n' / 词尾 n / n+辅音）。
 * 遇到无法映射的片段即返回 ''（调用方按答错处理）。
 */
export function romajiToKana(
  input: string,
  kanaList: KanaItem[],
  script: KanaScript = 'HIRAGANA'
): string {
  const map = buildRomajiMap(kanaList);
  const smallTsu = script === 'KATAKANA' ? SMALL_TSU_KATA : SMALL_TSU_HIRA;
  const pick = (pair: KanaPair): string => (script === 'KATAKANA' ? pair.kata : pair.hira);
  const s = input.toLowerCase().replace(/[^a-z'-]/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    // 长音符号：- 或 ^ 一律转为 ー（片假名外来语必需；平假名拉面式拼写亦成立）
    if (ch === '-' || ch === '^') {
      out += 'ー';
      i += 1;
      continue;
    }
    // ん：nn → ん；词尾 n / n+辅音（非 y）→ ん；n+元音/y 交给映射表（na/nya…）
    if (ch === 'n') {
      const next = s[i + 1];
      if (next === 'n') {
        out += script === 'KATAKANA' ? 'ン' : 'ん';
        i += 2;
        continue;
      }
      if (next === undefined || (!'aiueoy'.includes(next) && next !== 'n')) {
        out += script === 'KATAKANA' ? 'ン' : 'ん';
        i += 1;
        continue;
      }
    }
    // 促音：tch → っ + ch；一般双辅音（除 n）→ っ
    if (s.startsWith('tch', i)) {
      out += smallTsu;
      i += 1;
      continue;
    }
    if (
      i + 1 < s.length &&
      s[i + 1] === ch &&
      ch !== 'n' &&
      /[bcdfghjklmpqrstvwxz]/.test(ch)
    ) {
      out += smallTsu;
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = 3; len >= 1; len--) {
      const entry = map.get(s.slice(i, i + len));
      if (entry) {
        out += pick(entry);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) return '';
  }
  return out;
}

/** 片假名 → 平假名归一（作答比对用；ー 等保持不变）。 */
export function toHiragana(kana: string): string {
  return kana.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
