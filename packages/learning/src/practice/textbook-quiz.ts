import { ok, err, type Result, BusinessError, generateId } from '@lexdistill/shared';
import type { GeneratedQuestion } from '@lexdistill/protocol';
import type { TextbookLesson } from '@lexdistill/document-model';

/**
 * M7-19 自 Gateway `library/application/textbook-lesson-quiz.ts` 迁入
 * （出题规则逐行一致；文档访问判定仍归 Gateway）。
 *
 * 教材本课真出题：只消费本课 AST 已有语料，不调 LLM、不臆造：
 * 1. 课后自带 exercises（金牌，有就先用）；
 * 2. 生词 → 选中释义（干扰项取同课其他生词，<2 个干扰项跳过该词）；
 * 3. 课文对话 → 选中译文（干扰项取同课其他对话）。
 * testedSkillId 归到 vocab/sentence.review（雷达有意义，不走 DEFAULT 兜底）；
 * tier 固定 2（学自己书上的内容=明确意图；档位门只看 tier，未知技能不锁）。
 * 纯逻辑：不读时钟（id 经既有 generateId），不触存储/网络；不依赖 Gateway、
 * learner-core、SQLite、Drizzle、Agent、Web。
 */
export function buildTextbookLessonQuestions(
  lesson: TextbookLesson,
  count: number,
  language: 'ja' | 'en' | 'ko'
): Result<GeneratedQuestion[], BusinessError> {
  const prefix = language === 'ja' ? 'jp' : language;
  const vocabSkill = `${prefix}.vocab.review`;
  const sentenceSkill = `${prefix}.sentence.review`;
  const contextTag = lesson.title;
  const out: GeneratedQuestion[] = [];

  const rotate = <T>(arr: T[], salt: number): T[] => {
    if (arr.length === 0) return arr;
    const k = salt % arr.length;
    return [...arr.slice(k), ...arr.slice(0, k)];
  };

  // 1) 课后自带习题
  for (const ex of lesson.exercises ?? []) {
    if (out.length >= count) break;
    const answer = ex.answer.trim();
    if (!answer) continue;
    if (ex.type === 'CHOICE') {
      const options = (ex.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (options.length < 2 || !options.includes(answer)) continue;
      out.push({
        id: generateId('q_txbook'),
        type: 'MULTIPLE_CHOICE',
        prompt: ex.prompt,
        content: ex.prompt,
        options,
        correctAnswer: answer,
        explanation: ex.explanation ?? `出自${contextTag}`,
        testedSkillId: vocabSkill,
        difficultyTier: 2,
      });
    } else if (ex.type === 'FILL_BLANK') {
      out.push({
        id: generateId('q_txbook'),
        type: 'FILL_IN_BLANK',
        prompt: ex.prompt,
        content: ex.prompt,
        correctAnswer: answer,
        explanation: ex.explanation ?? `出自${contextTag}`,
        testedSkillId: vocabSkill,
        difficultyTier: 2,
      });
    } else {
      out.push({
        id: generateId('q_txbook'),
        type: 'TRANSLATION',
        prompt: '翻译成中文',
        content: ex.prompt,
        correctAnswer: answer,
        explanation: ex.explanation ?? `出自${contextTag}`,
        testedSkillId: sentenceSkill,
        difficultyTier: 2,
      });
    }
  }

  // 2) 生词 → 选中释义
  const vocabs = lesson.vocabularies.filter((v) => v.kanji.trim() && v.chinese.trim());
  vocabs.forEach((v, i) => {
    if (out.length >= count) return;
    const distractors = vocabs
      .filter((o) => o !== v && o.chinese.trim() && o.chinese.trim() !== v.chinese.trim())
      .map((o) => o.chinese.trim())
      .filter((c, idx, arr) => arr.indexOf(c) === idx)
      .slice(0, 3);
    if (distractors.length < 2) return;
    out.push({
      id: generateId('q_txbook'),
      type: 'MULTIPLE_CHOICE',
      prompt: '选出正确的中文意思',
      content: v.kana && v.kana !== v.kanji ? `${v.kanji}（${v.kana}）` : v.kanji,
      options: rotate([v.chinese.trim(), ...distractors], i),
      correctAnswer: v.chinese.trim(),
      explanation: `${contextTag} · ${v.pos}${v.kana ? ` · ${v.kana}` : ''}`,
      testedSkillId: vocabSkill,
      difficultyTier: 2,
    });
  });

  // 3) 课文对话 → 选中译文
  const lines = lesson.dialogues.filter((d) => d.japanese.trim() && d.chinese.trim());
  lines.forEach((d, i) => {
    if (out.length >= count) return;
    const distractors = lines
      .filter((o) => o !== d && o.chinese.trim() !== d.chinese.trim())
      .map((o) => o.chinese.trim())
      .filter((c, idx, arr) => arr.indexOf(c) === idx)
      .slice(0, 3);
    if (distractors.length < 2) return;
    out.push({
      id: generateId('q_txbook'),
      type: 'MULTIPLE_CHOICE',
      prompt: '选出正确的中文翻译',
      content: d.speaker ? `${d.speaker}：${d.japanese.trim()}` : d.japanese.trim(),
      options: rotate([d.chinese.trim(), ...distractors], i),
      correctAnswer: d.chinese.trim(),
      explanation: `出自${contextTag}课文`,
      testedSkillId: sentenceSkill,
      difficultyTier: 2,
    });
  });

  if (out.length === 0) {
    return err(
      new BusinessError(
        'E_CONTENT_EMPTY',
        '本课暂无可用语料出题：先生词表为空且课文不足 3 句，先点「AI 抽生词」或确认课文已导入',
        'TOOL_EXECUTION'
      )
    );
  }
  return ok(out.slice(0, count));
}
