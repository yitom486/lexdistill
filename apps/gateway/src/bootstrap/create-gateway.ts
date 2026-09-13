import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { TEXTBOOK_BOOKS } from '../infrastructure/db/seeds/textbook-seed.js';
import { tryParseTextbookAst } from '../modules/library/persistence/textbook-shred.js';
import {
  computeSeedMaterializationFingerprint,
  shouldSkipSeedMaterialization,
  SEED_MATERIALIZER_VERSION,
} from '../modules/library/persistence/seed-materialization.js';
import { parseTextbookAST } from '@study-studio/document-model';
import { isOk, logger } from '@study-studio/shared';
import { dbPath } from './config.js';

/**
 * 网关装配根（G2）：生产只创建一套依赖。
 * 测试可直接调用并传入自有实例（显式注入），不得依赖本模块单例。
 */
export async function createGateway(db: string = dbPath) {
  const repo = new DrizzleLearnerRepository(db);
  const server = new GatewayServer(repo);
  await shredSeedTextbooks(repo);
  return { repo, server };
}

/**
 * 种子教材 materialization gating（P1-D1；旧名 shred 回填，语义升级为门控）：
 * seed canonical input + mapping + materializer 版本均未变且 projection 健康
 * → 跳过 shred（零 DELETE/INSERT/UPDATE，不重建 FTS/term_map）；
 * 否则经 repo.materializeSeedDocument 原子重建（documents upsert + shred + state 同事务）。
 * 单本失败只 warn，不挡网关启动（doctor 会继续报告 projection 问题）。
 * 注意：只认代码 TEXTBOOK_BOOKS 为 input 真相；落库 AST 非法/错位时跳过（等 repair）。
 */
export async function shredSeedTextbooks(repo: DrizzleLearnerRepository): Promise<{
  shredded: number;
  skipped: number;
  skippedClean: number;
}> {
  let shredded = 0;
  let skipped = 0;
  let skippedClean = 0;
  const sqlite = repo.getRawDb();
  for (const rawBook of TEXTBOOK_BOOKS) {
    const bookId = (rawBook as { id?: unknown }).id;
    if (typeof bookId !== 'string' || !bookId) {
      skipped++;
      continue;
    }
    // input 真相 = 代码种子（先校验 canonical 形状，不合法绝不 shred）。
    const checked = parseTextbookAST(JSON.parse(JSON.stringify(rawBook)));
    if (!checked.ok) {
      skipped++;
      logger.warn('[shred-seed] 种子书代码 AST 非法，跳过', { bookId });
      continue;
    }
    const book = checked.value;
    const got = await repo.getDocumentById(bookId);
    if (!isOk(got)) {
      skipped++;
      logger.warn('[shred-seed] 种子书读取失败，跳过', { bookId });
      continue;
    }
    if (got.value?.astJson) {
      // R1-D 保护：落库 AST id 必须等于种子文档 id，防止错位。
      const stored = tryParseTextbookAst(got.value.astJson);
      if (!stored || stored.id !== bookId) {
        skipped++;
        logger.warn('[shred-seed] 种子书落库 AST 非法或 id 不一致，跳过 shred（等 repair）', {
          bookId,
        });
        continue;
      }
    }
    // 门控：fingerprint（含版本）一致 + projection 健康 → 跳过。
    const decision = shouldSkipSeedMaterialization(sqlite, bookId, book, SEED_MATERIALIZER_VERSION);
    if (decision.skip) {
      skippedClean++;
      continue;
    }
    const docBase = got.value
      ? {
          id: bookId,
          userId: got.value.userId,
          title: book.title,
          sourceKind: 'curriculum_textbook' as const,
          language: got.value.language,
          content: book.title,
        }
      : {
          id: bookId,
          userId: 'default_user',
          title: book.title,
          sourceKind: 'curriculum_textbook' as const,
          language: (book.language || 'JA').toLowerCase(),
          content: book.title,
        };
    const fingerprint = computeSeedMaterializationFingerprint(sqlite, book, SEED_MATERIALIZER_VERSION);
    const res = await repo.materializeSeedDocument(docBase, book, fingerprint, SEED_MATERIALIZER_VERSION);
    if (isOk(res)) {
      shredded++;
    } else {
      skipped++;
      logger.warn('[shred-seed] 种子书 materialize 失败（已回滚）', {
        bookId,
        code: res.error.code,
      });
    }
  }
  return { shredded, skipped, skippedClean };
}

export type CreatedGateway = ReturnType<typeof createGateway>;
