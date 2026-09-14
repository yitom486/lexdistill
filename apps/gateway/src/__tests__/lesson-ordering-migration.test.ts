import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations, initSchema } from '@study-studio/storage-sqlite';

const dbs: Database[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

describe('v17 lesson-sort-order migration', () => {
  it('旧库形状升级：加列 + 存量行保留 + sort_order 为 NULL（等 apply 回填）', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    // 模拟 v16 时代旧库：删掉 sort_order 列并抹掉 v17 登记（DROP COLUMN 无约束依赖，安全）
    db.run('ALTER TABLE textbook_lessons DROP COLUMN sort_order');
    db.run('DELETE FROM schema_migrations WHERE version = 17');
    expect(columnsOf(db, 'textbook_lessons')).not.toContain('sort_order');
    db.run(`INSERT INTO textbook_lessons VALUES ('d1','l1',18,'第19課')`);
    const res = runMigrations(db);
    expect(res.applied).toContain(17);
    expect(columnsOf(db, 'textbook_lessons')).toContain('sort_order');
    const row = db.query('SELECT lesson_number AS n, sort_order AS s FROM textbook_lessons').get() as {
      n: number;
      s: number | null;
    };
    expect(row.n).toBe(18);
    // migration 不猜顺序：NULL 留给 lesson-ordering-apply
    expect(row.s).toBeNull();
    // 重跑幂等：不再重复 apply
    expect(runMigrations(db).applied).not.toContain(17);
  });

  it('新库：全量迁移后即有 sort_order 列', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    runMigrations(db);
    expect(columnsOf(db, 'textbook_lessons')).toContain('sort_order');
  });
});
