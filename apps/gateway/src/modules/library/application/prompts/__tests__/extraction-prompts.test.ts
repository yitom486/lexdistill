import { describe, expect, it } from 'bun:test';
import {
  buildTocExtractionPrompt,
  buildLessonExtractionPrompt,
} from '../index.js';

describe('教材专精提取提示词模板（Extraction Prompts）', () => {
  it('buildTocExtractionPrompt: 包含严格单调递增页码不变量与规范 JSON 约束', () => {
    const prompt = buildTocExtractionPrompt({
      title: '大家的日本语初级1',
      language: 'ja',
      ocrText: '第1課 はじめまして 12\n第2課 これは本です 24',
    });

    expect(prompt).toContain('大家的日本语初级1');
    expect(prompt).toContain('单调递增页码顺序');
    expect(prompt).toContain('"level": "lesson"');
    expect(prompt).toContain('"startPage": 14');
    expect(prompt).toContain('第1課 はじめまして 12');
  });

  it('buildLessonExtractionPrompt: 包含四大核心要素（课文Markdown/生词/语法例句/习题）', () => {
    const prompt = buildLessonExtractionPrompt({
      documentId: 'doc_minna_01',
      lessonId: 'l1',
      title: '第1课 小野是日本人',
      language: 'ja',
      startPage: 14,
      endPage: 25,
      ocrText: '小野：初めまして、よろしくお願いします。',
    });

    expect(prompt).toContain('doc_minna_01');
    expect(prompt).toContain('l1');
    expect(prompt).toContain('第 14 页 至 第 25 页');
    expect(prompt).toContain('passageMd');
    expect(prompt).toContain('vocabularies');
    expect(prompt).toContain('knowledgePoints');
    expect(prompt).toContain('exercises');
    expect(prompt).toContain('小野：初めまして、よろしくお願いします。');
  });
});
