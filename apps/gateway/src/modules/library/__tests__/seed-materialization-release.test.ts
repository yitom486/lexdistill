import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { initSchema, runMigrations } from '../../../infrastructure/db/ddl.js';
import { seedMaterialization } from '../../../infrastructure/db/schema.js';
import { SCHEMA_MIGRATIONS } from '../../../infrastructure/db/migrations/index.js';
import { migration as v018 } from '../../../infrastructure/db/migrations/v018-seed-materialization-state.js';
import {
  computeSeedMaterializationFingerprint,
  describeSeedStatus,
  SEED_MATERIALIZER_VERSION,
} from '../persistence/seed-materialization.js';
import { formatSeedStatusLine } from '../../../scripts/seed-materialization-status.js';

/**
 * v18 发布闭环 + status 矩阵（全临时 :memory: 库，真库零接触）。
 * - v18 version/name/sql 一经发布不可再改（字面 pin）；
 * - 新库 init 即有 state 表；v17 旧库模拟升级登记且仅一次；重跑幂等；
 * - status 对 clean / version drift / fingerprint drift / projection drift 明确输出。
 */

const EXPECTED_V018_SQL = `
      CREATE TABLE IF NOT EXISTS seed_materialization (
        document_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        materializer_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `;

const repos: DrizzleLearnerRepository[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const d of dbs.splice(0)) d.close();
});

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function lesson(id: string, n: number, vocabs: string[]) {
  return {
    id, lessonNumber: n, title: `t${n}`,
    vocabularies: vocabs.map((kanji, i) => ({ id: `${id}-v${i + 1}`, kanji, kana: 'かな', chinese: '义' })),
    grammarPoints: [],
    dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
    exercises: [],
  };
}

function book(id: string, lessons: Array<ReturnType<typeof lesson>>) {
  return { id, language: 'JA', title: 'B', shortTitle: 'B', lessons };
}

function seedDocBase(id: string) {
  return {
    id, userId: 'default_user', title: 'B', sourceKind: 'curriculum_textbook' as const,
    language: 'ja', content: 'B',
  };
}

describe('v18 发布闭环', () => {
  it('v018 version/name/sql 与发布时一字相同（改即破坏已发布库升级）', () => {
    expect(v018.version).toBe(18);
    expect(v018.name).toBe('seed-materialization-state');
    expect(v018.sql).toBe(EXPECTED_V018_SQL);
    expect(SCHEMA_MIGRATIONS.map((m) => m.version)).toContain(18);
    // v20 已发布：末尾为 v020，版本连续无跳号（下一次迁移需同步更新本行）
    const versions = SCHEMA_MIGRATIONS.map((m) => m.version);
    versions.forEach((v, i) => expect(v).toBe(i + 2));
    const last = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1];
    expect(last?.version).toBe(20);
  });

  it('schema.ts 表定义与迁移 SQL 对齐（列名/主键一致）', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    expect(columnsOf(db, 'seed_materialization')).toEqual([
      'document_id', 'fingerprint', 'materializer_version', 'updated_at',
    ]);
    // drizzle 定义存在且主键为 document_id（类型级不断言运行时，此处锁列集合）
    expect(Object.keys(seedMaterialization)).toEqual(
      expect.arrayContaining(['documentId', 'fingerprint', 'materializerVersion', 'updatedAt'])
    );
  });

  it('新库初始化即具备 seed_materialization（含 v18 登记）', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    expect(columnsOf(db, 'seed_materialization')).toHaveLength(4);
    const row = db.query('SELECT name AS n FROM schema_migrations WHERE version = 18').get() as { n: string } | null;
    expect(row?.n).toBe('seed-materialization-state');
  });

  it('模拟 v17 旧库：应用 v18 后表存在、登记且仅一次；重跑幂等', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    db.run('DROP TABLE seed_materialization');
    db.run('DELETE FROM schema_migrations WHERE version = 18');
    const res = runMigrations(db);
    expect(res.applied).toEqual([18]);
    expect(columnsOf(db, 'seed_materialization')).toHaveLength(4);
    const count = (db.query('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 18').get() as { n: number }).n;
    expect(count).toBe(1);
    expect(runMigrations(db).applied).toEqual([]);
  });
});

describe('status 矩阵（clean / version / fingerprint / projection drift）', () => {
  async function materialized(id: string, lessons: Array<ReturnType<typeof lesson>>, version: number = SEED_MATERIALIZER_VERSION) {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book(id, lessons);
    const fp = computeSeedMaterializationFingerprint(repo.getRawDb(), b as never, version);
    expect(isOk(await repo.materializeSeedDocument(seedDocBase(id), b as never, fp, version))).toBe(true);
    return { repo, b };
  }

  it('clean：新版本 materialize 后 shouldSkip=true', async () => {
    const { repo, b } = await materialized('seed-clean', [lesson('s-l1', 1, ['食べる'])]);
    const s = describeSeedStatus(repo.getRawDb(), 'seed-clean', b as never);
    expect(s).toMatchObject({ documentId: 'seed-clean', stateExists: true, storedVersion: SEED_MATERIALIZER_VERSION, currentVersion: SEED_MATERIALIZER_VERSION, shouldSkip: true });
    expect(s.reason).toMatch(/一致/);
    expect(formatSeedStatusLine(s)).toContain('shouldSkip=true');
  });

  it('version drift：旧版本 state 在新版本下触发重建', async () => {
    const { repo, b } = await materialized('seed-ver', [lesson('s-l1', 1, ['食べる'])], SEED_MATERIALIZER_VERSION - 1);
    const s = describeSeedStatus(repo.getRawDb(), 'seed-ver', b as never);
    expect(s.stateExists).toBe(true);
    expect(s.storedVersion).toBe(SEED_MATERIALIZER_VERSION - 1);
    expect(s.shouldSkip).toBe(false);
    expect(s.reason).toMatch(/版本变化/);
    expect(formatSeedStatusLine(s)).toContain('shouldSkip=false');
  });

  it('fingerprint drift：内容变化触发重建', async () => {
    const { repo, b } = await materialized('seed-fp', [lesson('s-l1', 1, ['食べる'])]);
    const changed = structuredClone(b);
    changed.lessons[0]!.title = 't1·改';
    const s = describeSeedStatus(repo.getRawDb(), 'seed-fp', changed as never);
    expect(s.shouldSkip).toBe(false);
    expect(s.reason).toMatch(/fingerprint/);
  });

  it('projection drift：derived 缺行触发重建', async () => {
    const { repo, b } = await materialized('seed-proj', [lesson('s-l1', 1, ['食べる'])]);
    const db = repo.getRawDb();
    db.run(`DELETE FROM textbook_vocab WHERE document_id = 'seed-proj'`);
    const s = describeSeedStatus(db, 'seed-proj', b as never);
    expect(s.shouldSkip).toBe(false);
    expect(s.reason).toMatch(/projection/);
  });

  it('无 state：首建输出明确（missing / 首建）', () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book('seed-new', [lesson('s-l1', 1, ['食べる'])]);
    const s = describeSeedStatus(repo.getRawDb(), 'seed-new', b as never);
    expect(s).toMatchObject({ stateExists: false, storedVersion: null, shouldSkip: false });
    expect(formatSeedStatusLine(s)).toContain('state=missing');
  });
});
