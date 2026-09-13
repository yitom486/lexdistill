import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  detectDocScript,
  extractHeadingsFromMarkdown,
  extractTocEntries,
  groupSectionsByLesson,
  markdownToAst,
  newProvisionalBookId,
  promoteLessonHeadings,
  splitInlineChinese,
} from '../../index.js';

/** M8-3/C5：content 表面与核心规则聚焦测试（canonical 出口；行为与 Gateway 期一致）。 */

describe('extract-headings', () => {
  it('抽取课标题并过滤非课标题', () => {
    expect(extractHeadingsFromMarkdown('# 第1課\n## はじめに\n# 第2課', 3)).toEqual([
      { page: 3, level: 1, text: '第1課' },
      { page: 3, level: 1, text: '第2課' },
    ]);
  });

  it('目录行解析出 lessonNo 与 printedPage', () => {
    const entries = extractTocEntries('第1課 あいさつ …………… 5\n第2課 がっこう …… 12');
    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ lessonNo: '1', printedPage: 5 });
    expect(entries[1]).toMatchObject({ lessonNo: '2', printedPage: 12 });
  });

  it('无目录返回空数组', () => {
    expect(extractTocEntries('ただの本文です\nつづき')).toEqual([]);
  });
});

describe('markdown-to-ast core', () => {
  it('detectDocScript 按字符集判定', () => {
    expect(detectDocScript('こんにちは')).toBe('JA');
    expect(detectDocScript('안녕하세요')).toBe('KO');
    expect(detectDocScript('Hello world')).toBe('EN');
  });

  it('空输入返回 E_CONTENT_EMPTY', () => {
    const res = markdownToAst('   ', { bookId: 'pdf-test' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_CONTENT_EMPTY');
  });

  it('课标题切课并产出对话句', () => {
    const res = markdownToAst('# 第1課\nA：おはよう。\nB：おはよう。', {
      title: 'T',
      bookId: 'pdf-test',
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.dialogues.length).toBe(2);
    expect(res.value.title).toBe('T');
  });

  it('groupSectionsByLesson 同 N 合并', () => {
    const groups = groupSectionsByLesson([
      { title: '第1課', lines: ['a'] },
      { title: '第1課 れんしゅう', lines: ['b'] },
      { title: '第2課', lines: ['c'] },
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0]?.sections.length).toBe(2);
  });

  it('promoteLessonHeadings 提升裸课标题、保留已有标题', () => {
    expect(promoteLessonHeadings('# 第1課\n本文')).toBe('# 第1課\n本文');
    expect(promoteLessonHeadings('第2課\n本文')).toContain('# 第2課');
  });

  it('splitInlineChinese 行末中文括号拆分', () => {
    expect(splitInlineChinese('エアコンをつけます（开空调）')).toEqual({
      ja: 'エアコンをつけます',
      zh: '开空调',
    });
    expect(splitInlineChinese('会社員（かいしゃいん）').zh).toBe('');
  });

  it('newProvisionalBookId 保持 pdf- 前缀与唯一递增', () => {
    const a = newProvisionalBookId();
    const b = newProvisionalBookId();
    expect(a.startsWith('pdf-')).toBe(true);
    expect(a).not.toBe(b);
  });
});
