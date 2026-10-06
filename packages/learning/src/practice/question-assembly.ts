import type { Flashcard, GeneratedQuestion, PracticeBlockSpec } from '@study-studio/protocol';

/**
 * M7-16 自 Gateway `practice/application/practice-assembly.ts` 迁入
 * （映射与组装规则逐行一致）。
 *
 * 练习题构造纯规则：块题型映射、词义选择题装配、句子翻译选择题装配。
 * 纯逻辑：不读时钟、不触存储/网络；不依赖 Gateway、learner-core、SQLite、
 * Drizzle、Agent、Web。
 */

/** 块规格 → quiz_questions 池可接受的 DB 题型集合。 */
export function acceptedDbTypesForBlock(block: PracticeBlockSpec): string[] {
  const formats =
    block.questionFormats && block.questionFormats.length > 0
      ? block.questionFormats
      : defaultFormatsForKind(block.kind);
  return [...new Set(formats.map(quizTypeToDbType))];
}

function defaultFormatsForKind(kind: PracticeBlockSpec['kind']): GeneratedQuestion['type'][] {
  switch (kind) {
    case 'QUIZ':
      return ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER'];
    case 'CLOZE':
      return ['MULTIPLE_CHOICE', 'FILL_IN_BLANK'];
    case 'VOCAB_REVIEW':
    case 'VOCAB_NEW':
      return ['MULTIPLE_CHOICE', 'FILL_IN_BLANK'];
    case 'TRANSLATION':
    case 'WRITING':
      return ['TRANSLATION'];
    case 'DICTATION':
      return ['LISTENING_DICTATION'];
    case 'READING':
      return ['MULTIPLE_CHOICE', 'FILL_IN_BLANK'];
    default:
      return ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER'];
  }
}

function quizTypeToDbType(t: GeneratedQuestion['type']): string {
  switch (t) {
    case 'MULTIPLE_CHOICE':
      return 'CHOICE';
    case 'FILL_IN_BLANK':
      return 'FILL_BLANK';
    case 'SENTENCE_REORDER':
      return 'REORDER';
    case 'TRANSLATION':
      return 'TRANSLATION';
    case 'LISTENING_DICTATION':
      return 'DICTATION';
    default:
      return 'CHOICE';
  }
}

/** P5-E7：从 FSRS 闪卡装配词义选择题（front→选 back；干扰项取其他卡的 back）。
 * 只吃 VOCABULARY 卡：句子卡（SENTENCE）当词义题出就是错题，绝不混入。 */
export function buildVocabQuestionsFromCards(
  cards: Flashcard[],
  count: number,
  language: 'en' | 'ja' | 'ko'
): GeneratedQuestion[] {
  const usable = cards.filter((c) => c.type === 'VOCABULARY' && c.front && c.back);
  const out: GeneratedQuestion[] = [];
  const skillPrefix = language === 'ja' ? 'jp' : language;
  for (let i = 0; i < Math.min(count, usable.length); i++) {
    const card = usable[i]!;
    const distractors = usable
      .filter((c) => c.id !== card.id && c.back !== card.back)
      .slice(0, 3);
    if (distractors.length < 2) break;
    const opts = [card.back, ...distractors.map((d) => d.back)];
    const rot = i % opts.length;
    const options = [...opts.slice(rot), ...opts.slice(0, rot)];
    out.push({
      id: `vocab_${card.id}`,
      type: 'MULTIPLE_CHOICE',
      prompt: '选出正确的词义 / 用法',
      content: card.front,
      options,
      correctAnswer: card.back,
      explanation: card.tags.filter(Boolean).join(' · ') || '来自你的 FSRS 生词本',
      testedSkillId: `${skillPrefix}.vocab.review`,
      difficultyTier: 3,
    });
  }
  return out;
}

/** 句子翻译选择题（原句→选译文；干扰项取其他句子卡的译文）。
 * 只吃讲透过的 SENTENCE 卡（accept 即讲透）；未讲透的不进，宁缺毋滥。 */
export function buildTranslationQuestionsFromCards(
  cards: Flashcard[],
  count: number,
  language: 'en' | 'ja' | 'ko'
): GeneratedQuestion[] {
  const usable = cards.filter(
    (c) => c.type === 'SENTENCE' && c.studiedAt && c.front && c.back
  );
  const out: GeneratedQuestion[] = [];
  const skillPrefix = language === 'ja' ? 'jp' : language;
  for (let i = 0; i < Math.min(count, usable.length); i++) {
    const card = usable[i]!;
    const distractors = usable
      .filter((c) => c.id !== card.id && c.back !== card.back)
      .slice(0, 3);
    if (distractors.length < 2) break;
    const opts = [card.back, ...distractors.map((d) => d.back)];
    const rot = i % opts.length;
    const options = [...opts.slice(rot), ...opts.slice(0, rot)];
    out.push({
      id: `sentence_${card.id}`,
      type: 'MULTIPLE_CHOICE',
      prompt: '选出正确的翻译',
      content: card.front,
      options,
      correctAnswer: card.back,
      explanation: card.tags.filter(Boolean).join(' · ') || '来自你的课文句子卡',
      testedSkillId: `${skillPrefix}.sentence.review`,
      difficultyTier: 3,
    });
  }
  return out;
}
