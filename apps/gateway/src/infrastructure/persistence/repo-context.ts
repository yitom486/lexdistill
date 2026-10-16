import type { Database } from 'bun:sqlite';
import type { DrizzleDb } from '@lexdistill/storage-sqlite';
import type { DrizzleLearnerRepository } from '../drizzle-learner-repository.js';

/**
 * 领域函数共享依赖（P0-1 拆分脚手架）。
 * - db / sqlite：drizzle 直连与原生事务；
 * - repo：外观回指。跨域调用一律走 `deps.repo`（接口方法），
 *   领域模块之间绝不互相 import，避免循环依赖。
 */
export interface RepoDeps {
  db: DrizzleDb;
  sqlite: Database;
  repo: DrizzleLearnerRepository;
}
