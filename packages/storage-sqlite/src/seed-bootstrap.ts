import type { Database } from 'bun:sqlite';
import { KANA_SEEDS } from './seeds/kana-seed.js';
import { HANGUL_SEEDS } from './seeds/hangul-seed.js';
import { INITIAL_READING_SEEDS } from './seeds/reading-seed.js';
import {
  INITIAL_CARD_SEEDS,
  INITIAL_EN_CARD_SEEDS,
  INITIAL_QUESTION_SEEDS,
  INITIAL_EN_QUESTION_SEEDS,
  INITIAL_KO_QUESTION_SEEDS,
  INITIAL_MISTAKE_SEEDS,
  INITIAL_SKILL_METRIC_SEEDS,
} from './seeds/learning-seed.js';
import { LEARNING_CONTENT_TEMPLATE_SEEDS } from './seeds/content-template-seed.js';
import { PITCH_LEXICON } from './seeds/pitch-seed.js';
import {
  STARTER_LICENSE,
  STARTER_SOURCE_LABEL,
  STARTER_WORD_SEEDS,
} from './seeds/starter-words-seed.js';
import { LESSON_SEEDS } from './seeds/lesson-seed.js';
import {
  N5_LICENSE,
  N5_SOURCE_LABEL,
  N5_WORD_SEEDS,
} from './seeds/n5-words-seed.js';
import { TEXTBOOK_BOOKS } from './seeds/textbook-seed.js';
import { ensureSeedDictionarySources, seedSourceRowId, STARTER_SOURCE_ID, N5_SOURCE_ID } from './seeds/seed-sources.js';

/**
 * 声调词表标签 → 词典释义：标签形如「中文 (English)」时取英文 gloss（与 JMdict/Kengdic
 * 英文释义惯例一致），避免「学生 (Student)」这类头词循环定义入库；无括号时保留原文。
 */
export function pitchMeaningToGlosses(meaning: string): string[] {
  const trimmed = meaning.trim();
  const match = /^(.*)\s*\(([^()]+)\)\s*$/.exec(trimmed);
  if (match) {
    const english = match[2]!.trim();
    if (english) return [english];
  }
  return [trimmed];
}

/**
 * P2-5 拆分：初始种子数据自动填充（若空/增量补种），由 createDrizzleDb 调用。
 */
export function seedInitialData(sqlite: Database): void {
  // 将主档案镜像迁入当前语种行（仅当该语种行尚不存在）
  try {
    sqlite.run(`
      INSERT OR IGNORE INTO learner_language_profiles (
        user_id, language, study_goal, learner_level, overall_level, overall_proficiency,
        streak_days, max_streak_days, last_active_date, retention_rate,
        daily_goal_quizzes, daily_goal_cards, total_study_minutes, total_cards_reviewed,
        total_quizzes_answered, updated_at
      )
      SELECT
        user_id,
        CASE
          WHEN lower(target_language) IN ('en', 'eng') THEN 'en'
          WHEN lower(target_language) IN ('ko', 'kr') THEN 'ko'
          ELSE 'ja'
        END,
        study_goal, learner_level, overall_level, overall_proficiency,
        streak_days, max_streak_days, last_active_date, retention_rate,
        daily_goal_quizzes, daily_goal_cards, total_study_minutes, total_cards_reviewed,
        total_quizzes_answered, updated_at
      FROM learner_profiles
    `);
  } catch (e) {
    console.warn('[initSchema] Failed to backfill learner_language_profiles:', e);
  }

    // 1. 自动填充五十音权威种子数据（若空）
    try {
      const countRow = sqlite
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM curriculum_kana')
        .get();
      if (!countRow || countRow.count === 0) {
        const insertStmt = sqlite.prepare(`
          INSERT INTO curriculum_kana (
            id, type, hiragana, katakana, romaji, row, col, mnemonic,
            learning_guide_json, audio_text, sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const k of KANA_SEEDS) {
          insertStmt.run(
            k.id,
            k.type,
            k.hiragana,
            k.katakana,
            k.romaji,
            k.row,
            k.col,
            k.mnemonic ?? null,
            k.learningGuide ? JSON.stringify(k.learningGuide) : null,
            k.audioText,
            k.sortOrder
          );
        }
      }

      // 已有数据库可能只有旧版 mnemonic；课程资产不是用户编辑内容，按种子补齐讲义并修复旧字形。
      const updateKanaGuideStmt = sqlite.prepare(`
        UPDATE curriculum_kana
        SET katakana = ?, learning_guide_json = ?
        WHERE id = ?
      `);
      for (const k of KANA_SEEDS) {
        updateKanaGuideStmt.run(
          k.katakana,
          k.learningGuide ? JSON.stringify(k.learningGuide) : null,
          k.id
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed curriculum_kana:', e);
    }

    // 1b. 自动填充谚文字母权威种子数据（若空）
    try {
      const hangulCountRow = sqlite
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM curriculum_hangul')
        .get();
      if (!hangulCountRow || hangulCountRow.count === 0) {
        const insertHangulStmt = sqlite.prepare(`
          INSERT INTO curriculum_hangul (id, type, jamo, name, romanization, row, col, mnemonic, audio_text, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const h of HANGUL_SEEDS) {
          insertHangulStmt.run(
            h.id,
            h.type,
            h.jamo,
            h.name,
            h.romanization,
            h.row,
            h.col,
            h.mnemonic ?? null,
            h.audioText,
            h.sortOrder
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed curriculum_hangul:', e);
    }

    // 2. 自动填充双源阅读篇目（若空）
    try {
      const readingCountRow = sqlite
        .query<{ count: number }, []>(
          "SELECT COUNT(*) as count FROM documents WHERE source_kind IN ('ai_generated', 'news')"
        )
        .get();
      if (!readingCountRow || readingCountRow.count === 0) {
        const now = new Date().toISOString();
        const insertDocStmt = sqlite.prepare(`
          INSERT INTO documents (
            id, user_id, title, source_kind, language, content, ast_json, topic, difficulty, source_url, source_publisher, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const set of INITIAL_READING_SEEDS) {
          insertDocStmt.run(
            set.id,
            'default_user',
            set.title,
            set.origin === 'news' ? 'news' : 'ai_generated',
            set.language.toLowerCase(),
            set.body,
            JSON.stringify({ questions: set.questions }),
            set.topic,
            set.difficulty,
            set.sourceUrl ?? null,
            set.sourceLabel,
            now,
            now
          );
        }
      } else {
        // 增量补种：旧库已有 JA/EN 时仍补入缺失的 KO 等新种子（按 id）
        const now = new Date().toISOString();
        const insertIgnore = sqlite.prepare(`
          INSERT OR IGNORE INTO documents (
            id, user_id, title, source_kind, language, content, ast_json, topic, difficulty, source_url, source_publisher, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const set of INITIAL_READING_SEEDS) {
          insertIgnore.run(
            set.id,
            'default_user',
            set.title,
            set.origin === 'news' ? 'news' : 'ai_generated',
            set.language.toLowerCase(),
            set.body,
            JSON.stringify({ questions: set.questions }),
            set.topic,
            set.difficulty,
            set.sourceUrl ?? null,
            set.sourceLabel,
            now,
            now
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed reading passages:', e);
    }

    // 2.5 自动填充内置课程教材（若缺；增量补种，按文档 id 去重）
    try {
      const insertTextbookIgnore = sqlite.prepare(`
        INSERT OR IGNORE INTO documents (
          id, user_id, title, source_kind, language, content, ast_json, topic, difficulty, source_url, source_publisher, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const book of TEXTBOOK_BOOKS) {
        insertTextbookIgnore.run(
          book.id,
          'default_user',
          book.title,
          'curriculum_textbook',
          (book.language || 'JA').toLowerCase(),
          book.title,
          JSON.stringify(book),
          'curriculum',
          1,
          null,
          book.publisher,
          now,
          now
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed curriculum textbooks:', e);
    }

    // 3. 自动填充 FSRS 闪卡初始种子（按语种分仓）
    try {
      const now = new Date().toISOString();
      const insertCardStmt = sqlite.prepare(`
        INSERT INTO flashcards (id, user_id, language, type, front, back, phonetic, audio_url, tags, fsrs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const jaCardCount = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM flashcards WHERE language = 'ja'")
        .get();
      if (!jaCardCount || jaCardCount.count === 0) {
        for (const c of INITIAL_CARD_SEEDS) {
          const fsrsObj = {
            stability: c.stability,
            difficulty: 5.0,
            reps: c.reps,
            lapses: 0,
            dueAt: now,
            state: c.reps > 0 ? 'REVIEW' : 'NEW',
          };
          const tags = [...c.tags];
          if (c.exampleJp) tags.push(c.exampleJp);
          if (c.exampleZh) tags.push(c.exampleZh);

          insertCardStmt.run(
            c.id,
            'student_web_01',
            'ja',
            c.type,
            c.front,
            c.back,
            c.phonetic ?? null,
            c.audioUrl ?? null,
            JSON.stringify(tags),
            JSON.stringify(fsrsObj)
          );
        }
      }

      const enCardCount = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM flashcards WHERE language = 'en'")
        .get();
      if (!enCardCount || enCardCount.count === 0) {
        for (const c of INITIAL_EN_CARD_SEEDS) {
          const fsrsObj = {
            stability: c.stability,
            difficulty: 5.0,
            reps: c.reps,
            lapses: 0,
            dueAt: now,
            state: c.reps > 0 ? 'REVIEW' : 'NEW',
          };
          const tags = [...c.tags];
          if (c.exampleJp) tags.push(c.exampleJp);
          if (c.exampleZh) tags.push(c.exampleZh);

          insertCardStmt.run(
            c.id,
            'student_web_01',
            'en',
            c.type,
            c.front,
            c.back,
            c.phonetic ?? null,
            c.audioUrl ?? null,
            JSON.stringify(tags),
            JSON.stringify(fsrsObj)
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed flashcards:', e);
    }

    // 4. 自动填充初始测评与自适应题库（按语种分仓）
    try {
      const now = new Date().toISOString();
      const insertQStmt = sqlite.prepare(`
        INSERT INTO quiz_questions (id, user_id, language, type, category, prompt, content, options, chunks, correct_answer, explanation, tested_skill_id, difficulty, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const jaQCount = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM quiz_questions WHERE language = 'ja'")
        .get();
      if (!jaQCount || jaQCount.count === 0) {
        for (const q of INITIAL_QUESTION_SEEDS) {
          insertQStmt.run(
            q.id,
            'student_web_01',
            'ja',
            q.type,
            q.category,
            q.prompt,
            q.content,
            q.options ? JSON.stringify(q.options) : null,
            q.chunks ? JSON.stringify(q.chunks) : null,
            q.correctAnswer,
            q.explanation,
            q.testedSkillId,
            q.difficulty,
            now
          );
        }
      }

      const enQCount = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM quiz_questions WHERE language = 'en'")
        .get();
      if (!enQCount || enQCount.count === 0) {
        for (const q of INITIAL_EN_QUESTION_SEEDS) {
          insertQStmt.run(
            q.id,
            'student_web_01',
            'en',
            q.type,
            q.category,
            q.prompt,
            q.content,
            q.options ? JSON.stringify(q.options) : null,
            q.chunks ? JSON.stringify(q.chunks) : null,
            q.correctAnswer,
            q.explanation,
            q.testedSkillId,
            q.difficulty,
            now
          );
        }
      }

      const koQCount = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM quiz_questions WHERE language = 'ko'")
        .get();
      if (!koQCount || koQCount.count === 0) {
        for (const q of INITIAL_KO_QUESTION_SEEDS) {
          insertQStmt.run(
            q.id,
            'student_web_01',
            'ko',
            q.type,
            q.category,
            q.prompt,
            q.content,
            q.options ? JSON.stringify(q.options) : null,
            q.chunks ? JSON.stringify(q.chunks) : null,
            q.correctAnswer,
            q.explanation,
            q.testedSkillId,
            q.difficulty,
            now
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed quiz_questions:', e);
    }

    // 5. 自动填充初始错题记录（若空）
    try {
      const mistCountRow = sqlite
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM mistakes')
        .get();
      if (!mistCountRow || mistCountRow.count === 0) {
        const now = new Date().toISOString();
        const insertMistStmt = sqlite.prepare(`
          INSERT INTO mistakes (id, user_id, language, question_id, question, last_user_submission, last_grading, recorded_at, last_retried_at, retry_count, consecutive_correct, is_resolved)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const m of INITIAL_MISTAKE_SEEDS) {
          const questionObj = {
            id: m.questionId,
            type: 'CHOICE',
            category: m.categoryTag,
            prompt: m.prompt,
            content: m.sentence,
            correctAnswer: m.correctAnswer,
            explanation: m.reviewNote,
            testedSkillId: m.testedSkillId,
          };
          const gradingObj = {
            isCorrect: false,
            score: 0,
            correctAnswer: m.correctAnswer,
            userSubmission: m.userWrongAnswer,
            explanation: m.reviewNote,
          };
          insertMistStmt.run(
            m.id,
            'student_web_01',
            'ja',
            m.questionId,
            JSON.stringify(questionObj),
            m.userWrongAnswer,
            JSON.stringify(gradingObj),
            now,
            null,
            1,
            m.consecutiveCorrect,
            m.isResolved ? 1 : 0
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed mistakes:', e);
    }

    // 6. 自动填充技能画像指标（若空）
    try {
      const smCountRow = sqlite
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM skill_metrics')
        .get();
      if (!smCountRow || smCountRow.count === 0) {
        const now = new Date().toISOString();
        const insertSmStmt = sqlite.prepare(`
          INSERT INTO skill_metrics (user_id, skill_id, language, dimension, name, proficiency, total_attempts, correct_attempts, consecutive_errors, status, last_practiced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const sm of INITIAL_SKILL_METRIC_SEEDS) {
          const lang = sm.skillId.startsWith('en.')
            ? 'en'
            : sm.skillId.startsWith('ko.')
              ? 'ko'
              : 'ja';
          insertSmStmt.run(
            'student_web_01',
            sm.skillId,
            lang,
            sm.dimension,
            sm.name,
            sm.proficiency,
            sm.totalAttempts,
            sm.correctAttempts,
            sm.consecutiveErrors,
            sm.status,
            now
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed skill_metrics:', e);
    }

    // 7. learning.content 内容模板库（工具离线兜底 SSOT）
    // INSERT OR IGNORE：已有库也能补进新语种模板（如 KO），不覆盖用户改写
    try {
      const now = new Date().toISOString();
      const insertTpl = sqlite.prepare(`
        INSERT OR IGNORE INTO learning_content_templates
          (id, language, action, format, skill_id, difficulty, topic, genre, sort_order, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of LEARNING_CONTENT_TEMPLATE_SEEDS) {
        insertTpl.run(
          t.id,
          t.language,
          t.action,
          t.format ?? null,
          t.skillId ?? null,
          t.difficulty,
          t.topic ?? null,
          t.genre ?? null,
          t.sortOrder,
          JSON.stringify(t.payload),
          now
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed learning_content_templates:', e);
    }

    // 8. 课程自有声调基准词进入通用本地词典。这里绝不写入或抓取 OJAD 内容。
    try {
      const countRow = sqlite
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM local_dictionary_entries')
        .get();
      if (!countRow || countRow.count === 0) {
        const now = new Date().toISOString();
        const insertEntry = sqlite.prepare(`
          INSERT INTO local_dictionary_entries (
            id, language, headword, reading, romanization, meanings_json,
            pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        sqlite.prepare(`
          INSERT OR IGNORE INTO dictionary_sources (
            id, language, provider, version, source_url, license_name, license_url, attribution, entry_count, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'study-studio-curriculum-v1',
          'ja',
          'Lingua Studio',
          'v1',
          'https://study-studio.local/curriculum/pitch',
          'Project-authored curriculum data',
          'https://study-studio.local/licenses',
          'Lingua Studio curriculum demonstration data.',
          PITCH_LEXICON.length,
          now
        );
        for (const entry of PITCH_LEXICON) {
          insertEntry.run(
            `ja_pitch_${entry.id}`,
            'ja',
            entry.kanji,
            entry.kana,
            entry.romaji,
            JSON.stringify(pitchMeaningToGlosses(entry.meaning)),
            JSON.stringify({
              kind: 'TOKYO_PITCH_ACCENT',
              pitchType: entry.pitchType,
              pitchPattern: entry.pitchPattern,
              moraList: entry.moraList,
              tip: entry.tip,
              contrastPair: entry.contrastPair ?? null,
            }),
            null,
            'study-studio-curriculum-v1',
            'Lingua Studio curriculum seed',
            'Project-authored curriculum demonstration data; not sourced from OJAD.',
            now
          );
        }
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed local dictionary entries:', e);
    }

    // 8b. 开箱初级词包（日韩英各 24，自撰中文释义）。INSERT OR IGNORE 按 id 补齐，
    // 不依赖表空判断：老库升级也能补进；用户后装词典包与之并存，互不覆盖。
    // 源行经共享契约确保（与 repair 共用 ensureSeedDictionarySources，不各自拼 id）。
    try {
      const now = new Date().toISOString();
      ensureSeedDictionarySources(sqlite, now);
      const insertStarter = sqlite.prepare(`
        INSERT OR IGNORE INTO local_dictionary_entries (
          id, language, headword, reading, romanization, meanings_json,
          pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const w of STARTER_WORD_SEEDS) {
        insertStarter.run(
          w.id,
          w.language,
          w.headword,
          w.reading ?? null,
          null,
          JSON.stringify(w.meanings),
          null,
          w.partOfSpeech ?? null,
          // 源行 id 带语言后缀（…-ja/-ko/-en），词条必须对齐；此前未后缀致悬空（doctor dict:entry-source）。
          seedSourceRowId(STARTER_SOURCE_ID, w.language),
          STARTER_SOURCE_LABEL,
          STARTER_LICENSE,
          now
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed starter words:', e);
    }

    // 8c. 语法讲义（先讲后测）：课程公共资产，按 skillId 补齐；
    // 正文更新时按种子覆盖——讲义是课程资产非用户资产，老库升级也能进。
    try {
      const upsertLesson = sqlite.prepare(`
        INSERT INTO curriculum_lessons (id, language, min_level, title, summary, body_json, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          language = excluded.language,
          min_level = excluded.min_level,
          title = excluded.title,
          summary = excluded.summary,
          body_json = excluded.body_json,
          sort_order = excluded.sort_order
      `);
      for (const l of LESSON_SEEDS) {
        upsertLesson.run(
          l.skillId,
          l.language,
          l.minLevel,
          l.title,
          l.summary,
          JSON.stringify({ sections: l.sections, examples: l.examples, pitfall: l.pitfall }),
          l.sortOrder
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed curriculum lessons:', e);
    }

    // 8d. 日语 N5 核心 100 词（自撰释义，汉字表记+标准读音）。INSERT OR IGNORE 按 id 补齐，
    // 与 starter 包（纯假名）/JMdict 并存，source 独立可开关。源行走共享契约（8b 已确保，此处再保一次防乱序）。
    try {
      const now2 = new Date().toISOString();
      ensureSeedDictionarySources(sqlite, now2);
      const insertN5 = sqlite.prepare(`
        INSERT OR IGNORE INTO local_dictionary_entries (
          id, language, headword, reading, romanization, meanings_json,
          pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const w of N5_WORD_SEEDS) {
        insertN5.run(
          w.id,
          w.language,
          w.headword,
          w.reading ?? null,
          null,
          JSON.stringify(w.meanings),
          null,
          w.partOfSpeech ?? null,
          // N5_SOURCE_ID 本身已带 -ja 后缀，源行 id 是 seedSourceRowId(N5_SOURCE_ID,'ja')，词条必须对齐（此前少一截致悬空）。
          seedSourceRowId(N5_SOURCE_ID, 'ja'),
          N5_SOURCE_LABEL,
          N5_LICENSE,
          now2
        );
      }
    } catch (e) {
      console.warn('[initSchema] Failed to auto-seed N5 words:', e);
    }
}
