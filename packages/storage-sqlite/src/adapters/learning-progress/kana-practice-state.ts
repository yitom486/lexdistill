import { and, eq } from 'drizzle-orm';
import type {
  KanaPracticeMemory,
  KanaPracticeScriptType,
  FsrsState,
} from '@lexdistill/learner-core';
import { kanaPracticeStates } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

/**
 * D3 起家在 storage-sqlite（前身 gateway infrastructure/persistence/kana-practice-state.ts，
 * 逻辑不变）。签名已是 `DrizzleDb` 显式参数，零改动；learner-core 仅 type-only
 * 引用（commander 特批计入类型边，见包 README）。
 */

function parseFsrsState(value: unknown): FsrsState['state'] | undefined {
  if (value === 'NEW' || value === 'LEARNING' || value === 'REVIEW' || value === 'RELEARNING') {
    return value;
  }
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** DB TEXT → FSRS：损坏状态只视为未练习，读侧不把坏数据传入调度器。 */
export function parseKanaPracticeMemory(
  fsrsJson: string | null | undefined,
  consecutiveErrors: unknown
): KanaPracticeMemory | undefined {
  if (typeof fsrsJson !== 'string' || fsrsJson.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fsrsJson) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const state = parseFsrsState(parsed.state);
  if (
    !isFiniteNumber(parsed.stability) ||
    !isFiniteNumber(parsed.difficulty) ||
    !isNonNegativeInteger(parsed.reps) ||
    !isNonNegativeInteger(parsed.lapses) ||
    typeof parsed.dueAt !== 'string' ||
    !state
  ) {
    return undefined;
  }

  const lastReviewedAt = parsed.lastReviewedAt;
  const fsrs: FsrsState = {
    stability: parsed.stability,
    difficulty: parsed.difficulty,
    reps: parsed.reps,
    lapses: parsed.lapses,
    dueAt: parsed.dueAt,
    state,
    ...(typeof lastReviewedAt === 'string' ? { lastReviewedAt } : {}),
  };

  return {
    fsrs,
    consecutiveErrors: isNonNegativeInteger(consecutiveErrors) ? consecutiveErrors : 0,
  };
}

export async function readKanaPracticeMemories(
  db: DrizzleDb,
  userId: string,
  scriptType: KanaPracticeScriptType
): Promise<Map<string, KanaPracticeMemory>> {
  const rows = await db
    .select()
    .from(kanaPracticeStates)
    .where(
      and(
        eq(kanaPracticeStates.userId, userId),
        eq(kanaPracticeStates.scriptType, scriptType)
      )
    );

  const memories = new Map<string, KanaPracticeMemory>();
  for (const row of rows) {
    const memory = parseKanaPracticeMemory(row.fsrsJson, row.consecutiveErrors);
    if (memory) memories.set(row.kanaId, memory);
  }
  return memories;
}

export async function saveKanaPracticeMemory(
  db: DrizzleDb,
  userId: string,
  kanaId: string,
  scriptType: KanaPracticeScriptType,
  memory: KanaPracticeMemory,
  updatedAt: string
): Promise<void> {
  const existing = await db
    .select({ kanaId: kanaPracticeStates.kanaId })
    .from(kanaPracticeStates)
    .where(
      and(
        eq(kanaPracticeStates.userId, userId),
        eq(kanaPracticeStates.kanaId, kanaId),
        eq(kanaPracticeStates.scriptType, scriptType)
      )
    )
    .limit(1);

  const values = {
    userId,
    kanaId,
    scriptType,
    fsrsJson: JSON.stringify(memory.fsrs),
    consecutiveErrors: memory.consecutiveErrors,
    updatedAt,
  };

  if (existing.length > 0) {
    await db
      .update(kanaPracticeStates)
      .set({
        fsrsJson: values.fsrsJson,
        consecutiveErrors: values.consecutiveErrors,
        updatedAt: values.updatedAt,
      })
      .where(
        and(
          eq(kanaPracticeStates.userId, userId),
          eq(kanaPracticeStates.kanaId, kanaId),
          eq(kanaPracticeStates.scriptType, scriptType)
        )
      );
    return;
  }

  await db.insert(kanaPracticeStates).values(values);
}
