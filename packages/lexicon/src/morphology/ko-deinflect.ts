/**
 * 韩语活用形还原（clean-room 实现，未复制任何外部项目的规则文件）。
 *
 * 方法：音节后缀规则（BFS ≤3 跳，上限 24 候选）+ 谚文音节位约束的不规则 7 式。
 * - 后缀规则双产出：终点式（-요→-다，如 가요→가다）与接力式（-요→''，如 추웠어요→추웠→춥다），
 *   由调用方的词典存在性过滤 diverging 分支；
 * - 不规则经 hangul.ts 音节分解做词干末音变（ㅂ→우、ㄷ→ㄹ、ㅅ脱落、르/으/허），形状不符不触发；
 * - 韩语动词/形容词活用几乎同形，候选一律动词+形容词双词性，
 *   词性信号只用于名词误命中时的降权与注记（只加分不删除）。
 * 规则来源为公开学校语法常识（합니다/해요/았다/으면/ honorific 等标准词尾），命名与结构均为原创。
 */

import type { CoarsePos } from './part-of-speech.js';
import { decomposeSyllable, composeSyllable, type HangulSyllable } from './hangul.js';

export interface KoDeinflectCandidate {
  base: string;
  /** 链条标注，如 '过去时+否定' */
  note: string;
  /** BFS 跳数（越小越可信） */
  depth: number;
  pos: CoarsePos;
}

const MAX_DEPTH = 3;
const MAX_CANDIDATES = 24;

interface SuffixRule {
  suffix: string;
  replace: string;
  note: string;
}

const SUFFIX_RULES: SuffixRule[] = (() => {
  const rules: SuffixRule[] = [];
  const add = (suffix: string, replace: string, note: string) => {
    rules.push({ suffix, replace, note });
  };
  // ---- 现在时（해요体/합니다体/系动词；终点式直达原形，接力经 -다 剥离） ----
  for (const tail of ['아요', '어요', '여요']) add(tail, '다', '现在时');
  for (const tail of ['ㅂ니다', '습니다']) add(tail, '다', '现在时');
  add('습니까', '다', '现在时');
  for (const tail of ['입니다', '입니까', '이에요', '예요']) {
    add(tail, '이다', '系动词');
  }
  // ---- 过去时 ----
  for (const tail of ['았다', '었다', '였다']) add(tail, '다', '过去时');
  for (const tail of ['았어요', '었어요', '였어요', '았습니다', '었습니다']) add(tail, '다', '过去时');
  for (const tail of ['았어', '었어', '았니', '었니', '았던', '었던', '였던', '았', '었']) {
    add(tail, '다', '过去时');
  }
  // ---- 将来/推测 ----
  for (const tail of ['겠다', '겠어요', '겠어']) add(tail, '다', '将来时');
  for (const tail of [
    'ㄹ 거야', 'ㄹ거야', 'ㄹ 거예요', 'ㄹ거예요', 'ㄹ 겁니다', 'ㄹ겁니다',
    'ㄹ게요', 'ㄹ래요', 'ㄹ까요',
    '을 거야', '을거야', '을 거예요', '을거예요', '을 겁니다', '을겁니다',
  ]) {
    add(tail, '다', '将来时');
  }
  // ---- 连接 ----
  add('고', '다', '连接');
  for (const tail of ['아서', '어서', '여서']) add(tail, '다', '连接');
  for (const tail of ['면', '으면']) add(tail, '다', '连接');
  for (const tail of ['니까', '으니까']) add(tail, '다', '连接');
  add('지만', '다', '连接');
  for (const tail of ['러', '으러']) add(tail, '다', '连接');
  for (const tail of ['려고', '으려고']) add(tail, '다', '连接');
  add('기', '다', '连接');
  for (const tail of ['음', 'ㅁ', '으ㅁ']) add(tail, '다', '连接');
  for (const tail of ['죠', '지요']) add(tail, '다', '连接');
  // ---- 定语 ----
  add('는', '다', '定语');
  for (const tail of ['ㄴ', '은']) add(tail, '다', '定语');
  for (const tail of ['ㄹ', '을']) add(tail, '다', '定语');
  // ---- 尊敬 ----
  for (const tail of ['세요', '으세요', '세', '으세']) add(tail, '다', '尊敬');
  for (const tail of ['십니다', '으십니다', '시다', '으시다']) add(tail, '다', '尊敬');
  // ---- 命令/提议 ----
  for (const tail of ['십시오', '으십시오']) add(tail, '다', '命令');
  add('자', '다', '提议');
  for (const tail of ['아라', '어라']) add(tail, '다', '命令');
  add('지 마', '다', '禁止');
  // ---- 否定后缀 ----
  for (const tail of ['지 않다', '지 않아', '지 않아요', '지 않습니다']) add(tail, '다', '否定');
  // ---- 缩约（整形还原） ----
  for (const tail of ['해요', '해', '했', '하여']) add(tail, '하다', '缩约');
  add('합', '하다', '缩约');
  for (const tail of ['와', '왔']) add(tail, '오다', '缩约');
  add('워', '오다', '缩约');
  add('줘', '주다', '缩约');
  for (const tail of ['둬', '뒀']) add(tail, '두다', '缩约');
  for (const tail of ['봐', '봤']) add(tail, '보다', '缩约');
  for (const tail of ['놔', '놨']) add(tail, '놓다', '缩约');
  // ---- 系动词 이다 明示形 ----
  for (const tail of ['이었다', '였다', '이면', '이니까', '이고', '인', '일', '임', '이지']) {
    add(tail, '이다', '系动词');
  }
  // ---- 句尾裸 요 / 非敬体 어아（终点式）与平叙 다（唯一接力规则） ----
  add('요', '다', '现在时');
  add('다', '', '平叙形');
  add('어', '다', '非敬体');
  add('아', '다', '非敬体');
  // 最长后缀优先，保证 았어요 先于 요 等
  rules.sort((a, b) => b.suffix.length - a.suffix.length);
  return rules;
})();

interface PrefixRule {
  prefix: string;
  note: string;
}

/** 否定前缀（안/못 + 可选空格；剥离后 BFS 继续）。 */
const PREFIX_RULES: PrefixRule[] = [
  { prefix: '안 ', note: '否定' },
  { prefix: '못 ', note: '否定' },
  { prefix: '안', note: '否定' },
  { prefix: '못', note: '否定' },
];

const DUAL_POS: CoarsePos[] = ['verb', 'adjective'];

interface JamoHit {
  /** 替换末尾音节后的词干（含 다 由引擎补） */
  stemTail: string[];
  note: string;
}

function lastSyllables(word: string, n: number): (HangulSyllable | null)[] {
  const chars = [...word];
  const slice = chars.slice(Math.max(0, chars.length - n));
  return slice.map((ch) => decomposeSyllable(ch ?? ''));
}

/** 末尾 2 个音节解构为 [prev, last]（不足 2 个时 prev 为 undefined，不错位；非谚文记 null）。 */
function tailPair(word: string): { prev: HangulSyllable | null | undefined; last: HangulSyllable | null | undefined } {
  const arr = lastSyllables(word, 2);
  const last = arr[arr.length - 1];
  const prev = arr.length > 1 ? arr[arr.length - 2] : undefined;
  return { prev, last };
}

/**
 * 不规则 7 式（音节位约束；形状不符返回空）。
 * 命中时返回“词干尾音节”，引擎补 '다' 成原形。
 */
function irregularHits(word: string): JamoHit[] {
  const chars = [...word];
  if (chars.length === 0) return [];
  const hits: JamoHit[] = [];

  // ㅂ 附着（正式体）：갑니다/갑니까 → 가（ㅂ 附着于词干末，脱落复位；后跟 니/니까）。
  // 本式显式需要末尾 다/까，故不受下述“词尾 다 跳过”影响。
  if (chars.length >= 3) {
    const triple = lastSyllables(word, 3);
    const [a, b, c] = triple;
    if (
      a && b && c &&
      a.jong === 'ㅂ' &&
      b.cho === 'ㄴ' && b.jung === 'ㅣ' &&
      (c.raw === '다' || c.raw === '까')
    ) {
      const bare = composeSyllable(a.cho, a.jung, '');
      if (bare) {
        const head = chars.slice(0, chars.length - 3).join('');
        hits.push({ stemTail: [head + bare], note: '现在时' });
      }
    }
  }

  const { prev, last } = tailPair(word);
  if (!last) return hits;
  // 词尾 다 是终点/平叙标记，永不是缩约位点（防追加的 다 被二次音变，如 해다→해답다）
  if (last.raw === '다') return hits;
  const prefix = chars.slice(0, chars.length - (prev ? 2 : 1)).join('');

  // 过去 ㅆ：갔→가（终声 ㅆ 脱落）
  if (last.jong === 'ㅆ') {
    const bare = composeSyllable(last.cho, last.jung, '');
    if (bare) hits.push({ stemTail: [prefix + bare], note: '过去时' });
  }

  if (prev) {
    // ㅂ 不规则：추워→춥 / 고마워→고맙（우 + 어/아 缩约，ㅂ 复位）
    if (last.cho === 'ㅇ' && (last.jung === 'ㅝ' || last.jung === 'ㅘ') && !prev.jong) {
      const restored = composeSyllable(prev.cho, prev.jung, 'ㅂ');
      if (restored) hits.push({ stemTail: [prefix + restored], note: '不规则（ㅂ）' });
    }
    // ㄷ 不规则：들어→듣（ㄹ + 어/아，ㄷ 复位）
    if (prev.jong === 'ㄹ' && last.cho === 'ㅇ' && (last.jung === 'ㅓ' || last.jung === 'ㅏ')) {
      const restored = composeSyllable(prev.cho, prev.jung, 'ㄷ');
      if (restored) hits.push({ stemTail: [prefix + restored], note: '不规则（ㄷ）' });
    }
    // ㅅ 不规则：지어→짓（开音节 + 어/아，ㅅ 复位）
    if (!prev.jong && last.cho === 'ㅇ' && (last.jung === 'ㅓ' || last.jung === 'ㅏ')) {
      const restored = composeSyllable(prev.cho, prev.jung, 'ㅅ');
      if (restored) hits.push({ stemTail: [prefix + restored], note: '不规则（ㅅ）' });
    }
    // 르 不规则：몰라→모르（ㄹ + 라/러，르 复位）
    if (prev.jong === 'ㄹ' && last.cho === 'ㄹ' && (last.jung === 'ㅓ' || last.jung === 'ㅏ' || last.jung === 'ㅕ')) {
      const bare = composeSyllable(prev.cho, prev.jung, '');
      if (bare) hits.push({ stemTail: [prefix + bare, '르'], note: '不规则（르）' });
    }
    // 허 不规则：노래→노랗（ㄹ + 애/에，ㅎ 复位；多为颜色形容词）
    if (last.cho === 'ㄹ' && (last.jung === 'ㅐ' || last.jung === 'ㅔ')) {
      const restored = composeSyllable(last.cho, 'ㅏ', 'ㅎ');
      if (restored) hits.push({ stemTail: [prefix + prev.raw + restored], note: '不规则（허）' });
    }
  }

  // 으 不规则：커→크 / 예뻐→예쁘（어/아 前接辅音拍，ㅡ 复位；가요→그다 类分支由存在性过滤）
  if (last.jong === '' && (last.jung === 'ㅓ' || last.jung === 'ㅏ') && last.cho !== 'ㅇ') {
    const restored = composeSyllable(last.cho, 'ㅡ', '');
    if (restored) {
      hits.push({ stemTail: [prefix + (prev ? prev.raw : '') + restored], note: '不规则（으）' });
    }
  }
  return hits;
}

/**
 * 韩语活用形还原：BFS 链式展开（≤3 跳），返回去重候选（不含原形）。
 * 调用方必须用词典存在性过滤候选，命中才展示。
 */
export function deinflectKo(surface: string): KoDeinflectCandidate[] {
  const text = surface.trim();
  if (!text) return [];
  const seen = new Set<string>([text]);
  const out: KoDeinflectCandidate[] = [];
  type Node = { form: string; notes: string[]; depth: number };
  const queue: Node[] = [{ form: text, notes: [], depth: 0 }];
  const push = (base: string, notes: string[], depth: number) => {
    if (!base || seen.has(base)) return;
    seen.add(base);
    if (out.length >= MAX_CANDIDATES) return;
    const note = notes.join('+');
    for (const pos of DUAL_POS) out.push({ base, note, depth, pos });
  };
  while (queue.length > 0 && out.length < MAX_CANDIDATES) {
    const cur = queue.shift() as Node;
    if (cur.depth >= MAX_DEPTH) continue;
    // 前缀（否定）
    for (const rule of PREFIX_RULES) {
      if (!cur.form.startsWith(rule.prefix) || cur.form.length <= rule.prefix.length) continue;
      const base = cur.form.slice(rule.prefix.length);
      push(base, [...cur.notes, rule.note], cur.depth + 1);
      queue.push({ form: base, notes: [...cur.notes, rule.note], depth: cur.depth + 1 });
    }
    // 后缀（最长优先；允许整词消耗，后续由词典存在性过滤）
    for (const rule of SUFFIX_RULES) {
      if (rule.suffix.length > cur.form.length) continue;
      if (!cur.form.endsWith(rule.suffix)) continue;
      const base = cur.form.slice(0, cur.form.length - rule.suffix.length) + rule.replace;
      push(base, [...cur.notes, rule.note], cur.depth + 1);
      queue.push({ form: base, notes: [...cur.notes, rule.note], depth: cur.depth + 1 });
    }
    // 不规则（音节位约束）
    for (const hit of irregularHits(cur.form)) {
      const base = hit.stemTail.join('') + '다';
      push(base, [...cur.notes, hit.note], cur.depth + 1);
      queue.push({ form: base, notes: [...cur.notes, hit.note], depth: cur.depth + 1 });
    }
  }
  return out;
}
