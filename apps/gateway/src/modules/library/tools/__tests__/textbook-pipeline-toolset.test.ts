import { describe, expect, it } from 'bun:test';
import { createTextbookPipelineTools } from '../textbook-pipeline-toolset.js';
import type { ContentRepository } from '../../ports.js';

describe('TextbookPipelineToolSet 专精教材工具集', () => {
  const dummyRepo = {} as ContentRepository;

  it('统一创建目录与课文提炼专精工具集，避免多环境重复构造', () => {
    const tools = createTextbookPipelineTools(dummyRepo);

    expect(tools.length).toBe(2);
    const names = tools.map((t) => t.name);
    expect(names).toContain('library.submit_toc');
    expect(names).toContain('library.commit_lesson_knowledge');

    const tocTool = tools.find((t) => t.name === 'library.submit_toc');
    expect(tocTool?.location).toBe('SERVER');
    expect(tocTool?.permission).toBe('WRITE');
    expect(tocTool?.description).toContain('目录');

    const commitTool = tools.find((t) => t.name === 'library.commit_lesson_knowledge');
    expect(commitTool?.location).toBe('SERVER');
    expect(commitTool?.permission).toBe('WRITE');
    expect(commitTool?.description).toContain('提炼');
  });
});
