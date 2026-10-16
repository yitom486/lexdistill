import fs from 'node:fs';
import path from 'node:path';

/**
 * 网关启动配置（G2）：环境变量与稳定资源路径集中在此。
 * 注意 import.meta.dir 以本文件为准（src/bootstrap/），向上四级到仓库根。
 */
export const isTestEnv = process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const legacyDbFile = path.resolve(repoRoot, 'lexdistill.db');
const newDbFile = path.resolve(repoRoot, 'lexdistill.db');

if (!isTestEnv && !fs.existsSync(newDbFile) && fs.existsSync(legacyDbFile)) {
  try {
    fs.copyFileSync(legacyDbFile, newDbFile);
    if (fs.existsSync(`${legacyDbFile}-wal`)) fs.copyFileSync(`${legacyDbFile}-wal`, `${newDbFile}-wal`);
    if (fs.existsSync(`${legacyDbFile}-shm`)) fs.copyFileSync(`${legacyDbFile}-shm`, `${newDbFile}-shm`);
  } catch {
    // Ignore migration copy errors and fallback to legacy or fresh db
  }
}

const rootDbFile = fs.existsSync(newDbFile) || !fs.existsSync(legacyDbFile) ? newDbFile : legacyDbFile;
const defaultDbPath = isTestEnv ? ':memory:' : rootDbFile;

/** SQLite 文件路径：LEXDISTILL_DB 优先，兼容 STUDY_STUDIO_DB，测试环境默认内存库 */
export const dbPath = process.env.LEXDISTILL_DB || process.env.STUDY_STUDIO_DB || defaultDbPath;

/** 监听端口：GATEWAY_PORT，默认 8080 */
export const PORT = Number(process.env.GATEWAY_PORT || 8080);
