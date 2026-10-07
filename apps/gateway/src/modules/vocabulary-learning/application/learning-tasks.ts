import { randomUUID } from 'node:crypto';
import type { VocabularyLearningTarget } from '@study-studio/storage-sqlite';

export interface VocabularyLearningTask {
  id: string;
  userId: string;
  target: VocabularyLearningTarget;
  vocabularyId: string;
  createdAt: number;
}

/** 任务有效期 30 分钟；桌面单进程内存保存，重启即失效（提交时提示重调 context）。 */
export const TASK_TTL_MS = 30 * 60 * 1000;
const tasks = new Map<string, VocabularyLearningTask>();

function pruneExpired(now: number): void {
  for (const [id, task] of tasks) {
    if (now - task.createdAt > TASK_TTL_MS) tasks.delete(id);
  }
}

/** 建任务：绑定用户、全局词与目标行（全局词或某课词汇行），返回任务供 submit 校验。 */
export function createLearningTask(userId: string, target: VocabularyLearningTarget, vocabularyId: string): VocabularyLearningTask {
  const now = Date.now();
  pruneExpired(now);
  const task: VocabularyLearningTask = { id: `vl-${randomUUID()}`, userId, target, vocabularyId, createdAt: now };
  tasks.set(task.id, task);
  return task;
}

/** 取任务：不存在或过期返回 null（调用方转业务错误，不抛）。 */
export function getLearningTask(taskId: string): VocabularyLearningTask | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (Date.now() - task.createdAt > TASK_TTL_MS) {
    tasks.delete(taskId);
    return null;
  }
  return task;
}

/** 消费任务：成功提交后调用，同一 taskId 不可二次提交（重试请重调 context）。 */
export function consumeLearningTask(taskId: string): void {
  tasks.delete(taskId);
}

/** 仅测试使用。 */
export function clearLearningTasksForTest(): void {
  tasks.clear();
}
