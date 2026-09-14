import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';
import { initSchema } from './ddl.js';
import { seedInitialData } from './seed-bootstrap.js';

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

export interface DrizzleInstance {
  db: DrizzleDb;
  sqlite: Database;
}

/**
 * 初始化 SQLite 结构并挂载 Drizzle ORM 客户端。
 *
 * D2 起家在 storage-sqlite（前身 apps/gateway/src/infrastructure/db/index.ts
 * 的工厂部分，逻辑逐字节不变）。Gateway 保留生命周期拥有：
 * 选库（bootstrap/config.ts）/ 装配（bootstrap/create-gateway.ts）/
 * 启停与信号（bootstrap/start-gateway.ts、index.ts）/ 健康握手（transport/http）。
 */
export function createDrizzleDb(dbOrPath: Database | string = ':memory:'): DrizzleInstance {
  const sqlite = typeof dbOrPath === 'string' ? new Database(dbOrPath, { create: true }) : dbOrPath;

  // 提升 SQLite 性能与数据完整性
  try {
    sqlite.run('PRAGMA journal_mode = WAL;');
    sqlite.run('PRAGMA foreign_keys = ON;');
  } catch {
    // 内存数据库可能不支持 WAL，静默忽略
  }

  initSchema(sqlite);
  seedInitialData(sqlite);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
