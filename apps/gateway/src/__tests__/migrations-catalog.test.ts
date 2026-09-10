import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_MIGRATIONS as inline } from '../infrastructure/db/ddl.js';
import { SCHEMA_MIGRATIONS as catalog } from '../infrastructure/db/migrations/index.js';

describe('schema migrations catalog (ddl.ts ↔ migrations/)', () => {
  it('ddl 从 migrations/ 调度，与目录 catalog 为同一份清单', () => {
    expect(inline).toBe(catalog);
    expect(catalog.map((m) => m.version)).toEqual(inline.map((m) => m.version));
    expect(catalog.length).toBeGreaterThanOrEqual(17);
  });

  it('version 从 2 起连续递增，且文件名 vNNN-name.ts 对得上', () => {
    const dir = join(import.meta.dir, '../infrastructure/db/migrations');
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
});
