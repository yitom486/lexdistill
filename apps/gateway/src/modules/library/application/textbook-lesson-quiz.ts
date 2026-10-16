import type { GeneratedQuestion } from '@lexdistill/protocol';
import type { TextbookLesson } from '@lexdistill/document-model';
import { type Result, type BusinessError } from '@lexdistill/shared';
import { buildTextbookLessonQuestions as buildTextbookLessonQuestionsCore } from '@lexdistill/learning';

/** 文档访问判定（自有文档或公共课程资产可出题；别人的私档不行）。 */
export function canQuizDocument(
  doc: { userId: string; sourceKind: string } | null | undefined,
  userId: string
): boolean {
  if (!doc) return false;
  return doc.userId === userId || doc.sourceKind === 'curriculum_textbook';
}

/**
 * M7-19 教材出题兼容委托：实现已迁入练习核心包（经 learning 统一入口转出），
 * 访问判定与调用形状不变；路由/测试 import 路径不动，错误链路不变。
 */
export function buildTextbookLessonQuestions(
  lesson: TextbookLesson,
  count: number,
  language: 'ja' | 'en' | 'ko'
): Result<GeneratedQuestion[], BusinessError> {
  return buildTextbookLessonQuestionsCore(lesson, count, language);
}
