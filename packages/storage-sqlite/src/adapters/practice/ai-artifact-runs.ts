import { createHash } from 'node:crypto';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@lexdistill/shared';
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
  /** P4-2 item2：归属用户，非空（历史未知行以 '' 标记，只写不读）。 */
  userId: string;
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
  userId: string;
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
  const userId = input.userId.trim();
  if (!userId || userId.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
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
      userId,
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
           (id, user_id, action, input_snapshot_hash, adapter, model,
            prompt_version, schema_version, status, error_code,
            created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.userId,
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

export interface ListAiArtifactRunsInput {
  /** 精确匹配；空值拒绝（fail-closed，防全表读）；'' 历史行永不可见。 */
  userId: string;
  action?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: number | undefined;
}

interface AiArtifactRunRow {
  id: string;
  user_id: string;
  action: string;
  input_snapshot_hash: string;
  adapter: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  status: string;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * P4-2 item2 只读查询：按 userId 精确过滤（未知历史行 user_id='' 天然排除）；
 * 无 HTTP／WS／Tool／UI 接线。返回结构天然安全（仅 hash＋版本＋状态）。
 */
export async function listAiArtifactRuns(
  deps: { sqlite: Database },
  input: ListAiArtifactRunsInput
): Promise<Result<AiArtifactRun[], BusinessError>> {
  const userId = input.userId.trim();
  if (!userId) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  const take = Number.isFinite(input.limit)
    ? Math.min(Math.max(Math.floor(input.limit as number), 1), 100)
    : 50;
  try {
    const conds = ['user_id = ?'];
    const args: Array<string | number> = [userId];
    if (input.action) {
      conds.push('action = ?');
      args.push(input.action);
    }
    if (input.since) {
      conds.push('created_at >= ?');
      args.push(input.since);
    }
    if (input.until) {
      conds.push('created_at <= ?');
      args.push(input.until);
    }
    const rows = deps.sqlite
      .query(
        `SELECT id, user_id, action, input_snapshot_hash, adapter, model,
                prompt_version, schema_version, status, error_code,
                created_at, completed_at
         FROM ai_artifact_runs WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(...args, take) as AiArtifactRunRow[];
    return ok(
      rows.map((r) => {
        const run: AiArtifactRun = {
          id: r.id,
          userId: r.user_id,
          action: r.action,
          inputSnapshotHash: r.input_snapshot_hash,
          adapter: r.adapter,
          model: r.model,
          promptVersion: r.prompt_version,
          schemaVersion: r.schema_version,
          status: ARTIFACT_STATUSES.has(r.status) ? (r.status as AiArtifactStatus) : 'failed',
          createdAt: r.created_at,
        };
        if (r.error_code) run.errorCode = r.error_code;
        if (r.completed_at) run.completedAt = r.completed_at;
        return run;
      })
    );
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listAiArtifactRuns' })
    );
  }
}
