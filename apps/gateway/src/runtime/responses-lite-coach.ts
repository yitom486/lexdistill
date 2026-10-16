/**
 * responses-lite 课程资产旁路：本地 SSOT 优先于 stub。
 * 不引入厂商 SDK；OJAD 等权威词典由其他通路接入。
 */
import {
  tryPitchLexiconCoachReply,
  formatPitchLexiconCoachReply,
  lookupPitchEntries,
  extractPitchQueryTokens,
} from '@lexdistill/storage-sqlite';
import { KANA_SEEDS } from '@lexdistill/storage-sqlite';
import { HANGUL_SEEDS } from '@lexdistill/storage-sqlite';

export type LiteTrack = 'ja' | 'en' | 'ko';

export interface LiteCoachHit {
  reply: string;
  source: 'pitch-lexicon' | 'kana-seed' | 'hangul-seed' | 'particle-tip';
}

const PARTICLE_TIPS: Array<{
  tracks: LiteTrack[];
  match: RegExp;
  reply: string;
}> = [
  {
    tracks: ['ja'],
    match: /に\s*vs\s*で|にとで|でとに|助词.*に|助词.*で|に\/で|で\/に/,
    reply:
      '【课程助词 · に vs で】\n' +
      '· 「に」：存在/归着点、到达点、时间点（本がある／学校に行く／３時に）。\n' +
      '· 「で」：动作发生的场所、手段、范围（図書館で勉強する／バスで行く）。\n' +
      '口诀：静态坐标多用に，动态发生场所多用で。需要例句/出题请走学习闭环。',
  },
  {
    tracks: ['ja'],
    match: /助词.*を|を\s*的|宾语.*を/,
    reply:
      '【课程助词 · を】标记他动词的宾语（本を読む），也用于经过点（公園を歩く）。勿与存在句的「が」混淆。',
  },
  {
    tracks: ['ja'],
    match: /助词.*が|が\s*的|主语.*が/,
    reply:
      '【课程助词 · が】常标示主语/对象（雨が降る／日本語が好き）。对比「は」：が偏新信息焦点，は偏主题对照。',
  },
  {
    tracks: ['ja'],
    match: /助词.*は|主题.*は|は\s*vs\s*が/,
    reply:
      '【课程助词 · は】主题提示（私は学生です）。与「が」：は＝已知主题/对比，が＝中立主语或焦点。',
  },
  {
    tracks: ['ko'],
    match: /에서|조사.*에서|에서\s*vs\s*에|에\s*vs\s*에서/,
    reply:
      '【과정 조사 · 에서 vs 에】\n' +
      '· 「에서」：동작이 일어나는 장소（도서관에서 공부해요）.\n' +
      '· 「에」：존재·도착 지점（학교에 있어요／서울에 가요）.\n' +
      '동작 장소=에서, 존재/도착=에.',
  },
  {
    tracks: ['ko'],
    match: /은\/는|이\/가|조사.*은|조사.*는|주제.*은/,
    reply:
      '【과정 조사 · 은/는 vs 이/가】은/는＝주제·대조，이/가＝주어·초점. 새 정보나 강조는 이/가 쪽.',
  },
  {
    tracks: ['en'],
    match: /preposition|介词|in\s*vs\s*on|at\s*vs\s*in|collocation/,
    reply:
      '【Lite tip · prepositions】Prefer verb+preposition collocations in context (depend on, interested in). ' +
      'For place: at (point), in (area/container), on (surface). Ask for examples via the learning loop if you need drills.',
  },
];

/**
 * 解析 lite 旁路：课程资产命中则返回文案；否则 null（交给 ResponsesAdapter stub）。
 */
export function resolveResponsesLiteCoach(params: {
  prompt: string;
  track: LiteTrack;
}): LiteCoachHit | null {
  const prompt = (params.prompt || '').trim();
  if (!prompt) return null;
  const { track } = params;

  if (track === 'ja') {
    const kanaFirst =
      /假名|五十音|平假名|片假名|ひらがな|カタカナ|罗马字|romaji/i.test(prompt) &&
      !/声调|pitch|発音|发音/i.test(prompt);
    if (kanaFirst) {
      const kana = tryKanaCoachReply(prompt);
      if (kana) return kana;
    }

    const pitch = tryPitchLexiconCoachReply(prompt);
    if (pitch) {
      return { reply: pitch, source: 'pitch-lexicon' };
    }

    if (/声调|pitch|怎么读|発音|发音/.test(prompt)) {
      const tokens = extractPitchQueryTokens(prompt);
      if (tokens.length > 0) {
        const hits = tokens.flatMap((t) => lookupPitchEntries(t));
        if (hits.length === 0) {
          return {
            reply: formatPitchLexiconCoachReply(prompt, []),
            source: 'pitch-lexicon',
          };
        }
      }
    }
  }

  if (track === 'ko') {
    const hangulFirst =
      /谚文|韩语字母|자모|한글|怎么写|读作|罗马字|romanization/i.test(prompt) &&
      !/조사|助词|문법|语法/i.test(prompt);
    if (hangulFirst) {
      const hangul = tryHangulCoachReply(prompt);
      if (hangul) return hangul;
    }
  }

  const particle = tryParticleCoachReply(prompt, track);
  if (particle) return particle;

  if (track === 'ja') {
    const kana = tryKanaCoachReply(prompt);
    if (kana) return kana;
  }

  if (track === 'ko') {
    const hangul = tryHangulCoachReply(prompt);
    if (hangul) return hangul;
  }

  return null;
}

export function tryParticleCoachReply(
  prompt: string,
  track: LiteTrack
): LiteCoachHit | null {
  for (const tip of PARTICLE_TIPS) {
    if (!tip.tracks.includes(track)) continue;
    if (tip.match.test(prompt)) {
      return { reply: tip.reply, source: 'particle-tip' };
    }
  }
  // 泛问「助词」
  if (track === 'ja' && /助词|格助词/.test(prompt) && prompt.length <= 40) {
    return {
      reply:
        '【课程助词速览】常见考点：に（归着/时间）· で（动作场所/手段）· を（宾语）· が/は（主语/主题）。' +
        '可以说「に和で的区别」获取对照说明；要例句或出题请走学习闭环。',
      source: 'particle-tip',
    };
  }
  if (track === 'ko' && /조사|助词/.test(prompt) && prompt.length <= 40) {
    return {
      reply:
        '【조사 안내】자주 헷갈리는 쌍: 에서/에, 은/는/이/가. 「에서와 에 차이」처럼 물어보면 대조 설명을 줄게요.',
      source: 'particle-tip',
    };
  }
  return null;
}

export function tryKanaCoachReply(prompt: string): LiteCoachHit | null {
  const looksKana =
    /假名|五十音|平假名|片假名|ひらがな|カタカナ|怎么写|读作|罗马字|romaji/i.test(
      prompt
    );
  if (!looksKana && !/[ぁ-んァ-ン]/.test(prompt)) return null;

  const tokens = new Set<string>();
  for (const m of prompt.matchAll(/[ぁ-んァ-ンー]{1,4}/g)) tokens.add(m[0]!);
  for (const m of prompt.matchAll(/\b([a-zA-Z]{1,4})\b/g)) {
    tokens.add(m[1]!.toLowerCase());
  }
  // 「あ行」类
  for (const m of prompt.matchAll(/([あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん])行/g)) {
    tokens.add(m[1]!);
  }

  const hits = KANA_SEEDS.filter((k) => {
    for (const t of tokens) {
      if (
        k.hiragana === t ||
        k.katakana === t ||
        k.romaji.toLowerCase() === t ||
        k.row.startsWith(t)
      ) {
        return true;
      }
    }
    return false;
  }).slice(0, 5);

  if (hits.length === 0) {
    if (!looksKana) return null;
    return {
      reply:
        '【五十音课程】未匹配到具体假名。可问「あ怎么写」「ka 的平假名」，或打开「五十音工作室」对照练习。',
      source: 'kana-seed',
    };
  }

  const blocks = hits.map(
    (k, i) =>
      `${i + 1}. ${k.hiragana} / ${k.katakana} · ${k.romaji}（${k.row}${k.col}）` +
      (k.mnemonic ? `\n   字源：${k.mnemonic}` : '')
  );
  return {
    reply:
      `【五十音课程】匹配到 ${hits.length} 条：\n\n` +
      blocks.join('\n\n') +
      '\n\n可在「五十音工作室」继续自测；正式 TTS/听写仍走学习闭环工具。',
    source: 'kana-seed',
  };
}

const HANGUL_TYPE_LABEL: Record<string, string> = {
  CONSONANT: '子音',
  VOWEL: '基本母音',
  YVOWEL: 'y 系母音',
  COMPOUND: '复合母音',
  CODA: '收音代表音',
};

export function tryHangulCoachReply(prompt: string): LiteCoachHit | null {
  const looksHangul =
    /谚文|韩语字母|자모|한글|怎么写|读作|罗马字|romanization/i.test(prompt);
  // 只认字母区间（ㄱ-ㅎㅏ-ㅣ），音节块（가-힣）不触发，避免劫持普通韩语闲聊
  if (!looksHangul && !/[ㄱ-ㅎㅏ-ㅣ]/.test(prompt)) return null;

  const tokens = new Set<string>();
  for (const m of prompt.matchAll(/[ㄱ-ㅎㅏ-ㅣ]{1,4}/g)) tokens.add(m[0]!);
  for (const m of prompt.matchAll(/\b([a-zA-Z]{1,4})\b/g)) {
    tokens.add(m[1]!.toLowerCase());
  }

  const hits = HANGUL_SEEDS.filter((h) => {
    for (const t of tokens) {
      if (
        h.jamo === t ||
        h.name === t ||
        h.romanization.toLowerCase() === t
      ) {
        return true;
      }
    }
    return false;
  }).slice(0, 5);

  if (hits.length === 0) {
    if (!looksHangul) return null;
    return {
      reply:
        '【谚文课程】未匹配到具体字母。可问「ㄱ怎么读」「ya 是哪个母音」，或打开「谚文工作室」对照练习。',
      source: 'hangul-seed',
    };
  }

  const blocks = hits.map(
    (h, i) =>
      `${i + 1}. ${h.jamo}（${h.name}）· ${h.romanization}（${HANGUL_TYPE_LABEL[h.type] ?? h.type}）` +
      (h.mnemonic ? `\n   要点：${h.mnemonic}` : '')
  );
  return {
    reply:
      `【谚文课程】匹配到 ${hits.length} 条：\n\n` +
      blocks.join('\n\n') +
      '\n\n可在「谚文工作室」继续自测；正式 TTS/听写仍走学习闭环工具。',
    source: 'hangul-seed',
  };
}
