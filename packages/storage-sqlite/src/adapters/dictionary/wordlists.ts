import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import type { Database } from 'bun:sqlite';
import {
  normalizeTrackLanguage,
  type TrackLanguage,
} from '@study-studio/shared';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/dictionary/persistence/wordlists.ts，
 * 逻辑不变）。参数收窄为 `{ sqlite }`（本文件只用原生连接，不用 drizzle/repo 回指）。
 */

export interface WordlistWord {
  entryId: string;
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  sourceLabel: string;
  collected: boolean;
  studied: boolean;
  /** 词库隐含等级（n5_ 前缀 → N5；starter 等入门包无等级，不参与门判定）。 */
  jlpt?: string | undefined;
}

/**
 * 词库组→隐含 JLPT（唯一映射点；调用方不得各自猜）。
 * 约定：组 id 含 `-n{1-5}-` 片段即取该级（如 ja-n5-core → N5）；
 * 无此片段（starter 入门包等）返回 null，表示不限级、恒放行
 * （与“未知技能只走难度闸，不断新内容活路”同哲学）。
 */
export function bankJlptLevel(groupId: string): string | null {
  const matched = /-n([1-5])-/i.exec(groupId);
  return matched ? `N${matched[1]}` : null;
}

export interface WordlistGroup {
  id: string;
  title: string;
  subtitle: string;
  words: WordlistWord[];
}

interface WordRow {
  id: string;
  headword: string;
  reading: string | null;
  meanings_json: string;
  part_of_speech: string | null;
  source_label: string;
}

/**
 * 零基础单词表（内置的一套：学什么、按什么顺序，一目了然）。
 * 内容 = 开箱词包（假名入门 24）+ N5 核心 100（ curated 顺序即学习顺序）；
 * 状态 = 用户生词本实时叠加（已收/已学透），给前端渲染进度。
 * 韩/英轨道暂只有各自 starter 组（N5 百词为日语专属）。
 */
export async function listWordlists(
  deps: { sqlite: Database },
  userId: string,
  language: string
): Promise<Result<WordlistGroup[], BusinessError>> {
  try {
    const track: TrackLanguage = normalizeTrackLanguage(language);
    const prefixes =
      track === 'ja'
        ? ['starter_ja_', 'n5_ja_']
        : track === 'ko'
          ? ['starter_ko_']
          : ['starter_en_'];
    const like = prefixes.map((p) => `id LIKE '${p}%'`).join(' OR ');
    const rows = deps.sqlite
      .query(
        `SELECT id, headword, reading, meanings_json, part_of_speech, source_label
         FROM local_dictionary_entries
         WHERE language = ? AND (${like}) ORDER BY rowid ASC`
      )
      .all(track) as WordRow[];

    const cardRows = deps.sqlite
      .query(
        `SELECT e.id AS entryId, MAX(CASE WHEN f.studied_at IS NOT NULL THEN 1 ELSE 0 END) AS studied
         FROM flashcards f LEFT JOIN global_vocabulary g ON g.id=f.vocabulary_id
           AND g.user_id=f.user_id AND g.language=f.language
         JOIN local_dictionary_entries e ON e.language=f.language AND
           (e.id=f.source_entry_id OR (g.word=e.headword AND g.reading=coalesce(e.reading,e.romanization,'')))
         WHERE f.user_id=? AND f.language=? AND f.type='VOCABULARY'
           AND (${prefixes.map(prefix => `e.id LIKE '${prefix}%'`).join(' OR ')})
         GROUP BY e.id`
      )
      .all(userId, track) as Array<{ entryId: string; studied: number }>;
    const states = new Map(cardRows.map((r) => [r.entryId, r.studied === 1]));

    const toWord = (r: WordRow): WordlistWord => {
      let meanings: string[] = [];
      try {
        const parsed: unknown = JSON.parse(r.meanings_json || '[]');
        if (Array.isArray(parsed)) meanings = parsed.map((m) => String(m));
      } catch {
        meanings = [];
      }
      const studied = states.get(r.id) ?? false;
      return {
        entryId: r.id,
        headword: r.headword,
        ...(r.reading ? { reading: r.reading } : {}),
        meanings,
        ...(r.part_of_speech ? { partOfSpeech: r.part_of_speech } : {}),
        sourceLabel: r.source_label,
        collected: states.has(r.id),
        studied,
      };
    };

    if (track !== 'ja') {
      const title = track === 'ko' ? '韩语入门 24 词' : '英语入门 24 词';
      return ok([
        { id: `${track}-starter`, title, subtitle: '开箱即学：点词展开学透，收进生词本', words: rows.map(toWord) },
      ]);
    }
    const starter = rows.filter((r) => r.id.startsWith('starter_ja_')).map(toWord);
    const n5 = rows.filter((r) => r.id.startsWith('n5_ja_')).map(word => ({ ...toWord(word), jlpt: 'N5' }));
    return ok([
      {
        id: 'ja-kana-starter',
        title: '假名入门 24 词',
        subtitle: '纯假名：五十音学完后来这里认第一批词',
        words: starter,
      },
      {
        id: 'ja-n5-core',
        title: 'N5 核心 100 词',
        subtitle: '汉字表记+标准读音：零基础第一批“能读会认”的词',
        words: n5,
      },
    ]);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listWordlists',
        entityId: userId,
      })
    );
  }
}
