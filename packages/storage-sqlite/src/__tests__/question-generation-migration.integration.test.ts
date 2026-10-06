import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, initSchema } from '../ddl.js';
import { SCHEMA_MIGRATIONS } from '../migrations/index.js';
import { migration as v44 } from '../migrations/v044-question-generation-bank.js';

function v43(db: Database) {
  db.run(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE quiz_questions(id TEXT PRIMARY KEY,user_id TEXT,language TEXT,type TEXT,category TEXT,prompt TEXT,content TEXT,options TEXT,chunks TEXT,correct_answer TEXT,explanation TEXT,tested_skill_id TEXT,difficulty INTEGER,extras_json TEXT,created_at TEXT);
    CREATE TABLE quiz_attempts(id TEXT PRIMARY KEY,user_id TEXT,question_id TEXT,is_correct INTEGER);
    CREATE TABLE mistakes(id TEXT PRIMARY KEY,user_id TEXT,question_id TEXT,is_resolved INTEGER);`);
  for (const m of [{ version: 1, name: 'legacy-baseline' }, ...SCHEMA_MIGRATIONS.filter(m => m.version <= 43)]) db.query('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.version, m.name, '2026-01-01T00:00:00.000Z');
  for (const [id, type] of [['choice', 'MULTIPLE_CHOICE'], ['fill', 'FILL_IN_BLANK'], ['order', 'SENTENCE_REORDER'], ['short', 'SHORT_ANSWER'], ['translation', 'TRANSLATION'], ['writing', 'WRITING'], ['unknown', 'UNKNOWN_LEGACY']]) {
    db.query("INSERT INTO quiz_questions VALUES (?,'user','ja',?,'GRAMMAR','Original prompt','Original content','not-valid-json',NULL,'A','Original explanation','ja.grammar',4,NULL,'2026-01-01T00:00:00.000Z')").run(id!, type!);
  }
  db.run("INSERT INTO quiz_attempts VALUES ('attempt','user','choice',0); INSERT INTO mistakes VALUES ('mistake','user','choice',0)");
}
describe('v44/v45 question bank migrations', () => {
  let db: Database;
  let folder: string | undefined;
  afterEach(() => {
    db?.close();
    if (folder) {
      for (const file of ['bank.db', 'bank.db-wal', 'bank.db-shm']) rmSync(join(folder, file), { force: true });
      rmdirSync(folder); folder = undefined;
    }
  });
  it('creates the bank for a fresh database and is safe to initialize repeatedly', () => {
    db = new Database(':memory:'); db.run('PRAGMA foreign_keys=ON'); initSchema(db); initSchema(db);
    expect(db.query('SELECT max(version) AS v FROM schema_migrations').get()).toEqual({ v: 45 });
    expect(db.query("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'bank_%_questions'").get()).toEqual({ n: 6 });
  });
  it('migrates known formats into their own detail tables without guessing levels, preserves history, and survives reopening', () => {
    folder = mkdtempSync(join(tmpdir(), 'lingua-bank-test-'));
    const path = join(folder, 'bank.db'); db = new Database(path); v43(db);
    const original = db.query('SELECT * FROM quiz_questions ORDER BY id').all();
    expect(runMigrations(db).applied).toEqual([44, 45]);
    expect(db.query('SELECT * FROM quiz_questions ORDER BY id').all()).toEqual(original);
    expect(db.query('SELECT * FROM quiz_attempts').all()).toEqual([{ id: 'attempt', user_id: 'user', question_id: 'choice', is_correct: 0 }]);
    expect(db.query('SELECT * FROM mistakes').all()).toEqual([{ id: 'mistake', user_id: 'user', question_id: 'choice', is_resolved: 0 }]);
    for (const format of ['multiple_choice', 'fill_blank', 'reorder', 'short_answer', 'translation', 'writing']) expect(db.query(`SELECT count(*) AS n FROM bank_${format}_questions`).get()).toEqual({ n: 1 });
    expect(db.query('SELECT target_level,difficulty_tier,level_source,status FROM bank_questions WHERE id=?').get('choice')).toEqual({ target_level: null, difficulty_tier: null, level_source: 'LEGACY_UNKNOWN', status: 'LEGACY_PENDING' });
    expect(db.query('SELECT answer_type FROM bank_questions WHERE id=?').get('unknown')).toEqual({ answer_type: 'LEGACY' });
    const legacy = db.query('SELECT answer_json FROM bank_multiple_choice_questions WHERE question_id=?').get('choice') as { answer_json: string };
    expect(JSON.parse(legacy.answer_json).optionsJson).toBe('not-valid-json');
    db.close(); db = new Database(path);
    expect(runMigrations(db).applied).toEqual([]);
    expect(db.query('SELECT count(*) AS n FROM bank_questions').get()).toEqual({ n: 7 });
  });
  it('rolls back schema and version on migration failure, then permits a clean retry', () => {
    db = new Database(':memory:'); v43(db);
    db.run('ALTER TABLE quiz_questions RENAME TO preserved_questions');
    expect(() => runMigrations(db)).toThrow();
    expect(db.query("SELECT count(*) AS n FROM sqlite_master WHERE name='bank_questions'").get()).toEqual({ n: 0 });
    expect(db.query('SELECT max(version) AS v FROM schema_migrations').get()).toEqual({ v: 43 });
    expect(db.query('SELECT count(*) AS n FROM preserved_questions').get()).toEqual({ n: 7 });
    db.run('ALTER TABLE preserved_questions RENAME TO quiz_questions');
    expect(runMigrations(db).applied).toEqual([44, 45]);
    expect(db.query('SELECT count(*) AS n FROM bank_questions').get()).toEqual({ n: 7 });
  });
  it('upgrades an already-applied v44 without replacing its schema or losing task config', () => {
    db = new Database(':memory:'); v43(db);
    db.transaction(() => {
      for (const sql of v44.statements!) db.run(sql);
      db.query('INSERT INTO schema_migrations VALUES (44,?,?)').run(v44.name, new Date().toISOString());
    }).immediate();
    db.run("INSERT INTO generation_tasks VALUES ('task','user','session','turn','{}','ACTIVE','2099-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
    expect(db.query("SELECT count(*) AS n FROM pragma_table_info('generation_tasks') WHERE name='audio_attempts'").get()).toEqual({ n: 0 });
    expect(runMigrations(db).applied).toEqual([45]);
    expect(db.query('SELECT id,config_json,audio_attempts FROM generation_tasks').get()).toEqual({ id: 'task', config_json: '{}', audio_attempts: 0 });
    expect(db.query('SELECT answer_type,status FROM bank_questions WHERE id=?').get('choice')).toEqual({ answer_type: 'MULTIPLE_CHOICE', status: 'LEGACY_PENDING' });
    expect(runMigrations(db).applied).toEqual([]);
  });
  it('rolls back a failing v45 without altering already-applied v44 records or columns', () => {
    db = new Database(':memory:'); v43(db);
    db.transaction(() => {
      for (const sql of v44.statements!) db.run(sql);
      db.query('INSERT INTO schema_migrations VALUES (44,?,?)').run(v44.name, new Date().toISOString());
    }).immediate();
    db.run("CREATE TEMP TRIGGER fail_typed_legacy BEFORE INSERT ON bank_writing_questions BEGIN SELECT RAISE(ABORT,'test legacy conversion failure'); END");
    expect(() => runMigrations(db)).toThrow();
    expect(db.query('SELECT max(version) AS v FROM schema_migrations').get()).toEqual({ v: 44 });
    expect(db.query("SELECT count(*) AS n FROM pragma_table_info('generation_tasks') WHERE name='audio_attempts'").get()).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM bank_questions WHERE answer_type='LEGACY'").get()).toEqual({ n: 7 });
    expect(db.query('SELECT count(*) AS n FROM bank_multiple_choice_questions').get()).toEqual({ n: 0 });
    db.run('DROP TRIGGER fail_typed_legacy');
    expect(runMigrations(db).applied).toEqual([45]);
    expect(db.query('SELECT count(*) AS n FROM bank_writing_questions').get()).toEqual({ n: 1 });
  });
});
