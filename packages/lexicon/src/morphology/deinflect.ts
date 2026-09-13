/**
 * 日语活用形还原（clean-room 实现，未复制 Yomitan GPL 代码）。
 *
 * 原理：后缀替换规则 + BFS 链式（最多 3 跳），终点由词典存在性过滤。
 * 规则按“语言事实”编写（五段各行/一段/カ変/サ変/形容词的标准活用），
 * 以最长后缀优先、BFS 去重、上限截断；调用方用返回的 base 查词典，命中才展示。
 * 每条规则附粗词性（动词/形容词/其他，见 part-of-speech.ts），供查词评分加分；
 * 规则来源为公开学校语法常识，未打开任何外部项目的规则文件。
 */

import type { CoarsePos } from './part-of-speech.js';

export interface DeinflectRule {
  /** 活用形后缀（假名/汉字混合均可，如 なかった） */
  suffix: string;
  /** 还原后缀 */
  replace: string;
  /** 中文活用标注（如 た形、て形+ます形由链条拼接） */
  tag: string;
  /** 该后缀剥离方向的粗词性（缺省动词；形容词/だ系显式标注） */
  pos: CoarsePos;
}

export interface DeinflectCandidate {
  base: string;
  /** 链条标注，如 'て形+ます形' */
  note: string;
  /** BFS 跳数（越小越可信，供评分） */
  depth: number;
  /** 表层词形的粗词性（链条首跳规则的 pos，供词条匹配加分） */
  pos: CoarsePos;
}

const MAX_DEPTH = 3;
const MAX_CANDIDATES = 16;

function buildRules(): DeinflectRule[] {
  const rules: DeinflectRule[] = [];
  const add = (suffix: string, replace: string, tag: string, pos: CoarsePos = 'verb') => {
    rules.push({ suffix, replace, tag, pos });
  };

  // ---- た形 / て形 → 辞書形（直白表，可读优先） ----
  const pastMap: Array<[string, string[]]> = [
    ['った', ['う', 'つ', 'る', 'く', 'ぐ']],
    ['んだ', ['ぬ', 'ぶ', 'む']],
    ['いた', ['く']],
    ['いだ', ['ぐ']],
    ['した', ['す']],
    ['って', ['う', 'つ', 'る', 'く', 'ぐ']],
    ['んで', ['ぬ', 'ぶ', 'む']],
    ['いて', ['く']],
    ['いで', ['ぐ']],
    ['して', ['す']],
  ];
  for (const [suf, reps] of pastMap) {
    for (const rep of reps) add(suf, rep, suf.endsWith('た') || suf.endsWith('だ') ? 'た形' : 'て形');
  }

  // ---- ない形 → 辞書形 ----
  const naiMap: Array<[string, string[]]> = [
    ['わない', ['う']],
    ['たない', ['つ']],
    ['らない', ['る']],
    ['まない', ['む']],
    ['ばない', ['ぶ']],
    ['なない', ['ぬ']],
    ['かない', ['く']],
    ['がない', ['ぐ']],
    ['さない', ['す']],
  ];
  for (const [suf, reps] of naiMap) {
    for (const rep of reps) add(suf, rep, 'ない形');
  }

  // ---- ます系 → 辞書形 ----
  // 五段按行展开（ます接連用形：きます→く）；一段直连（ます→る）。词典存在性过滤兜底。
  const MASU_TAILS = ['ます', 'ました', 'ません', 'ませんでした', 'ましょう'];
  const MASU_ROWS: Array<[string, string]> = [
    ['き', 'く'],
    ['ぎ', 'ぐ'],
    ['し', 'す'],
    ['ち', 'つ'],
    ['に', 'ぬ'],
    ['び', 'ぶ'],
    ['み', 'む'],
    ['り', 'る'],
    ['い', 'う'],
  ];
  for (const [head, dict] of MASU_ROWS) {
    for (const tail of MASU_TAILS) {
      add(`${head}${tail}`, dict, 'ます形');
    }
  }
  for (const tail of MASU_TAILS) {
    add(tail, 'る', 'ます形');
  }

  // ----  potential/受身/使役（五段行展开） ----
  const rowPassive: Array<[string, string]> = [
    ['かれる', 'く'],
    ['がれる', 'ぐ'],
    ['される', 'す'],
    ['たれる', 'つ'],
    ['なれる', 'ぬ'],
    ['ばれる', 'ぶ'],
    ['まれる', 'む'],
    ['われる', 'う'],
    ['られる', 'る'],
  ];
  for (const [suf, rep] of rowPassive) {
    add(suf, rep, '受身/可能形');
  }
  const rowCausative: Array<[string, string]> = [
    ['かせる', 'く'],
    ['がせる', 'ぐ'],
    ['させる', 'す'],
    ['たせる', 'つ'],
    ['なせる', 'ぬ'],
    ['ばせる', 'ぶ'],
    ['ませる', 'む'],
    ['わせる', 'う'],
    ['らせる', 'る'],
  ];
  for (const [suf, rep] of rowCausative) {
    add(suf, rep, '使役形');
  }
  add('させる', 'る', '使役形'); // 一段使役：食べさせる→食べる
  // 可能形（五段 える段）：書ける→書く
  const rowPotential: Array<[string, string]> = [
    ['ける', 'く'],
    ['げる', 'ぐ'],
    ['せる', 'す'],
    ['てる', 'つ'],
    ['ねる', 'ぬ'],
    ['べる', 'ぶ'],
    ['める', 'む'],
    ['れる', 'る'],
    ['える', 'う'],
  ];
  for (const [suf, rep] of rowPotential) {
    add(suf, rep, '可能形');
  }
  // 可能否定：書けない→書ける（再链可能形→辞書形）
  for (const [suf] of rowPotential) {
    add(`${suf.slice(0, 1)}ない`, suf, 'ない形');
  }

  // ---- 一段直接形：食べた/食べて/食べない → 食べる ----
  add('た', 'る', 'た形');
  add('て', 'る', 'て形');
  add('ない', 'る', 'ない形');

  // ---- たい形 → 辞書形（五段按行 + 一段） ----
  const TAI_ROWS: Array<[string, string]> = [
    ['きたい', 'く'],
    ['ぎたい', 'ぐ'],
    ['したい', 'す'],
    ['ちたい', 'つ'],
    ['にたい', 'ぬ'],
    ['びたい', 'ぶ'],
    ['みたい', 'む'],
    ['りたい', 'る'],
    ['いたい', 'う'],
  ];
  for (const [suf, rep] of TAI_ROWS) {
    add(suf, rep, 'たい形');
  }
  add('たい', 'る', 'たい形');
  add('たかった', 'い', '形容詞過去');

  // ---- 意向形 → 辞書形 ----
  const volMap: Array<[string, string[]]> = [
    ['おう', ['う']],
    ['こう', ['く']],
    ['ごう', ['ぐ']],
    ['そう', ['す']],
    ['とう', ['つ']],
    ['のう', ['ぬ']],
    ['ぼう', ['ぶ']],
    ['もう', ['む']],
    ['ろう', ['る']],
    ['よう', ['る']],
  ];
  for (const [suf, reps] of volMap) {
    for (const rep of reps) add(suf, rep, '意向形');
  }

  // ---- 命令形 → 辞書形 ----
  const impMap: Array<[string, string[]]> = [
    ['け', ['く']],
    ['げ', ['ぐ']],
    ['せ', ['す']],
    ['て', ['つ']],
    ['ね', ['ぬ']],
    ['べ', ['ぶ']],
    ['め', ['む']],
    ['れ', ['る']],
    ['え', ['う']],
    ['ろ', ['る']],
  ];
  for (const [suf, reps] of impMap) {
    for (const rep of reps) add(suf, rep, '命令形');
  }

  // ---- ば条件形 → 辞書形 ----
  const baMap: Array<[string, string[]]> = [
    ['けば', ['く']],
    ['げば', ['ぐ']],
    ['せば', ['す']],
    ['てば', ['つ']],
    ['ねば', ['ぬ']],
    ['べば', ['ぶ']],
    ['めば', ['む']],
    ['れば', ['る']],
    ['えば', ['う']],
  ];
  for (const [suf, reps] of baMap) {
    for (const rep of reps) add(suf, rep, 'ば形');
  }

  // ---- たら/たり → 辞書形 ----
  const taraMap: Array<[string, string[]]> = [
    ['ったら', ['う', 'つ', 'る']],
    ['んだら', ['ぬ', 'ぶ', 'む']],
    ['いたら', ['く']],
    ['いだら', ['ぐ']],
    ['したら', ['す']],
    ['ったり', ['う', 'つ', 'る']],
    ['んだり', ['ぬ', 'ぶ', 'む']],
    ['いたり', ['く']],
    ['いだり', ['ぐ']],
    ['したり', ['す']],
    ['たら', ['る']],
    ['たり', ['る']],
    ['だら', ['る']],
    ['だり', ['る']],
  ];
  for (const [suf, reps] of taraMap) {
    for (const rep of reps) add(suf, rep, suf.endsWith('り') ? 'たり形' : 'たら形');
  }

  // ---- ず（否定连用） → 辞書形 ----
  const zuMap: Array<[string, string[]]> = [
    ['かず', ['く']],
    ['がず', ['ぐ']],
    ['さず', ['す']],
    ['たず', ['つ']],
    ['なず', ['ぬ']],
    ['ばず', ['ぶ']],
    ['まず', ['む']],
    ['らず', ['る']],
    ['わず', ['う']],
  ];
  for (const [suf, reps] of zuMap) {
    for (const rep of reps) add(suf, rep, 'ず形');
  }

  // ---- 進行体剥离（链条第一跳）：～ている→～て，再走て形规则 ----
  for (const tail of ['ています', 'でいます', 'ていました', 'でいました']) {
    add(tail, tail.startsWith('で') ? 'で' : 'て', '進行体');
  }
  add('ている', 'て', '進行体');
  add('でいる', 'で', '進行体');
  add('ていた', 'て', '進行体');
  add('でいた', 'で', '進行体');
  // ～てください → ～て
  add('てください', 'て', '依頼形');
  add('でください', 'で', '依頼形');
  // ～てしまう缩约：ちゃう/じゃう → て/で
  const chauMap: Array<[string, string]> = [
    ['っちゃう', 'って'],
    ['んじゃう', 'んで'],
    ['いちゃう', 'いて'],
    ['しちゃう', 'して'],
  ];
  for (const [suf, rep] of chauMap) {
    add(suf, rep, 'てしまう缩约');
  }

  // ---- 形容词 ----
  add('かった', 'い', '形容詞過去', 'adjective');
  add('くない', 'い', '形容詞否定', 'adjective');
  add('くなかった', 'い', '形容詞否定過去', 'adjective');
  add('ければ', 'い', '形容詞仮定', 'adjective');
  add('くて', 'い', '形容詞連用', 'adjective');

  // ---- する不规则（精确优先） ----
  for (const suf of ['した', 'しない', 'します', 'して', 'しよう', 'される', 'させる', 'しろ', 'せよ', 'しなさい', 'してください']) {
    add(suf, 'する', suf === 'した' ? 'た形' : suf === 'しない' ? 'ない形' : suf === 'します' ? 'ます形' : suf === 'して' ? 'て形' : suf === 'しよう' ? '意向形' : suf === 'される' ? '受身/可能形' : suf === 'させる' ? '使役形' : suf === 'しろ' || suf === 'せよ' ? '命令形' : suf === 'しなさい' ? '命令形' : '依頼形');
  }
  // ---- 来る不规则 ----
  for (const [suf, tag] of [
    ['きた', 'た形'],
    ['きて', 'て形'],
    ['こない', 'ない形'],
    ['きます', 'ます形'],
    ['きました', 'ます形'],
    ['きましょう', '意向形'],
    ['こさせる', '使役形'],
    ['こられる', '受身/可能形'],
    ['来よう', '意向形'],
    ['来い', '命令形'],
    ['来ず', 'ず形'],
  ] as Array<[string, string]>) {
    add(suf, 'くる', tag);
    add(suf.replace(/^こ|^き/, '来'), '来る', tag);
  }
  // ---- ある特殊：ない→ある（整词精确） ----
  add('ない', 'ある', 'ない形');
  // ---- なさい一般（しなさい已在上精确覆盖） ----
  add('なさい', 'る', '命令形');
  // ---- だ系 ----
  add('だった', 'だ', 'た形', 'other');
  add('でした', 'だ', '丁寧過去', 'other');
  add('ではありません', 'だ', '否定', 'other');

  // 最长后缀优先，保证 ませんでした 先于 ます 等
  rules.sort((a, b) => b.suffix.length - a.suffix.length);
  return rules;
}

const JA_RULES = buildRules();

/**
 * 活用形还原：BFS 链式展开（≤3 跳），返回去重候选（不含原形）。
 * 调用方必须用词典存在性过滤候选，命中才展示。
 */
export function deinflectJa(surface: string): DeinflectCandidate[] {
  const text = surface.trim();
  if (!text) return [];
  const seen = new Set<string>([text]);
  const out: DeinflectCandidate[] = [];
  type Node = { form: string; notes: string[]; poss: CoarsePos[]; depth: number };
  const queue: Node[] = [{ form: text, notes: [], poss: [], depth: 0 }];
  while (queue.length > 0 && out.length < MAX_CANDIDATES) {
    const cur = queue.shift() as Node;
    if (cur.depth >= MAX_DEPTH) continue;
    for (const rule of JA_RULES) {
      if (rule.suffix.length > cur.form.length) continue;
      if (!cur.form.endsWith(rule.suffix)) continue;
      const base = cur.form.slice(0, cur.form.length - rule.suffix.length) + rule.replace;
      if (seen.has(base)) continue;
      seen.add(base);
      const notes = [...cur.notes, rule.tag];
      const poss = [...cur.poss, rule.pos];
      out.push({ base, note: notes.join('+'), depth: cur.depth + 1, pos: poss[0] ?? 'verb' });
      if (out.length >= MAX_CANDIDATES) break;
      queue.push({ form: base, notes, poss, depth: cur.depth + 1 });
    }
  }
  return out;
}
