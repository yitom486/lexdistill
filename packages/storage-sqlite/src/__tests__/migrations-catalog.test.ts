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

  it('当前教材迁移已删除旧表，重复启动不会再创建', async () => {
    const { Database }=await import('bun:sqlite');const {initSchema}=await import('../ddl.js');const sqlite=new Database(':memory:');
    try { initSchema(sqlite);initSchema(sqlite);
      expect(sqlite.query("SELECT name FROM sqlite_master WHERE name IN ('textbook_lessons','textbook_lines','textbook_vocab','textbook_grammar','textbook_exercises')").all()).toEqual([]);
      expect(sqlite.query('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({version:catalog.at(-1)!.version});
    } finally {sqlite.close();}
  });
});
