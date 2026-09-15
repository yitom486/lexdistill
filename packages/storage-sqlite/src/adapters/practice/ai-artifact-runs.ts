import { createHash } from 'node:crypto';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import type { Database } from 'bun:sqlite';

/**
 * AI 运行审计（P4-1；v28）。
 * - 只插不改：批改／生成完成（成功或失败）记一行，读口另批；
 * - 输入只存快照 hash（单向），不存原文／作答／模型回复；
 * - 写入失败如实返回 err（调用方不得用 artifact 失败推翻业务结果，
 *   也不得伪造成功行），统一翻译链。
 */

export type AiArtifactStatus = 'completed' | 'failed';

const ARTIFACT_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed']);

export interface RecordAiArtifactInput {
  action: string;
  /** 输入快照原文（内部哈希后丢弃，不入库）。 */
  inputSnapshot: string;
  adapter: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: AiArtifactStatus;
  errorCode?: string | undefined;
}

/** 输入快照 hash（sha256 hex；调用方与单测可用同一函数对账）。 */
export function artifactInputHash(inputSnapshot: string): string {
  return createHash('sha256').update(inputSnapshot, 'utf8').digest('hex');
}

export interface AiArtifactRun {
  id: string;
  action: string;
  inputSnapshotHash: string;
  adapter: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: AiArtifactStatus;
  errorCode?: string | undefined;
  createdAt: string;
  completedAt?: string | undefined;
}

export async function recordAiArtifactRun(
  deps: { sqlite: Database },
  input: RecordAiArtifactInput
): Promise<Result<AiArtifactRun, BusinessError>> {
  const action = input.action.trim().slice(0, 64);
  if (!action) {
    return err(new BusinessError('E_INVALID_INPUT', 'action 非法', 'VALIDATION'));
  }
  if (!ARTIFACT_STATUSES.has(input.status)) {
    return err(new BusinessError('E_INVALID_INPUT', 'status 非法', 'VALIDATION'));
  }
  try {
    const now = nowIso();
    const run: AiArtifactRun = {
      id: generateId('aart'),
      action,
      inputSnapshotHash: artifactInputHash(input.inputSnapshot),
      adapter: input.adapter.trim().slice(0, 64) || 'unknown',
      model: input.model.trim().slice(0, 64) || 'unknown',
      promptVersion: input.promptVersion.trim().slice(0, 64),
      schemaVersion: input.schemaVersion.trim().slice(0, 64),
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      createdAt: now,
      completedAt: now,
    };
    deps.sqlite
      .query(
        `INSERT INTO ai_artifact_runs
           (id, action, input_snapshot_hash, adapter, model,
            prompt_version, schema_version, status, error_code,
            created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.action,
        run.inputSnapshotHash,
        run.adapter,
        run.model,
        run.promptVersion,
        run.schemaVersion,
        run.status,
        input.errorCode ?? null,
        run.createdAt,
        run.completedAt ?? null
      );
    return ok(run);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'recordAiArtifactRun' })
    );
  }
}
