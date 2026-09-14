/**
 * P1-B lesson display title（模块级纯函数，无依赖，可被 persistence/application 同用）。
 * P1-B1 原型转正为 Gateway 内唯一展示归一入口（仍未进 DB/AST/UI，仅 focus→daily-plan 消费）。
 *
 * 背景：parser raw title 是 OCR heading candidate（含 `だい -第11課` / `第10課 118` 类噪声），
 * 不能直接当 canonical display label，也不能用 lessonNumber 推导展示。
 * 本函数只做高置信度单 token 提取；拿不准的一律回 null（调用方走 fallback），绝不臆造课号。
 *
 * 高置信度 token（与 parser 切课口径对齐，见 markdown-to-ast.ts）：
 * - 第N課（阿拉伯/汉字数字；含百的超纲形态直接丢弃，与 lessonNoOf 一致）
 * - 復習/复习 + 大写字母（裸 `復習`/`総復習` 不是 token；`復習ç` 这类坏字母不是 token）
 * - lesson/unit + 数字（拉丁形态，种子英文书用）
 *
 * 明确不是 lesson（永不提取）：
 * - 練習A / 付録 / 問題 等上下文 section（parser 把它们成课是分段质量债，不得擅自升格）
 *
 * 规则：
 * - 全串去首尾空、空白归一后找 token；
 * - 去重后恰好 1 种 token → 返回该 token 原样；
 * - 0 种或 ≥2 种互斥 token → null（ambiguous/unresolved，保持 raw）。
 */
const KANJI_NUM = '0-9一二三四五六七八九十百';

const TOKEN_RES: RegExp[] = [
  new RegExp(`第\\s*[${KANJI_NUM}]+\\s*[課课]`),
  /(?:復習|复习)\s*[A-Z]/,
  /\blesson\s*\d+\b/i,
  /\bunit\s*\d+\b/i,
];

export function normalizeLessonDisplayTitle(rawTitle: unknown): string | null {
  if (typeof rawTitle !== 'string') return null;
  const s = rawTitle.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const found = new Set<string>();
  for (const re of TOKEN_RES) {
    const g = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
    for (const m of s.matchAll(g)) {
      const token = (m[0] ?? '').trim();
      // 含百的超纲形态：parser 亦不认（lessonNoOf 回 null），这里同样丢弃
      if (token.includes('百')) continue;
      found.add(token);
    }
  }
  if (found.size !== 1) return null;
  const only = [...found][0];
  return only ? only : null;
}
