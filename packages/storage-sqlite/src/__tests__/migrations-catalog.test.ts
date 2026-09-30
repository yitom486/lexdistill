import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_MIGRATIONS as inline } from '../ddl.js';
import { SCHEMA_MIGRATIONS as catalog } from '../migrations/index.js';

/**
 * D2 起家在 storage-sqlite 包内（前身 gateway __tests__/migrations-catalog.test.ts）。
 * 两处 import 必须分别指向 `ddl.ts` 与 `migrations/index.ts` 两个文件——
 * `expect(inline).toBe(catalog)` 验证的是 ddl 的 re-export 接线（同一引用），
 * 禁止改为从包根入口导入（那会变成单模块自证）。
 */
describe('schema migrations catalog (ddl.ts ↔ migrations/)', () => {
  it('ddl 与 migrations/ 调度，与目录 catalog 为同一份清单', () => {
    expect(inline).toBe(catalog);
    expect(catalog.map((m) => m.version)).toEqual(inline.map((m) => m.version));
    expect(catalog.length).toBeGreaterThanOrEqual(17);
  });

  it('version 从 2 起连续递增，且文件名 vNNN-name.ts 对得上', () => {
    const dir = join(import.meta.dir, '../migrations');
    const files = readdirSync(dir).filter((f) => /^v\d{3}-.+\.ts$/.test(f)).sort();
    expect(files).toHaveLength(catalog.length);
    for (let i = 0; i < catalog.length; i++) {
      const m = catalog[i]!;
      expect(m.version).toBe(i + 2);
      const nnn = String(m.version).padStart(3, '0');
      expect(files[i]).toBe(`v${nnn}-${m.name}.ts`);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('遇到重复列时能够安全自愈并补齐缺失列', async () => {
    const { Database } = await import('bun:sqlite');
    const { initSchema, runMigrations } = await import('../ddl.js');
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    // 验证当前已经迁移到最新
    const maxVer = (sqlite.query('SELECT MAX(version) as max_v FROM schema_migrations').get() as { max_v: number }).max_v;
    expect(maxVer).toBe(catalog.at(-1)!.version);

    // 模拟场景：删掉 v31、v32、v33 迁移记录，模拟由于某种原因表已有 start_page，但 migration 尚未记录
    sqlite.run('DELETE FROM schema_migrations WHERE version >= 31');
    
    // 重新跑 runMigrations，验证不会抛 duplicate column name 异常，且自愈后版本补齐
    const res = runMigrations(sqlite);
    expect(res.applied).toContain(31);
    expect(res.applied).toContain(32);
    expect(res.applied).toContain(33);

    // 验证 textbook_lessons 的字段依然完好
    const columns = sqlite.query<{ name: string }, []>('PRAGMA table_info(textbook_lessons)').all();
    const colNames = new Set(columns.map((c) => c.name));
    expect(colNames.has('start_page')).toBe(true);
    expect(colNames.has('end_page')).toBe(true);
    expect(colNames.has('status')).toBe(true);
    expect(colNames.has('passage_md')).toBe(true);
    expect(colNames.has('preview_json')).toBe(true);
    expect(colNames.has('summary_json')).toBe(true);
    sqlite.close();
  });
});

