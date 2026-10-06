/**
 * M7-15 自 Gateway `practice/application/practice-grading.ts` 迁入（逐行一致）。
 *
 * 客观题服务端权威判题纯函数：无时钟、无存储、无 Gateway/Agent/Web 依赖。
 */

export interface ObjectiveQuestionLike {
  type?: string | undefined;
  correctAnswer?: string | undefined;
  acceptableVariants?: string[] | undefined;
  options?: unknown[] | undefined;
  language?: string | undefined;
}

export function gradeObjectiveAnswer(
  question: ObjectiveQuestionLike | undefined,
  userAnswer: string,
): { isCorrect: boolean; authoritative: boolean } {
  if (!question || typeof question.correctAnswer !== 'string') {
    return { isCorrect: false, authoritative: false };
  }
  const type = question.type;
  const choice = type === 'MULTIPLE_CHOICE' || type === 'CHOICE';
  const norm = (s: string) => {
    const value = s.normalize('NFKC').trim().replace(/\s+/g, ' ');
    return question.language === 'en' && !choice ? value.toLowerCase() : value;
  };
  const ans = norm(userAnswer ?? '');
  const key = norm(question.correctAnswer);
  if (!key || !ans) return { isCorrect: false, authoritative: Boolean(key) };
  if (choice && question.options?.length) {
    const texts = question.options.map(option => typeof option === 'string' ? option :
      option && typeof option === 'object' && 'text' in option && typeof option.text === 'string' ? option.text : '');
    const answerIndex = question.options.findIndex((option, index) => {
      const optionKey = option && typeof option === 'object' && 'key' in option ? option.key : String.fromCharCode(65 + index);
      return ans === optionKey;
    });
    const selected = answerIndex >= 0 ? texts[answerIndex] : ans;
    const textIndex = texts.findIndex(text => norm(text) === key);
    const keyIndex = textIndex >= 0 ? textIndex : question.options.findIndex((option, index) =>
      key === (option && typeof option === 'object' && 'key' in option ? option.key : String.fromCharCode(65 + index)));
    return { isCorrect: keyIndex >= 0 ? norm(selected ?? '') === norm(texts[keyIndex] ?? '') : ans === key, authoritative: true };
  }
  if (type === 'FILL_IN_BLANK' || type === 'FILL_BLANK' || type === 'LISTENING_DICTATION') {
    const ok =
      ans === key ||
      (Array.isArray(question.acceptableVariants) &&
        question.acceptableVariants.some((v) => norm(v) === ans));
    return { isCorrect: ok, authoritative: true };
  }
  return { isCorrect: ans === key, authoritative: true };
}
