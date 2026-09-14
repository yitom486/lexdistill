import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  markdownToAst,
  promoteLessonHeadings,
} from '@study-studio/content';
import { convertPdfToAst } from '../application/pdf-import/pdf-import-service.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-02：无模型标题提升（纯函数 + convert 接线，全 :memory:/fixture，真库零接触）。
 * - 已是 `#` 的行一字不动；课形态独立短行加 `# ` 前缀；
 * - 会話/練習A/問題/目次/前言不提升（除非本身匹配课单元正则）；
 * - lesson.id 生成规则不变（仍是 `${bookId}-l{n}`）。
 */

const JA_MD = `# 第 1 课
李さん：はじめまして。李です。
森：はじめまして。森です。どうぞよろしく。
「ありがとうございます」
## 第 2 课
王：これは本ですか。
李：はい、それは本です。
`;

const B_MD = [
  '第1課',
  'わたしは マイクです。',
  '会話',
  'サントスさん：はじめまして。',
  '第2課',
  'これは 辞書です。',
  '練習A',
  'れんしゅうです。',
].join('\n');

function stubInspector(markdown: string) {
  return async () => ({
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 1, markdown, pagesNeedingOcr: [], confidence: 0.9 }),
    processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [], pagesRecommendingHosted: [] }),
  });
}
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('A. 回归：已是 `#` 的 markdown 提升前后 AST 一致', () => {
  it('JA_MD 提升是字节恒等，lessons[].id/title/dialogues 不变', () => {
    expect(promoteLessonHeadings(JA_MD)).toBe(JA_MD);
    const before = markdownToAst(JA_MD, { title: '标日初上', bookId: 'pdf-test' });
    const after = markdownToAst(promoteLessonHeadings(JA_MD), { title: '标日初上', bookId: 'pdf-test' });
    expect(after.ok && before.ok).toBe(true);
    if (!after.ok || !before.ok) return;
    expect(after.value).toEqual(before.value);
    expect(after.value.lessons.map((l) => [l.id, l.title, l.dialogues.length])).toEqual([
      ['pdf-test-l1', '第 1 课', 3],
      ['pdf-test-l2', '第 2 课', 2],
    ]);
  });

  it('MinerU 样本提升恒等（目次/会話/页码行都不提升）', () => {
    const md = [
      '# 目次',
      '# 第1課',
      '1・わたしは マイク・ミラーです。',
      '# 会話：初めまして',
      'サントスさん：はじめまして。',
      '## 第2課',
      'これは 辞書です。',
    ].join('\n');
    expect(promoteLessonHeadings(md)).toBe(md);
    const res = markdownToAst(promoteLessonHeadings(md), { bookId: 'pdf-mineru-prom' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
  });
});

describe('B. 无 `#` 的 OCR 方言仍切出恰好 2 课', () => {
  it('第1課/第2課提升，会話/練習A 不成课，れんしゅう不自成一课', () => {
    const promoted = promoteLessonHeadings(B_MD);
    expect(promoted).toContain('# 第1課');
    expect(promoted).toContain('# 第2課');
    expect(promoted).not.toMatch(/^# 会話$/m);
    expect(promoted).not.toMatch(/^# 練習A$/m);
    const res = markdownToAst(promoted, { bookId: 'pdf-cmd02-b' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.map((l) => [l.id, l.title])).toEqual([
      ['pdf-cmd02-b-l1', '第1課'],
      ['pdf-cmd02-b-l2', '第2課'],
    ]);
    const second = res.value.lessons[1]?.dialogues.map((d) => d.japanese) ?? [];
    expect(second.some((t) => t.includes('れんしゅう'))).toBe(true);
  });

  it('convert 服务路径同样切出 2 课（与 map 同源合并接线，空 layout 降级）', async () => {
    const res = await convertPdfToAst(
      { loadInspector: stubInspector(B_MD) },
      { userId: 'u1', filename: 'b.pdf', bytes: PDF_HEAD }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.book.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
  });
});

describe('C. 復習A42 粘连（无 `#`）仍成 1 课', () => {
  it('42 不被当页码噪声丢掉', () => {
    const md = ['復習A42', 'ふくしゅうです。'].join('\n');
    expect(promoteLessonHeadings(md)).toContain('# 復習A42');
    const res = markdownToAst(promoteLessonHeadings(md), { bookId: 'pdf-cmd02-c' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.title).toBe('復習A42');
  });
});

describe('D. rich 真机 convert 无 classes 不更碎', () => {
  it('rich-textbook-toc-review.pdf：仍 3 课，标题集合不变', async () => {
    pinProcessToTestRuntime();
    await ensurePdfTestRuntime();
    const bytes = new Uint8Array(
      await Bun.file(new URL('./fixtures/rich-textbook-toc-review.pdf', import.meta.url)).arrayBuffer()
    );
    const res = await convertPdfToAst({}, { userId: 'u1', filename: 'rich.pdf', bytes });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.book.lessons.map((l) => l.title)).toEqual([
      '第1課 はじめまして',
      '第2課 これは本です',
      '復習A',
    ]);
  }, 120000);
});

describe('E. classes 组合：先提升再接地', () => {
  it('无提升时 classes 接地不到（回退旧行为 1 课）；提升后切 2 课，noise 仍不成课', () => {
    const classes = [
      { text: '第1課', page: 1, kind: 'lesson' as const },
      { text: '第2課', page: 2, kind: 'lesson' as const },
      { text: '練習A', page: 3, kind: 'noise' as const },
    ];
    const without = markdownToAst(B_MD, { bookId: 'pdf-cmd02-e', classes });
    expect(without.ok).toBe(true);
    if (!without.ok) return;
    expect(without.value.lessons.length).toBe(1);
    const withPromote = markdownToAst(promoteLessonHeadings(B_MD), { bookId: 'pdf-cmd02-e', classes });
    expect(withPromote.ok).toBe(true);
    if (!withPromote.ok) return;
    expect(withPromote.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
  });

  it('版式候选放行长副标题行；非课形态候选不提升', () => {
    const md = ['第4課 てんき', 'ありがとう。', '練習A', 'れんしゅう。'].join('\n');
    expect(promoteLessonHeadings(md)).toBe(md);
    const backed = promoteLessonHeadings(md, {
      headings: [{ page: 1, level: 0, text: '第4課 てんき', relSize: 2 }],
    });
    expect(backed).toContain('# 第4課 てんき');
    const noiseBacked = promoteLessonHeadings(md, {
      headings: [{ page: 1, level: 0, text: '練習A', relSize: 2 }],
    });
    expect(noiseBacked).toBe(md);
  });
});
