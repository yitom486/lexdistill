import { planTextbookTasks, type TextbookAST } from '@study-studio/document-model';
import type { TextbookBook, FuriganaWord } from '../../models/textbook.js';

export interface GeneratedCardItem {
  front: string;
  back: string;
  category: string;
  prompt: string;
}

/**
 * 将领域模型 TextbookAST 转换为客户端可消费的 TextbookBook 视图结构。
 */
export function convertAstToTextbookBook(ast: TextbookAST): TextbookBook {
  const planned = planTextbookTasks(ast.lessons.map(lesson => ({ ...lesson, level: lesson.kind ?? 'lesson' })));
  if (!planned.ok) throw planned.error;
  const tasks = planned.value;
  const lessons = tasks.map(task => task.root);
  return {
    id: ast.id,
    canonicalAst: ast,
    language: ast.language,
    title: ast.title,
    shortTitle: ast.shortTitle,
    publisher: ast.publisher || '自定义导入',
    totalLessons: ast.lessons.filter(lesson => (lesson.kind ?? 'lesson') === 'lesson').length,
    level: ast.level,
    lessons: lessons.map((l) => ({
      id: l.id,
      kind: l.level === 'section' ? 'section' : 'lesson',
      directory: [...tasks.find(task => task.root.id === l.id)!.ancestors, ...tasks.find(task => task.root.id === l.id)!.entries].map((entry, index) => ({ id: entry.id, title: entry.title, level: entry.level, parentId: entry.parentId, startPage: entry.startPage, endPage: entry.endPage, sortOrder: index + 1 })),
      ...(l.content ? { content: l.content } : {}),
      ...(l.learningContent ? { learningContent: l.learningContent } : {}),
      bookId: ast.id,
      lessonNumber: l.lessonNumber,
      title: l.title,
      subTitle: l.summary || l.title,
      targetLevel: ast.level,
      scene: '课文解析与句型操练',
      associatedQuizTag: `custom.${ast.id}.${l.id}`,
      dialogues: l.dialogues.map((d, idx) => ({
        id: `dlg-${l.id}-${idx}`,
        speaker: d.speaker,
        japanese: d.japanese,
        chinese: d.chinese,
        furiganaTokens: d.words
          ? d.words.map((w) => {
              const item: FuriganaWord = { surface: w.surface };
              if (w.reading) item.reading = w.reading;
              if (w.meaning) item.meaning = w.meaning;
              if (w.pos) item.pos = w.pos;
              return item;
            })
          : [{ surface: d.japanese }],
      })),
      vocabularies: l.vocabularies.map((v) => ({
        id: v.id,
        kanji: v.kanji,
        kana: v.kana,
        romaji: v.romaji || '',
        chinese: v.chinese,
        pos: v.pos,
        pitchAccent: v.pitchAccent,
        pitchType: v.pitchAccent.includes('平板型') || v.pitchAccent.includes('⓪')
          ? '平板型'
          : v.pitchAccent.includes('头高型') || v.pitchAccent.includes('①')
            ? '头高型'
            : v.pitchAccent.includes('中高型') ? '中高型' : v.pitchAccent.includes('尾高型') ? '尾高型' : '',
        exampleSentence: v.example?.japanese || '',
        exampleTranslation: v.example?.chinese || '',
      })),
      grammarPoints: l.grammarPoints.map((g) => ({
        id: g.id,
        title: g.title,
        structure: g.connection,
        explanation: g.explanation,
        examples: g.examples.map((ex) => ({
          ja: ex.japanese,
          zh: ex.chinese,
        })),
      })),
    })),
  };
}

/**
 * 从 TextbookAST 中抽取全部生词，转换为批量生成 FSRS 记忆卡片的格式。
 */
export function extractFsrsCardsFromAst(ast: TextbookAST): GeneratedCardItem[] {
  const cards: GeneratedCardItem[] = [];
  for (const lesson of ast.lessons) {
    for (const vocab of lesson.vocabularies) {
      cards.push({
        front: `${vocab.kanji} (${vocab.kana})`,
        back: `${vocab.chinese} [${vocab.pos} · ${vocab.pitchAccent}]`,
        category: 'VOCAB',
        prompt: `来自《${ast.shortTitle}》${lesson.title}`,
      });
    }
  }
  return cards;
}
