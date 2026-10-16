import { BusinessError, err, nowIso, ok, type Result } from '@lexdistill/shared';
import type { VocabularyEntry } from '@lexdistill/protocol';
import type { VocabularyLearningTarget } from '@lexdistill/storage-sqlite';
import type { VocabularyLearningContextInput, VocabularyLearningSubmitInput, VocabularyLearningSubmitOutput } from '../contracts.js';
import { createLearningTask, getLearningTask, consumeLearningTask, TASK_TTL_MS } from './learning-tasks.js';

/** 服务依赖的最小仓储面（DrizzleLearnerRepository 结构满足，不引入实现循环）。 */
export interface VocabularyLearningRepo {
  listVocabulary(userId: string, language: string): Promise<Result<VocabularyEntry[], BusinessError>>;
  getVocabularyById(userId: string, language: string, vocabularyId: string): Promise<Result<VocabularyEntry | undefined, BusinessError>>;
  saveVocabularyLearning(
    userId: string,
    input: { target: VocabularyLearningTarget; content: VocabularyLearningSubmitInput['content']; sessionId?: string | undefined },
  ): Promise<Result<{ version: number }, BusinessError>>;
}

export interface VocabularyLearningTaskView {
  taskId: string;
  target: VocabularyLearningTarget;
  requirements: string;
  expiresInSec: number;
}

export interface VocabularyLearningContextOutput {
  word: VocabularyEntry;
  task: VocabularyLearningTaskView;
}

const GLOBAL_REQUIREMENTS = '教该词最常用的义项；可在末尾一句话带过其他常见义项但不展开；可选模块缺省；来源固定标记 AI。';
const TEXTBOOK_REQUIREMENTS = '只教本课取的义项；可在易错提示里一句话带过其他常见义；可选模块缺省；来源固定标记 AI。';

/** 读依据＋建任务绑定：同一词重复调用返回新任务，旧任务保持有效（提交按词覆盖）。 */
export async function getVocabularyLearningContext(
  repo: VocabularyLearningRepo,
  userId: string,
  input: VocabularyLearningContextInput,
): Promise<Result<VocabularyLearningContextOutput, BusinessError>> {
  const found = await repo.getVocabularyById(userId, input.language, input.vocabularyId);
  if (!found.ok) return err(found.error);
  const word = found.value;
  if (!word) return err(new BusinessError('E_NOT_FOUND', '未找到当前用户的词汇', 'VALIDATION'));
  let target: VocabularyLearningTarget = { kind: 'global', vocabularyId: word.id };
  if (input.textbookVocabularyId) {
    const anchored = word.sources.some(source => source.textbookVocabularyId === input.textbookVocabularyId);
    if (!anchored) return err(new BusinessError('E_TASK_TARGET_INVALID', '该教材词汇行不属于当前词，请用本词自己的 context 任务', 'VALIDATION'));
    target = { kind: 'textbook', textbookVocabularyId: input.textbookVocabularyId };
  }
  const task = createLearningTask(userId, target, word.id);
  return ok({
    word,
    task: {
      taskId: task.id,
      target,
      requirements: target.kind === 'global' ? GLOBAL_REQUIREMENTS : TEXTBOOK_REQUIREMENTS,
      expiresInSec: Math.floor(TASK_TTL_MS / 1000),
    },
  });
}

/** 提交保存：无任务/过期/跨用户/跨词一律拒绝；任务一次一用，成功即消费（覆盖靠新任务）。 */
export async function submitVocabularyLearning(
  repo: VocabularyLearningRepo,
  userId: string,
  sessionId: string | undefined,
  input: VocabularyLearningSubmitInput,
): Promise<Result<VocabularyLearningSubmitOutput, BusinessError>> {
  const task = getLearningTask(input.taskId);
  if (!task) {
    return err(new BusinessError('E_TASK_INVALID', '任务不存在、已过期或已使用，请重新调用 vocabulary.learning.context 建立任务', 'VALIDATION', true));
  }
  if (task.userId !== userId) {
    return err(new BusinessError('E_TASK_MISMATCH', '任务不属于当前用户，不能提交', 'VALIDATION'));
  }
  const saved = await repo.saveVocabularyLearning(userId, { target: task.target, content: input.content, sessionId });
  if (!saved.ok) return err(saved.error);
  consumeLearningTask(input.taskId);
  return ok({ version: saved.value.version, updatedAt: nowIso(), vocabularyId: task.vocabularyId });
}
