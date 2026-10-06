import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initSchema, runMigrations } from '../ddl.js';

describe('v40 词汇闪卡迁移：存量与空库', () => {
  let sqlite: Database | undefined;
  afterEach(() => { sqlite?.close(); sqlite = undefined; });
  const fsrs = JSON.stringify({ stability: 12, difficulty: 4, reps: 15, lapses: 2, dueAt: '2030-01-01T00:00:00Z', state: 'REVIEW' });
  const insertCard = (id: string, word: string, tags: string[], userId = 'owner', language = 'ja') => sqlite!.query('INSERT INTO flashcards(id,user_id,language,type,front,back,phonetic,tags,fsrs) VALUES (?,?,?,?,?,?,?,?,?)').run(id, userId, language, 'VOCABULARY', word, '旧释义', null, JSON.stringify(tags), fsrs);
  function oldDatabase() {
    sqlite = new Database(':memory:');
    initSchema(sqlite);
    sqlite.run('DROP INDEX idx_flashcards_user_vocabulary');
    for (const column of ['vocabulary_id', 'part_of_speech', 'examples_json']) sqlite.run(`ALTER TABLE flashcards DROP COLUMN ${column}`);
    sqlite.run('DELETE FROM schema_migrations WHERE version=40');
    return sqlite;
  }
  function word(id: string, term: string) {
    sqlite!.query('INSERT INTO global_vocabulary(id,user_id,language,word,reading,meaning,created_at) VALUES (?,\'owner\',\'ja\',?,\'\',\'词义\',\'2026-01-01\')').run(id, term);
  }

  it('空库正常建表，迁移登记一次，数据库唯一约束阻止重复关联卡片', () => {
    sqlite = new Database(':memory:');
    initSchema(sqlite);
    expect(runMigrations(sqlite).applied).toEqual([]);
    expect(sqlite.query<{ n: number }, []>('SELECT count(*) AS n FROM schema_migrations WHERE version=40').get()!.n).toBe(1);
    word('word-book', '本'); insertCard('card-a', '本', []); insertCard('card-b', '本', []);
    sqlite.query('UPDATE flashcards SET vocabulary_id=? WHERE id=?').run('word-book', 'card-a');
    expect(() => sqlite!.query('UPDATE flashcards SET vocabulary_id=? WHERE id=?').run('word-book', 'card-b')).toThrow();
  });

  it('准确关联唯一旧卡，分离词性例句，卡片 ID、FSRS、学习时间与历史保持原样', () => {
    const db = oldDatabase(); word('word-book', '本');
    insertCard('legacy-book', '本', ['教材生词', '名词', 'これは本です。', '这是一本书。']);
    db.query('UPDATE flashcards SET studied_at=? WHERE id=?').run('2025-01-01', 'legacy-book');
    db.query(`INSERT INTO review_schedule_events(id,user_id,card_id,language,algorithm_id,algorithm_version,rating,input_state_json,output_state_json,evaluated_at,created_at) VALUES ('history','owner','legacy-book','ja','fsrs','1','GOOD',?,?,?,?)`).run(fsrs, fsrs, '2025-01-01', '2025-01-01');
    expect(runMigrations(db).applied).toEqual([40]);
    const card = db.query<{ id: string; vocabulary_id: string; part_of_speech: string; examples_json: string; tags: string; fsrs: string; studied_at: string }, []>('SELECT * FROM flashcards').get()!;
    expect(card.id).toBe('legacy-book'); expect(card.vocabulary_id).toBe('word-book');
    expect(card.fsrs).toBe(fsrs); expect(card.studied_at).toBe('2025-01-01');
    expect(card.part_of_speech).toBe('名词'); expect(JSON.parse(card.tags)).toEqual(['教材生词']);
    expect(JSON.parse(card.examples_json)).toEqual([{ text: 'これは本です。', translation: '这是一本书。' }]);
    expect(db.query<{ n: number }, []>('SELECT count(*) AS n FROM review_schedule_events WHERE card_id=\'legacy-book\'').get()!.n).toBe(1);
    expect(runMigrations(db).applied).toEqual([]);
    expect(db.query<{ fsrs: string }, []>('SELECT fsrs FROM flashcards').get()!.fsrs).toBe(fsrs);
  });

  it('重复旧卡、用户修改过词头、不同用户和语种不能猜测关联，不删除任何旧卡', () => {
    const db = oldDatabase(); word('word-book', '本'); word('word-cat', '猫');
    insertCard('duplicate-1', '本', []); insertCard('duplicate-2', '本', []);
    insertCard('edited-cat', '猫（我的笔记）', []); insertCard('other-user', '猫', [], 'other'); insertCard('other-language', '猫', [], 'owner', 'en');
    expect(runMigrations(db).applied).toEqual([40]);
    const cards = db.query<{ vocabulary_id: string | null; fsrs: string }, []>('SELECT vocabulary_id,fsrs FROM flashcards').all();
    expect(cards).toHaveLength(5);
    expect(cards.every(card => card.vocabulary_id === null && card.fsrs === fsrs)).toBe(true);
  });

  it('词典旧卡建立自己的全局词条，保留词典 ID；自定义标签不按位置乱拆', () => {
    const db = oldDatabase();
    db.run(`INSERT INTO local_dictionary_entries(id,language,headword,reading,meanings_json,source_label,license_note,created_at) VALUES ('entry','ja','猫',NULL,'["猫"]','本地词典','test','2026-01-01')`);
    insertCard('dict-cat', '猫', ['词典生词', '名词', '', '', '词典：本地词典']);
    db.run(`UPDATE flashcards SET source_entry_id='entry' WHERE id='dict-cat'`);
    insertCard('custom-tags', '自定义', ['我的分组', '重要', '例句不是这个', '未学习']);
    runMigrations(db);
    const card = db.query<{ vocabulary_id: string; source_entry_id: string }, []>(`SELECT vocabulary_id,source_entry_id FROM flashcards WHERE id='dict-cat'`).get()!;
    expect(card.vocabulary_id).toBeTruthy(); expect(card.source_entry_id).toBe('entry');
    expect(JSON.parse(db.query<{ tags: string }, []>(`SELECT tags FROM flashcards WHERE id='dict-cat'`).get()!.tags)).toEqual(['词典生词', '词典：本地词典']);
    const row = db.query<{ word: string; user_id: string }, [string]>('SELECT word,user_id FROM global_vocabulary WHERE id=?').get(card.vocabulary_id)!;
    expect(row).toEqual({ word: '猫', user_id: 'owner' });
    expect(JSON.parse(db.query<{ tags: string }, []>(`SELECT tags FROM flashcards WHERE id='custom-tags'`).get()!.tags)).toEqual(['我的分组', '重要', '例句不是这个', '未学习']);
  });
});
