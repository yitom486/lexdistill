import { toUiQuizType, type GeneratedQuestion } from '@study-studio/protocol';
import type { QuizQuestionItem } from '../models/learning.js';

export function toQuizQuestionItem(question: GeneratedQuestion): QuizQuestionItem {
  return {
    id: question.id, type: toUiQuizType(question.type), category: question.testedSkillId,
    prompt: question.prompt, content: question.content, correctAnswer: question.correctAnswer,
    explanation: question.explanation, testedSkill: question.testedSkillId,
    ...(question.reading ? { reading: question.reading } : {}),
    ...(question.type === 'SENTENCE_REORDER' ? { chunks: question.content.split(/\s+/).filter(Boolean) } : {}),
    ...(question.options ? { options: question.options.map((text, index) => ({ key: String.fromCharCode(65 + index), text })) } : {}),
  };
}
