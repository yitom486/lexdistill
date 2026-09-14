/**
 * 声调基准词表（Gateway 课程资产）。
 * 非 OJAD 直连：权威词典对接前作为 lookup_pitch / list_pitch_benchmarks 的 SSOT。
 */
export type PitchLevel = 'L' | 'H';

export type PitchTypeLabel = '平板型 (⓪)' | '头高型 (①)' | '中高型 (②/③)' | '尾高型';

export interface PitchContrastPair {
  kanji: string;
  kana: string;
  pitchType: string;
  pitchPattern: PitchLevel[];
  meaning: string;
}

export interface PitchLexiconEntry {
  id: string;
  kanji: string;
  kana: string;
  romaji: string;
  meaning: string;
  pitchType: PitchTypeLabel;
  pitchPattern: PitchLevel[];
  moraList: string[];
  contrastPair?: PitchContrastPair;
  tip: string;
}

export const PITCH_LEXICON: PitchLexiconEntry[] = [
  {
    id: 'p1',
    kanji: '雨',
    kana: 'あめ',
    romaji: 'ame',
    meaning: '下雨 (Rain)',
    pitchType: '头高型 (①)',
    pitchPattern: ['H', 'L'],
    moraList: ['あ', 'め'],
    contrastPair: {
      kanji: '飴',
      kana: 'あめ',
      pitchType: '平板型 (⓪)',
      pitchPattern: ['L', 'H'],
      meaning: '糖果 (Candy)',
    },
    tip: '第一拍「あ」高声发音，第二拍「め」立刻坠落至低音。切勿发成平调！',
  },
  {
    id: 'p2',
    kanji: '箸',
    kana: 'はし',
    romaji: 'hashi',
    meaning: '筷子 (Chopsticks)',
    pitchType: '头高型 (①)',
    pitchPattern: ['H', 'L'],
    moraList: ['は', 'し'],
    contrastPair: {
      kanji: '橋',
      kana: 'はし',
      pitchType: '尾高型',
      pitchPattern: ['L', 'H'],
      meaning: '桥梁 (Bridge)',
    },
    tip: '「箸」是头高型①，而「橋」是尾高型（后接助词时助词下降），「端」是平板型⓪。',
  },
  {
    id: 'p3',
    kanji: '日本人',
    kana: 'にほんじん',
    romaji: 'nihonjin',
    meaning: '日本人',
    pitchType: '尾高型',
    pitchPattern: ['L', 'H', 'H', 'H', 'L'],
    moraList: ['に', 'ほ', 'ん', 'じ', 'ん'],
    tip: '第一拍「に」低，第二拍至第四拍「ほんじ」维持高位，在末尾拍下降。',
  },
  {
    id: 'p4',
    kanji: 'はじめまして',
    kana: 'はじめまして',
    romaji: 'hajimemashite',
    meaning: '初次见面',
    pitchType: '中高型 (②/③)',
    pitchPattern: ['L', 'H', 'H', 'H', 'L', 'L', 'L'],
    moraList: ['は', 'じ', 'め', 'ま', 'し', 'て'],
    tip: '初学者常见毛病是每一拍都说一样平。在「め」达到峰值后逐渐回落。',
  },
  {
    id: 'p5',
    kanji: '花',
    kana: 'はな',
    romaji: 'hana',
    meaning: '花 (Flower)',
    pitchType: '尾高型',
    pitchPattern: ['L', 'H'],
    moraList: ['は', 'な'],
    contrastPair: {
      kanji: '鼻',
      kana: 'はな',
      pitchType: '平板型 (⓪)',
      pitchPattern: ['L', 'H'],
      meaning: '鼻子 (Nose)',
    },
    tip: '「花」尾高型：后接助词「が」时助词下降；「鼻」平板型：助词仍保持高音。',
  },
  {
    id: 'p6',
    kanji: '今',
    kana: 'いま',
    romaji: 'ima',
    meaning: '现在 (Now)',
    pitchType: '头高型 (①)',
    pitchPattern: ['H', 'L'],
    moraList: ['い', 'ま'],
    tip: '两拍头高型：第一拍高、第二拍立刻落下，语感干脆短促。',
  },
  {
    id: 'p7',
    kanji: '私',
    kana: 'わたし',
    romaji: 'watashi',
    meaning: '我 (I)',
    pitchType: '头高型 (①)',
    pitchPattern: ['H', 'L', 'L'],
    moraList: ['わ', 'た', 'し'],
    tip: '第一拍「わ」最高，其后维持低位；勿把「たし」抬高成中高型。',
  },
  {
    id: 'p8',
    kanji: '家族',
    kana: 'かぞく',
    romaji: 'kazoku',
    meaning: '家人 (Family)',
    pitchType: '中高型 (②/③)',
    pitchPattern: ['L', 'H', 'L'],
    moraList: ['か', 'ぞ', 'く'],
    tip: '核在第二拍「ぞ」：低→高→低，是典型三拍中高型。',
  },
  {
    id: 'p9',
    kanji: '先生',
    kana: 'せんせい',
    romaji: 'sensei',
    meaning: '老师 (Teacher)',
    pitchType: '头高型 (①)',
    pitchPattern: ['H', 'L', 'L', 'L'],
    moraList: ['せ', 'ん', 'せ', 'い'],
    tip: '「せ」起高后整段低走；注意拨音「ん」也占一拍。',
  },
  {
    id: 'p10',
    kanji: '学生',
    kana: 'がくせい',
    romaji: 'gakusei',
    meaning: '学生 (Student)',
    pitchType: '中高型 (②/③)',
    pitchPattern: ['L', 'H', 'H', 'L'],
    moraList: ['が', 'く', 'せ', 'い'],
    tip: '第二拍起高，在「い」前回落；与「先生」头高型形成对照练习。',
  },
];

/** 从用户自然语言里抽出可能的词面（汉字/假名/罗马字片段） */
export function extractPitchQueryTokens(prompt: string): string[] {
  const raw = prompt.trim();
  if (!raw) return [];
  const tokens = new Set<string>();
  for (const m of raw.matchAll(/[一-龯々〆ヵヶ]{1,8}/g)) {
    tokens.add(m[0]!);
  }
  for (const m of raw.matchAll(/[ぁ-んァ-ンー]{2,12}/g)) {
    tokens.add(m[0]!);
  }
  for (const m of raw.matchAll(/\b[a-zA-Z]{2,16}\b/g)) {
    tokens.add(m[0]!.toLowerCase());
  }
  // 「」『』包裹
  for (const m of raw.matchAll(/[「『]([^」』]{1,12})[」』]/g)) {
    tokens.add(m[1]!);
  }
  return [...tokens];
}

export function formatPitchLexiconCoachReply(
  prompt: string,
  entries: PitchLexiconEntry[]
): string {
  if (entries.length === 0) {
    return (
      `【课程声调词表】未命中「${prompt.slice(0, 40)}」。` +
      `可打开「声调纠音」浏览基准词，或换用汉字/假名再问一次。正式 OJAD 接入前请勿让模型臆造核型。`
    );
  }
  const blocks = entries.slice(0, 3).map((e, i) => {
    const pattern = e.pitchPattern.join('→');
    const mora = e.moraList.join('·');
    const contrast = e.contrastPair
      ? `\n   对立：${e.contrastPair.kanji}（${e.contrastPair.kana}）· ${e.contrastPair.pitchType} · ${e.contrastPair.meaning}`
      : '';
    return (
      `${i + 1}. **${e.kanji}**（${e.kana} / ${e.romaji}）\n` +
      `   ${e.pitchType} · 拍：${mora} · 走向：${pattern}\n` +
      `   释义：${e.meaning}\n` +
      `   提示：${e.tip}` +
      contrast
    );
  });
  return (
    `【课程声调词表 · 非 OJAD】根据你的提问匹配到 ${Math.min(entries.length, 3)} 条基准词：\n\n` +
    blocks.join('\n\n') +
    `\n\n建议在「声调纠音」页对照标准走向练读；权威词典对接后会替换为 OJAD 等在线检索。`
  );
}

/**
 * 轻量旁路：优先用本地词表回答声调/读音类问题。
 * 返回 null 表示应交由通用 ResponsesAdapter stub。
 */
export function tryPitchLexiconCoachReply(prompt: string): string | null {
  const looksPitch = /读|発音|发音|声调|pitch|假名|五十音|どう読む|読み方/i.test(prompt);
  if (!looksPitch) return null;

  const tokens = extractPitchQueryTokens(prompt);
  let hits: PitchLexiconEntry[] = [];
  for (const t of tokens) {
    hits = hits.concat(lookupPitchEntries(t));
  }
  // 去重
  const seen = new Set<string>();
  hits = hits.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  if (hits.length === 0 && tokens.length === 0) {
    // 泛问「声调怎么练」→ 给前几条示范
    hits = PITCH_LEXICON.slice(0, 3);
  }

  return formatPitchLexiconCoachReply(prompt, hits);
}

export function lookupPitchEntries(query: string): PitchLexiconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...PITCH_LEXICON];
  return PITCH_LEXICON.filter(
    (e) =>
      e.kanji.includes(q) ||
      e.kana.includes(q) ||
      e.romaji.toLowerCase().includes(q) ||
      e.meaning.toLowerCase().includes(q)
  );
}
