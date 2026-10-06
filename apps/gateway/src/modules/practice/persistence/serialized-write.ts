import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

const pendingWrites = new WeakMap<RepoDeps['sqlite'], Promise<void>>();

// Async SQLite savepoints must not interleave across independent practice requests.
export async function serializePracticeWrite<T>(sqlite: RepoDeps['sqlite'], write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(sqlite) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pendingWrites.set(sqlite, current);
  await previous;
  try {
    return await write();
  } finally {
    release();
    if (pendingWrites.get(sqlite) === current) pendingWrites.delete(sqlite);
  }
}
