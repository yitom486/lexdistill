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
        `SELECT source_entry_id AS entryId, studied_at AS studiedAt FROM flashcards
         WHERE user_id = ? AND source_entry_id IS NOT NULL`
      )
      .all(userId) as Array<{ entryId: string; studiedAt: string | null }>;
    const states = new Map(cardRows.map((r) => [r.entryId, r.studiedAt !== null]));

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
    const n5 = rows.filter((r) => r.id.startsWith('n5_ja_')).map(toWord);
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
