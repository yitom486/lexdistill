/**
 * 词性粗分类（clean-room）。
 *
 * 解决的问题：词典来源的 partOfSpeech 写法各异（自研中文标签 / JMdict 英文标签 /
 * OEWN 单字母 / 原始 tag 回退），查词评分只需要“动词 / 形容词 / 名词 / 其他”四档，
 * 用于活用/词形还原候选与词条的匹配加分（只加分不惩罚：不匹配也保留，只排后）。
 * 判定规则为本模块自研（子串/词边界/单字母三族），未引用任何外部词性规则文件。
 */

export type CoarsePos = 'verb' | 'adjective' | 'noun' | 'other';

/**
 * 标签 → 粗分类（读侧永不抛；空/未知一律 'other'）。
 * 优先级：助动词/判断助动词先判 other（避免被“动词”子串误收），再按三族判定。
 */
export function coarsePosOfLabel(label: string | null | undefined): CoarsePos {
  if (!label) return 'other';
  const t = label.trim();
  if (!t) return 'other';
  // 中文标签族（自研中文标签 + 原始 tag 回退里的中文片段；含繁体容错）
  if (t.includes('助动词') || t.includes('助動詞') || t.includes('判断') || t.includes('判斷')) {
    return 'other';
  }
  if (t.includes('形容') || t.includes('連体') || t.includes('连体')) return 'adjective';
  if (
    t.includes('动词') || t.includes('動詞') ||
    t.includes('五段') || t.includes('一段') ||
    t.includes('カ変') || t.includes('サ変') || t.includes('ザ変')
  ) {
    return 'verb';
  }
  if (
    t.includes('名词') || t.includes('名詞') || t.includes('代词') || t.includes('代詞') ||
    t.includes('数词') || t.includes('數詞') || t.includes('量词') || t.includes('量詞')
  ) {
    return 'noun';
  }
  // 英文标签族（JMdict 英文标签，如 godan verb / i-adjective / noun）
  const lower = t.toLowerCase();
  if (/\bverb\b/.test(lower)) return 'verb';
  if (/adjectiv/.test(lower)) return 'adjective';
  if (/\bnoun\b/.test(lower) || /\bpronoun\b/.test(lower)) return 'noun';
  // OEWN 单字母族（n/v/a/s/r，见 WordNet 词性约定）
  if (/^[n]$/i.test(t)) return 'noun';
  if (/^[v]$/i.test(t)) return 'verb';
  if (/^[as]$/i.test(t)) return 'adjective';
  return 'other';
}

/** 粗分类中文名（注记展示用）。 */
export function coarsePosName(pos: CoarsePos): string {
  switch (pos) {
    case 'verb':
      return '动词';
    case 'adjective':
      return '形容词';
    case 'noun':
      return '名词';
    default:
      return '其他词性';
  }
}
