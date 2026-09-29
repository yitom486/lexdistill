import { describe, expect, it } from 'bun:test';
import {
  buildTocExtractionPrompt,
  buildLessonExtractionPrompt,
} from '../index.js';

describe('教材专精提取提示词模板（Extraction Prompts）', () => {
  it('buildTocExtractionPrompt: 点名模型可见工具，保留视觉任务与页码原则，不塞 OCR 或字段清单', () => {
    const prompt = buildTocExtractionPrompt({
      title: '大家的日本语初级1',
      language: 'ja',
      pageNumbers: [16, 17],
    });

    expect(prompt).toContain('大家的日本语初级1');
    expect(prompt).toContain('PDF 物理页：16、17');
    expect(prompt).toContain('印刷页码');
    expect(prompt).toContain('页码不能倒退');
    expect(prompt).toContain('library_propose_toc');
    expect(prompt).toContain('具体字段以工具说明为准');
    expect(prompt).not.toContain('OCR');
    expect(prompt).not.toContain('"level"');
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
