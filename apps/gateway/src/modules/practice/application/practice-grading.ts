import {
  gradeObjectiveAnswer as gradeObjectiveAnswerCore,
  type ObjectiveQuestionLike,
} from '@lexdistill/learning';

/**
 * M7-15 客观题判题兼容薄包装：实现已迁入练习核心包（经 learning 统一入口转出），
 * 此处只保留原公开签名。
 * `practice-routes` 等调用方无需修改；Gateway 不得直引核心包。
 */
export type { ObjectiveQuestionLike } from '@lexdistill/learning';

export function gradeObjectiveAnswer(
  question: ObjectiveQuestionLike | undefined,
  userAnswer: string,
): { isCorrect: boolean; authoritative: boolean } {
  return gradeObjectiveAnswerCore(question, userAnswer);
}
