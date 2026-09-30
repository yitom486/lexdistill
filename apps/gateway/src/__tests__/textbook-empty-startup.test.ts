import { expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { documents, textbookLessons, seedMaterialization } from '@study-studio/storage-sqlite';
import { createGateway } from '../bootstrap/create-gateway.js';

it('a fresh database stays free of textbook examples after gateway restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingua-empty-textbooks-'));
  try {
    for (let startup = 0; startup < 2; startup++) {
      const { repo } = await createGateway(join(dir, 'app.db'));
      try {
        const db = drizzle(repo.getRawDb());
        expect(db.select({ total: count() }).from(documents)
          .where(eq(documents.sourceKind, 'curriculum_textbook')).all()[0]?.total).toBe(0);
        expect(db.select({ total: count() }).from(textbookLessons).all()[0]?.total).toBe(0);
        expect(db.select({ total: count() }).from(seedMaterialization).all()[0]?.total).toBe(0);
      } finally {
        repo.getRawDb().close();
      }
    }
  } finally {
    // Windows 文件库需释放已关闭连接的 prepared statements 后才能删除临时目录。
    Bun.gc(true);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
