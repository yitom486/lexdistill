import type { LessonContent } from './lesson-content.js';
import type { TextbookLesson } from './textbook.js';

/** 既有阅读/词卡接口的投影；不解析 OCR 或 Markdown。 */
export function projectLessonContent(content: LessonContent): Pick<TextbookLesson, 'dialogues' | 'vocabularies' | 'grammarPoints' | 'exercises' | 'passageMd' | 'previewJson' | 'summaryJson'> {
  return {
    dialogues: content.blocks.map(block => ({ speaker: block.speaker ?? '', japanese: block.text, chinese: block.translation ?? '' })),
    vocabularies: content.vocabularies.map(word => ({
      id: word.id, kanji: word.surface, kana: word.reading ?? '', pos: word.pos ?? '', chinese: word.gloss ?? '', pitchAccent: word.pitch ?? '',
      ...(word.examples[0] ? { example: { japanese: word.examples[0].text, chinese: word.examples[0].translation ?? '' } } : {}),
    })),
    grammarPoints: content.knowledgePoints.map(point => ({
      id: point.id, title: point.title, connection: point.connection ?? '', explanation: point.textbookExplanation ?? '',
      examples: point.examples.map(example => ({ japanese: example.text, chinese: example.translation ?? '' })),
    })),
    exercises: content.exercises.map(exercise => ({
      id: exercise.id, type: exercise.type, prompt: exercise.prompt,
      ...(exercise.options ? { options: exercise.options.map(option => option.text) } : {}),
      answer: exercise.answer.text ?? JSON.stringify(exercise.answer),
      ...(exercise.explanation ? { explanation: exercise.explanation } : {}),
    })),
    passageMd: content.blocks.map(block => block.text).join('\n\n') || null,
    previewJson: content.preview ? JSON.stringify(content.preview) : null,
    summaryJson: content.summary ? JSON.stringify(content.summary) : null,
  };
}
