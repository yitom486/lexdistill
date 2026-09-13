/**
 * 英语词形还原（clean-room 实现，未复制任何外部项目的规则文件）。
 *
 * 方法：初级学校语法纲要（复数/三单/过去/分词/比较级）+ 极小不规则表，
 * 全部单跳候选，由调用方用词典存在性过滤（不存在即丢弃，不展示）。
 * 每条候选附中文注记与粗词性，供查词评分加分；只加分不惩罚。
 */

import type { CoarsePos } from './part-of-speech.js';

export interface StemCandidate {
  base: string;
  /** 中文变化注记（如 复数、过去式） */
  note: string;
  depth: number;
  /** 表层词形的粗词性（供词条匹配加分） */
  pos: CoarsePos;
}

const MAX_CANDIDATES = 12;

/** 极小不规则表（公开基础词汇事实；拼写不能由后缀规则得到者）。 */
const IRREGULARS: Array<[string, string, string, CoarsePos]> = [
  ['am', 'be', '不规则变化', 'verb'],
  ['is', 'be', '不规则变化', 'verb'],
  ['are', 'be', '不规则变化', 'verb'],
  ['was', 'be', '不规则变化', 'verb'],
  ['were', 'be', '不规则变化', 'verb'],
  ['been', 'be', '不规则变化', 'verb'],
  ['has', 'have', '不规则变化', 'verb'],
  ['had', 'have', '不规则变化', 'verb'],
  ['does', 'do', '不规则变化', 'verb'],
  ['did', 'do', '不规则变化', 'verb'],
  ['done', 'do', '不规则变化', 'verb'],
  ['goes', 'go', '不规则变化', 'verb'],
  ['went', 'go', '不规则变化', 'verb'],
  ['gone', 'go', '不规则变化', 'verb'],
  ['says', 'say', '不规则变化', 'verb'],
  ['said', 'say', '不规则变化', 'verb'],
  ['children', 'child', '不规则变化', 'noun'],
  ['men', 'man', '不规则变化', 'noun'],
  ['women', 'woman', '不规则变化', 'noun'],
  ['teeth', 'tooth', '不规则变化', 'noun'],
  ['feet', 'foot', '不规则变化', 'noun'],
  ['mice', 'mouse', '不规则变化', 'noun'],
  ['geese', 'goose', '不规则变化', 'noun'],
];

function isConsonant(ch: string): boolean {
  return /^[bcdfghjklmnpqrstvwxz]$/.test(ch);
}

/**
 * 英语词形还原：返回去重候选（不含原形）。
 * 调用方必须用词典存在性过滤候选，命中才展示。
 */
export function stemEn(word: string): StemCandidate[] {
  const text = word.trim().toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(text) || text.length < 3) return [];
  const out: StemCandidate[] = [];
  const seen = new Set<string>([text]);
  const push = (base: string, note: string, pos: CoarsePos) => {
    if (!base || seen.has(`${base}\n${note}\n${pos}`)) return;
    seen.add(`${base}\n${note}\n${pos}`);
    if (out.length < MAX_CANDIDATES) out.push({ base, note, depth: 1, pos });
  };

  for (const [surface, base, note, pos] of IRREGULARS) {
    if (text === surface) push(base, note, pos);
  }

  // 所有格：cat's → cat
  if (text.endsWith("'s") && text.length > 3) {
    push(text.slice(0, -2), '所有格', 'noun');
  } else if (text.endsWith("'") && text.length > 3) {
    push(text.slice(0, -1), '所有格', 'noun');
  }

  // 复数 / 三单：stories → story；watches → watch；potatoes → potato；runs → run
  if (text.endsWith('ies') && text.length > 4) {
    const base = `${text.slice(0, -3)}y`;
    push(base, '复数', 'noun');
    push(base, '三单', 'verb');
  } else if (
    /(?:[sxz]es|ches|shes)$/.test(text) &&
    text.length > 4
  ) {
    const base = text.slice(0, -2);
    push(base, '复数', 'noun');
    push(base, '三单', 'verb');
  } else if (text.endsWith('oes') && text.length > 4) {
    const base = text.slice(0, -2);
    push(base, '复数', 'noun');
  } else if (
    text.endsWith('s') &&
    text.length > 3 &&
    !/(?:ss|us|is|ous)$/.test(text)
  ) {
    const base = text.slice(0, -1);
    push(base, '复数', 'noun');
    push(base, '三单', 'verb');
  }

  // 过去式 / 过去分词：tried → try；stopped → stop；liked → like/lik；walked → walk
  if (text.endsWith('ied') && text.length > 4) {
    push(`${text.slice(0, -3)}y`, '过去式', 'verb');
  } else if (/([bcdfghjklmnpqrstvwxz])\1ed$/.test(text) && text.length > 5) {
    push(text.slice(0, -3), '过去式', 'verb');
  } else if (text.endsWith('eed') && text.length > 4) {
    push(text.slice(0, -1), '过去式', 'verb');
  } else if (text.endsWith('ed') && text.length > 4) {
    push(text.slice(0, -2), '过去式', 'verb');
    push(text.slice(0, -1), '过去式', 'verb');
  }

  // 现在分词：lying → lie；running → run；making → make/mak
  if (text.endsWith('ying') && text.length > 5) {
    push(`${text.slice(0, -4)}ie`, '现在分词', 'verb');
  } else if (/([bcdfghjklmnpqrstvwxz])\1ing$/.test(text) && text.length > 6) {
    push(text.slice(0, -4), '现在分词', 'verb');
  } else if (text.endsWith('ing') && text.length > 5) {
    push(text.slice(0, -3), '现在分词', 'verb');
    push(`${text.slice(0, -3)}e`, '现在分词', 'verb');
  }

  // 比较级 / 最高级：happier → happy；bigger → big；larger → large/larg
  if (text.endsWith('iest') && text.length > 5) {
    push(`${text.slice(0, -4)}y`, '最高级', 'adjective');
  } else if (/([bcdfghjklmnpqrstvwxz])\1est$/.test(text) && text.length > 6) {
    push(text.slice(0, -4), '最高级', 'adjective');
  } else if (text.endsWith('est') && text.length > 5) {
    push(text.slice(0, -3), '最高级', 'adjective');
    push(`${text.slice(0, -3)}e`, '最高级', 'adjective');
  } else if (text.endsWith('ier') && text.length > 4 && isConsonant(text[text.length - 4] ?? '')) {
    push(`${text.slice(0, -3)}y`, '比较级', 'adjective');
  } else if (/([bcdfghjklmnpqrstvwxz])\1er$/.test(text) && text.length > 5) {
    push(text.slice(0, -3), '比较级', 'adjective');
  } else if (text.endsWith('er') && text.length > 4) {
    push(text.slice(0, -2), '比较级', 'adjective');
    push(`${text.slice(0, -2)}e`, '比较级', 'adjective');
  }

  // 副词：quickly → quick
  if (text.endsWith('ly') && text.length > 5) {
    push(text.slice(0, -2), '副词', 'adjective');
  }

  return out;
}
