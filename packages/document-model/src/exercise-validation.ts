import type { z } from 'zod';

export interface ExerciseShape {
  type: string; options?: string[] | undefined; left?: string[] | undefined; right?: string[] | undefined;
  answer?: string | string[] | { left: string; right: string }[] | undefined;
  gradingNotes?: string | undefined;
}

/** One content rule shared by native tool validation and repository writes. */
export function validateExercise(item: ExerciseShape, context: z.RefinementCtx) {
  const reject = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  const answer = item.answer;
  const strings = typeof answer === 'string' ? [answer] : Array.isArray(answer) && answer.every(value => typeof value === 'string') ? answer : undefined;
  if (['TRANSLATION', 'SHORT_ANSWER', 'WRITING'].includes(item.type)) {
    if (!item.gradingNotes) reject('gradingNotes', '主观题必须说明评分要求');
    if (answer !== undefined && typeof answer !== 'string') reject('answer', '主观题参考表达使用文字，可省略');
    return;
  }
  if (item.type === 'FILL_BLANK') {
    if (!strings?.length) reject('answer', '填空答案使用文字或按空位顺序排列的文字数组');
    return;
  }
  if (item.type === 'MATCHING') {
    const left = item.left ?? [], right = item.right ?? [];
    if (!left.length || !right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) reject('left', '配对两侧须有可区分的文字');
    if (!Array.isArray(answer) || answer.length !== left.length || answer.some(pair => typeof pair !== 'object' || !left.includes(pair.left) || !right.includes(pair.right)) || new Set(answer.map(pair => typeof pair === 'object' ? pair.left : '')).size !== left.length) reject('answer', '每个左项须有对应右项，可复用右项');
    return;
  }
  const options = item.options ?? [];
  if (options.length < 2) reject('options', '至少提供两个选项');
  if (!strings?.length || strings.some(value => !options.includes(value))) { reject('answer', '答案须使用实际选项文字'); return; }
  if (item.type === 'ORDERING') {
    const remaining = [...options];
    for (const word of strings) {
      const index = remaining.indexOf(word);
      if (index < 0) { reject('answer', '排序答案中的词块次数须与选项一致'); return; }
      remaining.splice(index, 1);
    }
    if (remaining.length) reject('answer', '排序答案须使用全部词块');
  } else {
    if (new Set(options).size !== options.length) reject('options', '选择题选项须可区分');
    if (new Set(strings).size !== strings.length || (item.type === 'CHOICE' && strings.length !== 1)) reject('answer', '单选须一个答案，多选答案不得重复');
  }
}
