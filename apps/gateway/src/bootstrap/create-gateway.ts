import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { TEXTBOOK_BOOKS } from '../infrastructure/db/seeds/textbook-seed.js';
import { tryParseTextbookAst } from '../modules/library/persistence/textbook-shred.js';
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
 * 种子教材 shred 回填（P0.5）：seed-bootstrap 只 INSERT documents 行，
 * shred 走导入同一 AST→shred 领域能力（repo.shredDocument），不复制逻辑。
 * 幂等（全删全插）：升级库重跑即回填；单本失败只 warn，不挡网关启动。
 * 注意：只 shred 落库的 ast_json（Dialectal 旧种子会跳过，见 repair dry-run），
 * 绝不回写 ast_json 本身——底稿只增不改，旧种子同步走 repair 流程。
 */
export async function shredSeedTextbooks(repo: DrizzleLearnerRepository): Promise<{
  shredded: number;
  skipped: number;
}> {
  let shredded = 0;
  let skipped = 0;
  for (const book of TEXTBOOK_BOOKS) {
    const got = await repo.getDocumentById(book.id);
    if (!isOk(got) || !got.value?.astJson) {
      skipped++;
      continue;
    }
    const parsed = tryParseTextbookAst(got.value.astJson);
    if (!parsed) {
      skipped++;
      logger.warn('[shred-seed] 种子书落库 AST 非法，跳过 shred（等 repair 同步底稿）', {
        bookId: book.id,
      });
      continue;
    }
    const res = await repo.shredDocument(parsed.id, parsed);
    if (isOk(res)) {
      shredded++;
    } else {
      skipped++;
      logger.warn('[shred-seed] 种子书 shred 失败', {
        bookId: parsed.id,
        code: res.error.code,
      });
    }
  }
  return { shredded, skipped };
}

export type CreatedGateway = ReturnType<typeof createGateway>;
