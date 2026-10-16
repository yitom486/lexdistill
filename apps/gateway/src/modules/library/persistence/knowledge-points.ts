import type { Result, BusinessError } from '@lexdistill/shared';
import {
  saveKnowledgePoints as saveKnowledgePointsStorage,
  listKnowledgePoints as listKnowledgePointsStorage,
  type SaveKnowledgePointInput,
  type KnowledgePoint,
} from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 知识点域（v30 目录挂载蒸馏点；由门面委托，行为不变口径）。
 * 存储层已做输入收窄与幂等 upsert，此处只做依赖转交；
 * 跨域调用一律走 `deps.repo`（接口方法），本域直调存储函数。
 */
export async function saveKnowledgePoints(
  deps: RepoDeps,
  documentId: string,
  lessonId: string,
  points: SaveKnowledgePointInput[]
): Promise<Result<{ saved: number; updated: number }, BusinessError>> {
  return saveKnowledgePointsStorage(deps, { documentId, lessonId, points });
}

export async function listKnowledgePoints(
  deps: RepoDeps,
  documentId: string,
  lessonId?: string
): Promise<Result<KnowledgePoint[], BusinessError>> {
  return listKnowledgePointsStorage(deps, {
    documentId,
    ...(lessonId ? { lessonId } : {}),
  });
}
