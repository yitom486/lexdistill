import { createHash } from 'node:crypto';
import { normalizeLessonDisplayTitle } from './lesson-display-title.js';

/**
 * P1-C0.5 lesson reconciliation 原型（纯函数，不碰 DB/AST 写路径/生产）。
 *
 * 目标：reparse（同一既有 document 的 AST 整体替换）后，把新 provisional lessons
 * 与旧 canonical lessons 对齐，高置信度复用已有 lesson.id（opaque carrier，不迁移引用）。
 *
 * 非目标：首次导入的新 document、append（旧 id 本来保留）、enrich（原位修改）、
 * seed repair（不替换序列）——均不进入 reconciliation（见 Gate 补充2）。
 *
 * 两阶段：
 * 1. 单调 sequence alignment（Needleman-Wunsch，diagonal 仅在证据权重>0 时走，
 *    全零证据即全 gaps——绝不无证据配对，从构造上杜绝 crossing + 零证据 FP）；
 * 2. 置信策略（AUTO_MATCH / AMBIGUOUS / ADDED / REMOVED，宁可漏配不错配）。
 *
 * 证据分级（§4/补充4/补充6）：
 * - EXACT_FP（strong）：规范化 dialogue 行序列 sha256 相等（非空）。行规范化忽略
 *   空白（NFKC + 压缩）、中日英标点、speaker 首尾空白；行顺序敏感；中文译文、
 *   lessonNumber、页码不进指纹。
 * - TITLE_TOKEN_UNIQUE（strong，需组合）：双方高置信度标题 token 相等且在各自
 *   数组内唯一。单独 token 永不自动匹配（补充4）。
 * - SIM（supporting）：规范化全文字符 bigram Jaccard；阈值 0.8（fixture 标定：
 *   少量 OCR 修正仍 ≥0.8，整段替换远低于；见测试）。空文本 sim=0。
 * - vocab/grammar overlap、posGap 只记录作解释性证据，不参与自动匹配判定。
 */
export interface ReconDialogue {
  speaker: string;
  japanese: string;
}

export interface ReconLessonInput {
  id: string;
  title: string;
  dialogues: ReconDialogue[];
  vocabularies?: Array<{ surface: string }>;
}

export interface PairEvidence {
  exactFp: boolean;
  /** 双方 token 相等（任一 null 即 false） */
  tokenEqual: boolean;
  /** token 在旧/新数组内各自唯一 */
  tokenUniqueOld: boolean;
  tokenUniqueNew: boolean;
  /** bigram Jaccard（空文本=0） */
  sim: number;
  vocabOverlap: number;
  /** |oldIndex-newIndex|（仅解释用） */
  posGap: number;
  oldToken: string | null;
  newToken: string | null;
}

export type NewStatus = 'AUTO_MATCH' | 'ADDED' | 'AMBIGUOUS';
export type OldStatus = 'MATCHED' | 'REMOVED' | 'AMBIGUOUS';

export interface ReconPair {
  oldId: string;
  oldIndex: number;
  newIndex: number;
  newProvisionalId: string;
  status: 'AUTO_MATCH' | 'AMBIGUOUS';
  evidence: PairEvidence;
  competitors: Array<{ side: 'old' | 'new'; id: string; reason: string }>;
  rejectReason: string | null;
}

export interface ReconAdded {
  newIndex: number;
  newProvisionalId: string;
  status: 'ADDED' | 'AMBIGUOUS';
  reason: string;
}

export interface ReconRemoved {
  oldIndex: number;
  oldId: string;
  status: 'REMOVED' | 'AMBIGUOUS';
  reason: string;
}

export interface ReconciledLesson {
  index: number;
  /** AUTO_MATCH 复用 oldId；否则保留 provisional id */
  id: string;
  idSource: 'preserved-old' | 'new-provisional';
  status: NewStatus;
  title: string;
}

export interface ReconcileResult {
  pairs: ReconPair[];
  added: ReconAdded[];
  removed: ReconRemoved[];
  /** split/merge/absorb 候选（relationship 级，不塞进 AUTO/ADDED） */
  relations: Array<{ kind: 'split-candidate' | 'merge-candidate' | 'absorb-candidate'; oldIds: string[]; newIds: string[]; reason: string }>;
  reconciledLessons: ReconciledLesson[];
}

/** SIM 自动匹配阈值（fixture 标定，见 lesson-reconciliation.test.ts 边界用例）。 */
export const SIM_AUTO_THRESHOLD = 0.8;

const CJK_PUNCT = /[、。！？；：…—・「」『』（）【】〈〉《》・"“”‘’'()[\]{}<>|/\\~～@#$%^&*+=_]|[\u2000-\u206F\u3000]/g;

function normText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(CJK_PUNCT, '')
    .replace(/\s+/g, '')
    .trim();
}

function normSpeaker(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normLines(lesson: ReconLessonInput): string[] {
  const out: string[] = [];
  for (const d of lesson.dialogues ?? []) {
    const tx = normText(d.japanese ?? '');
    if (!tx) continue;
    out.push(`${normSpeaker(d.speaker ?? '')}|${tx}`);
  }
  return out;
}

function fingerprint(lesson: ReconLessonInput): { hash: string; nonEmpty: boolean } {
  const lines = normLines(lesson);
  if (lines.length === 0) return { hash: '', nonEmpty: false };
  return { hash: createHash('sha256').update(lines.join('\n')).digest('hex'), nonEmpty: true };
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) set.add(s.slice(i, i + 2));
  return set;
}

function bigramSim(a: string[], b: string[]): number {
  const ta = a.join('');
  const tb = b.join('');
  if (!ta || !tb) return 0;
  const sa = bigrams(ta);
  const sb = bigrams(tb);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function vocabSet(lesson: ReconLessonInput): Set<string> {
  return new Set((lesson.vocabularies ?? []).map((v) => normText(v.surface)).filter((s) => s));
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function textBigrams(lines: string[]): Set<string> {
  return bigrams(lines.join(''));
}

/** split/merge 强连接：overlap 高（含被包含）且 Jaccard 不过低（排除单行偶然包含）。 */
function strongLink(oLines: string[], nLines: string[]): boolean {
  const so = textBigrams(oLines);
  const sn = textBigrams(nLines);
  if (so.size === 0 || sn.size === 0) return false;
  let inter = 0;
  for (const g of so) if (sn.has(g)) inter++;
  const overlap = inter / Math.min(so.size, sn.size);
  const jaccard = inter / (so.size + sn.size - inter);
  return overlap >= SIM_AUTO_THRESHOLD && jaccard >= 0.3;
}

function tokenOf(lesson: ReconLessonInput): string | null {
  return normalizeLessonDisplayTitle(lesson.title);
}

function tokenCounts(lessons: ReconLessonInput[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lessons) {
    const t = tokenOf(l);
    if (t) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

function pairEvidence(
  o: ReconLessonInput,
  oi: number,
  n: ReconLessonInput,
  ni: number,
  oldTokCount: Map<string, number>,
  newTokCount: Map<string, number>,
  oFp: { hash: string; nonEmpty: boolean },
  nFp: { hash: string; nonEmpty: boolean },
  oLines: string[][],
  nLines: string[][]
): PairEvidence {
  const oldToken = tokenOf(o);
  const newToken = tokenOf(n);
  return {
    exactFp: oFp.nonEmpty && nFp.nonEmpty && oFp.hash === nFp.hash,
    tokenEqual: oldToken !== null && oldToken === newToken,
    tokenUniqueOld: oldToken !== null && (oldTokCount.get(oldToken) ?? 0) === 1,
    tokenUniqueNew: newToken !== null && (newTokCount.get(newToken) ?? 0) === 1,
    sim: bigramSim(oLines[oi] ?? [], nLines[ni] ?? []),
    vocabOverlap: jaccardSet(vocabSet(o), vocabSet(n)),
    posGap: Math.abs(oi - ni),
    oldToken,
    newToken,
  };
}

/** DP 权重（仅用于单调对齐的相对排序；AUTO 判定另走严格策略，不直接由分數决定）。 */
function pairWeight(e: PairEvidence): number {
  if (e.exactFp) return 3;
  if (e.tokenEqual && e.tokenUniqueOld && e.tokenUniqueNew && e.sim >= SIM_AUTO_THRESHOLD) return 2;
  if (e.sim >= SIM_AUTO_THRESHOLD) return 1;
  return 0;
}

interface DiagPair {
  oi: number;
  ni: number;
  w: number;
}

/** Needleman-Wunsch：diagonal 仅在 w>0 且不劣于 gaps 时走；全零证据即全 gaps。 */
function align(weights: number[][]): DiagPair[] {
  const m = weights.length;
  const n = m > 0 ? (weights[0]?.length ?? 0) : 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const w = weights[i - 1]?.[j - 1] ?? 0;
      const diag = (dp[i - 1]?.[j - 1] ?? 0) + w;
      const up = dp[i - 1]?.[j] ?? 0;
      const left = dp[i]?.[j - 1] ?? 0;
      dp[i]![j] = Math.max(diag, up, left);
    }
  }
  const pairs: DiagPair[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const w = weights[i - 1]?.[j - 1] ?? 0;
    const diag = (dp[i - 1]?.[j - 1] ?? 0) + w;
    const best = dp[i]?.[j] ?? 0;
    if (w > 0 && diag >= best && diag >= (dp[i - 1]?.[j] ?? 0) && diag >= (dp[i]?.[j - 1] ?? 0)) {
      pairs.push({ oi: i - 1, ni: j - 1, w });
      i--;
      j--;
    } else if ((dp[i - 1]?.[j] ?? 0) >= (dp[i]?.[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

export function reconcileLessons(
  oldLessons: ReconLessonInput[],
  newLessons: ReconLessonInput[]
): ReconcileResult {
  const oldTokCount = tokenCounts(oldLessons);
  const newTokCount = tokenCounts(newLessons);
  const oFp = oldLessons.map(fingerprint);
  const nFp = newLessons.map(fingerprint);
  const oLines = oldLessons.map(normLines);
  const nLines = newLessons.map(normLines);

  const ev: PairEvidence[][] = oldLessons.map((o, oi) =>
    newLessons.map((n, ni) =>
      pairEvidence(o, oi, n, ni, oldTokCount, newTokCount, oFp[oi]!, nFp[ni]!, oLines, nLines)
    )
  );
  const diag = align(ev.map((row) => row.map(pairWeight)));

  // split/merge 关系预检（SIM_HIGH 连接数；exact 同理计入）：涉及课全部 AMBIGUOUS。
  const splitOld = new Set<number>();
  const mergeNew = new Set<number>();
  const relations: ReconcileResult['relations'] = [];
  oldLessons.forEach((o, oi) => {
    const hits = newLessons
      .map((n, ni) => ({
        ni,
        id: n.id,
        strong:
          (ev[oi]?.[ni]?.exactFp ?? false) || strongLink(oLines[oi] ?? [], nLines[ni] ?? []),
      }))
      .filter((h) => h.strong);
    if (hits.length >= 2) {
      splitOld.add(oi);
      relations.push({
        kind: 'split-candidate',
        oldIds: [o.id],
        newIds: hits.map((h) => h.id),
        reason: `旧课同时强连接到 ${hits.length} 个新课`,
      });
    }
  });
  newLessons.forEach((n, ni) => {
    const hits = oldLessons
      .map((o, oi) => ({
        oi,
        id: o.id,
        strong:
          (ev[oi]?.[ni]?.exactFp ?? false) || strongLink(oLines[oi] ?? [], nLines[ni] ?? []),
      }))
      .filter((h) => h.strong);
    if (hits.length >= 2) {
      mergeNew.add(ni);
      relations.push({
        kind: 'merge-candidate',
        oldIds: hits.map((h) => h.id),
        newIds: [n.id],
        reason: `新课同时强连接到 ${hits.length} 个旧课`,
      });
    }
  });

  // exact 指纹在任一侧重复 → 涉及对全部 AMBIGUOUS（无法区分 copy）。
  const oFpCount = new Map<string, number>();
  const nFpCount = new Map<string, number>();
  oFp.forEach((f) => { if (f.nonEmpty) oFpCount.set(f.hash, (oFpCount.get(f.hash) ?? 0) + 1); });
  nFp.forEach((f) => { if (f.nonEmpty) nFpCount.set(f.hash, (nFpCount.get(f.hash) ?? 0) + 1); });

  const pairs: ReconPair[] = [];
  const matchedOld = new Set<number>();
  const matchedNew = new Set<number>();

  for (const d of diag) {
    const o = oldLessons[d.oi]!;
    const n = newLessons[d.ni]!;
    const e = ev[d.oi]![d.ni]!;
    const competitors: ReconPair['competitors'] = [];
    // 竞争候选：同等或近似证据指向同一新课/旧课
    oldLessons.forEach((o2, oi2) => {
      if (oi2 === d.oi) return;
      const e2 = ev[oi2]![d.ni]!;
      if (e2.exactFp && e.exactFp) competitors.push({ side: 'old', id: o2.id, reason: '同exact指纹' });
      else if (e2.sim >= SIM_AUTO_THRESHOLD && e.sim >= SIM_AUTO_THRESHOLD - 0.1) {
        competitors.push({ side: 'old', id: o2.id, reason: `近似sim=${e2.sim.toFixed(2)}` });
      }
    });
    newLessons.forEach((n2, ni2) => {
      if (ni2 === d.ni) return;
      const e2 = ev[d.oi]![ni2]!;
      if (e2.exactFp && e.exactFp) competitors.push({ side: 'new', id: n2.id, reason: '同exact指纹' });
      else if (e2.sim >= SIM_AUTO_THRESHOLD && e.sim >= SIM_AUTO_THRESHOLD - 0.1) {
        competitors.push({ side: 'new', id: n2.id, reason: `近似sim=${e2.sim.toFixed(2)}` });
      }
    });

    let status: 'AUTO_MATCH' | 'AMBIGUOUS' = 'AMBIGUOUS';
    let rejectReason: string | null = null;
    const inSplitMerge = splitOld.has(d.oi) || mergeNew.has(d.ni);
    const fpDup = (e.exactFp && ((oFpCount.get(oFp[d.oi]!.hash) ?? 0) > 1 || (nFpCount.get(nFp[d.ni]!.hash) ?? 0) > 1));
    if (inSplitMerge) {
      rejectReason = 'split/merge候选关系内，不自动匹配';
    } else if (fpDup) {
      rejectReason = 'exact指纹在单侧重复，无法区分';
    } else if (competitors.length > 0) {
      rejectReason = `存在${competitors.length}个竞争候选`;
    } else if (e.exactFp) {
      status = 'AUTO_MATCH';
    } else if (e.tokenEqual && e.tokenUniqueOld && e.tokenUniqueNew && e.sim >= SIM_AUTO_THRESHOLD) {
      status = 'AUTO_MATCH';
    } else {
      rejectReason = '证据不足（需exact指纹，或唯一标题token+sim≥阈值）';
    }
    pairs.push({
      oldId: o.id, oldIndex: d.oi, newIndex: d.ni, newProvisionalId: n.id,
      status, evidence: e, competitors, rejectReason,
    });
    matchedOld.add(d.oi);
    matchedNew.add(d.ni);
  }

  const added: ReconAdded[] = [];
  newLessons.forEach((n, ni) => {
    if (matchedNew.has(ni)) return;
    if (mergeNew.has(ni)) {
      added.push({ newIndex: ni, newProvisionalId: n.id, status: 'AMBIGUOUS', reason: 'merge候选：可能由多旧课合并' });
    } else {
      added.push({ newIndex: ni, newProvisionalId: n.id, status: 'ADDED', reason: '无对齐旧课' });
    }
  });
  const removed: ReconRemoved[] = [];
  oldLessons.forEach((o, oi) => {
    if (matchedOld.has(oi)) return;
    if (splitOld.has(oi)) {
      removed.push({ oldIndex: oi, oldId: o.id, status: 'AMBIGUOUS', reason: 'split候选：可能拆成多新课' });
    } else {
      removed.push({ oldIndex: oi, oldId: o.id, status: 'REMOVED', reason: '无对齐新课' });
    }
  });
  // 旧侧状态推导（补充5）：DP 配对中的旧课看 pairs[].status（AUTO_MATCH→MATCHED，
  // AMBIGUOUS→AMBIGUOUS）；未配对的看 removed[]（REMOVED 或 split-AMBIGUOUS）。
  // 新侧同理：pairs[] / added[] / reconciledLessons[].status。

  // absorb 降级（真 FP 回归）：AUTO 对 (o,n) 若吞掉了另一个未匹配旧课 o' 的全部
  // 实质内容（o' 文本被包含进 n，o' 自身 REMOVED），说明 n 是合并/吸收体而非 o 本身，
  // 不得把 o 的 id 给 n。o' 需 ≥20 规范化字符（排除「はい」类单句偶然包含）。
  const removedByIdx = new Map(removed.filter((x) => x.status === 'REMOVED').map((x) => [x.oldIndex, x]));
  for (const p of pairs) {
    if (p.status !== 'AUTO_MATCH') continue;
    const nSet = textBigrams(nLines[p.newIndex] ?? []);
    if (nSet.size === 0) continue;
    for (const [oi, rem] of removedByIdx) {
      const oSet = textBigrams(oLines[oi] ?? []);
      const oLen = (oLines[oi] ?? []).join('').length;
      if (oSet.size === 0 || oLen < 20) continue;
      let inter = 0;
      for (const g of oSet) if (nSet.has(g)) inter++;
      if (inter / oSet.size >= SIM_AUTO_THRESHOLD) {
        p.status = 'AMBIGUOUS';
        p.rejectReason = `吸收体：未匹配旧课 ${rem.oldId} 的实质内容被包含`;
        p.competitors.push({ side: 'old', id: rem.oldId, reason: '内容被新课吸收（overlap≥阈值）' });
        rem.status = 'AMBIGUOUS';
        rem.reason = `内容被新课吸收（候选并入 ${p.newProvisionalId}，不自动映射）`;
        relations.push({
          kind: 'absorb-candidate',
          oldIds: [p.oldId, rem.oldId],
          newIds: [p.newProvisionalId],
          reason: '新课同时覆盖 AUTO 旧课与另一未匹配旧课的实质内容',
        });
        break;
      }
    }
  }

  const reconciledLessons: ReconciledLesson[] = newLessons.map((n, ni) => {
    const p = pairs.find((x) => x.newIndex === ni);
    if (p && p.status === 'AUTO_MATCH') {
      return { index: ni, id: p.oldId, idSource: 'preserved-old', status: 'AUTO_MATCH', title: n.title };
    }
    if (p) {
      return { index: ni, id: n.id, idSource: 'new-provisional', status: 'AMBIGUOUS', title: n.title };
    }
    const a = added.find((x) => x.newIndex === ni)!;
    return { index: ni, id: n.id, idSource: 'new-provisional', status: a.status === 'ADDED' ? 'ADDED' : 'AMBIGUOUS', title: n.title };
  });

  return { pairs, added, removed, relations, reconciledLessons };
}
