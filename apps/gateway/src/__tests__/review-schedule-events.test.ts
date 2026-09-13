import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { initSchema, runMigrations } from '../infrastructure/db/ddl.js';
import { SCHEMA_MIGRATIONS } from '../infrastructure/db/migrations/index.js';
import { reviewScheduleEvents } from '../infrastructure/db/schema.js';

const dbs: Database[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function indexesOf(db: Database, table: string): string[] {
  return (
    db
      .query(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`
      )
      .all(table) as Array<{ name: string }>
  ).map((r) => r.name);
}

const EXPECTED_COLUMNS = [
  'id',
  'user_id',
  'card_id',
  'language',
  'algorithm_id',
  'algorithm_version',
  'rating',
  'input_state_json',
  'output_state_json',
  'evaluated_at',
  'created_at',
];

const EXPECTED_INDEXES = ['idx_review_schedule_card_time', 'idx_review_schedule_user_card_time'];

const ROW = {
  id: 'rse_test_001',
  userId: 'u-test',
  cardId: 'card-test-1',
  language: 'ja',
  algorithmId: 'fsrs',
  algorithmVersion: '1.0.0',
  rating: 'GOOD',
  inputStateJson: JSON.stringify({
    stability: 1,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    dueAt: '2026-01-01T00:00:00.000Z',
    state: 'NEW',
  }),
  outputStateJson: JSON.stringify({
    stability: 2.2,
    difficulty: 4.8,
    reps: 1,
    lapses: 0,
    lastReviewedAt: '2026-01-01T00:00:00.000Z',
    dueAt: '2026-01-03T00:00:00.000Z',
    state: 'REVIEW',
  }),
  evaluatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:01.000Z',
};

describe('v22 review-schedule-events migration', () => {
  it('版本目录末位即 v22（名/号锁定）', () => {
    const last = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1];
    expect(last?.version).toBe(22);
    expect(last?.name).toBe('review-schedule-events');
  });

  it('新库：表/列/索引齐备，drizzle 写入后可按用户/卡片/时间查回', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    // initSchema 末尾已跑完 runMigrations（含 v22），此处只验终态，不重复断言 applied
    expect(runMigrations(db).applied).not.toContain(22);
    expect(columnsOf(db, 'review_schedule_events')).toEqual(EXPECTED_COLUMNS);
    expect(indexesOf(db, 'review_schedule_events')).toEqual(EXPECTED_INDEXES);
    const d = drizzle(db, { schema: { reviewScheduleEvents } });
    d.insert(reviewScheduleEvents).values(ROW).run();
    const byUser = db
      .query(`SELECT id FROM review_schedule_events WHERE user_id = ? ORDER BY created_at`)
      .all('u-test') as Array<{ id: string }>;
    expect(byUser.map((r) => r.id)).toEqual(['rse_test_001']);
    const byCard = db
      .query(`SELECT algorithm_version AS v FROM review_schedule_events WHERE card_id = ?`)
      .all('card-test-1') as Array<{ v: string }>;
    expect(byCard.map((r) => r.v)).toEqual(['1.0.0']);
    // 重跑幂等：不再重复 apply
    expect(runMigrations(db).applied).not.toContain(22);
  });

  it('旧库升级：删表+抹登记后重跑 v22，表/索引恢复可用', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    runMigrations(db);
    // 模拟 v21 时代旧库：新表从不存在，登记抹掉 v22（其余 1..21 保留）
    db.run('DROP TABLE review_schedule_events');
    db.run('DELETE FROM schema_migrations WHERE version = 22');
    expect(columnsOf(db, 'review_schedule_events')).toEqual([]);
    const versions = (
      db.query('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    ).map((r) => r.version);
    expect(versions).toContain(21);
    expect(versions).not.toContain(22);
    const res = runMigrations(db);
    expect(res.applied).toContain(22);
    expect(columnsOf(db, 'review_schedule_events')).toEqual(EXPECTED_COLUMNS);
    expect(indexesOf(db, 'review_schedule_events')).toEqual(EXPECTED_INDEXES);
    const d = drizzle(db, { schema: { reviewScheduleEvents } });
    d.insert(reviewScheduleEvents).values({ ...ROW, id: 'rse_test_002' }).run();
    const count = db.query('SELECT COUNT(*) AS n FROM review_schedule_events').get() as { n: number };
    expect(count.n).toBe(1);
    expect(runMigrations(db).applied).not.toContain(22);
  });

  it('schema.ts 与 ddl.ts 对应（表名/列/索引名一字对齐）', () => {
    const raw = readFileSync(join(import.meta.dir, '../infrastructure/db/schema.ts'), 'utf-8');
    const text = raw.replace(/\r\n/g, '\n');
    expect(text).toContain(`sqliteTable(\n  'review_schedule_events',`);
    for (const col of EXPECTED_COLUMNS) {
      expect(text).toContain(`'${col}'`);
    }
    for (const idx of EXPECTED_INDEXES) {
      expect(text).toContain(`'${idx}'`);
    }
  });
});
