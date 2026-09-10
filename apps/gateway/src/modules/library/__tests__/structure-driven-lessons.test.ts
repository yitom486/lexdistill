import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { StructureClass } from '@study-studio/protocol';
import {
  markdownToAst,
  groupSectionsByClasses,
  groundClassesByTitle,
} from '../application/pdf-import/markdown-to-ast.js';
import { convertPdfToAst } from '../application/pdf-import/pdf-import-service.js';
import { extractRequestClasses } from '../http/pdf-import-routes.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * CMD-01：用户已确认、已接地的结构分类驱动切课（全临时 :memory: 库，真库零接触）。
 * - kind === 'lesson' 才另起一课；toc/noise/section 不另起；
 * - 未提供 classes 时与旧正则切课逐课/逐句一致；
 * - 非法 classes → 友好 BusinessError，零写。
 */

/** 与 apps/gateway/src/__tests__/pdf-import.test.ts 同源的日語多课样本（回归基线）。 */
const JA_MD = `# 第 1 课
李さん：はじめまして。李です。
森：はじめまして。森です。どうぞよろしく。
「ありがとうございます」
## 第 2 课
王：これは本ですか。
李：はい、それは本です。
`;

const cls = (text: string, kind: StructureClass['kind'], page = 1): StructureClass => ({ text, page, kind });

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function stubInspector(markdown: string) {
  return async () => ({
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 1, markdown, pagesNeedingOcr: [], confidence: 0.9 }),
    processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [], pagesRecommendingHosted: [] }),
  });
}
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('A. 无 classes 回归（与本命令前逐课/逐句一致）', () => {
  it('JA_MD：2 课、id/title/dialogues 条数锁定，显式空 classes 输出一致', () => {
    const base = markdownToAst(JA_MD, { title: '标日初上', bookId: 'pdf-test' });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const snap = base.value.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      dialogues: l.dialogues.length,
      first: l.dialogues[0],
    }));
    expect(snap).toEqual([
      {
        id: 'pdf-test-l1',
        title: '第 1 课',
        dialogues: 3,
        first: { speaker: '李さん', japanese: 'はじめまして。李です。', chinese: '' },
      },
      { id: 'pdf-test-l2', title: '第 2 课', dialogues: 2, first: { speaker: '王', japanese: 'これは本ですか。', chinese: '' } },
    ]);
    const empty = markdownToAst(JA_MD, { title: '标日初上', bookId: 'pdf-test', classes: [] });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.value).toEqual(base.value);
  });

  it('MinerU 样本无 classes：目次/会話不成课，只 2 课', () => {
    const md = [
      '# 目次',
      '# 第1課',
      '1・わたしは マイク・ミラーです。',
      '# 会話：初めまして',
      'サントスさん：はじめまして。',
      '## 第2課',
      'これは 辞書です。',
    ].join('\n');
    const res = markdownToAst(md, { bookId: 'pdf-mineru-reg' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
  });
});

describe('B. 有 classes：lesson 成课保序，noise/toc/section 不成课', () => {
  const md = [
    '# 前言',
    '前言正文第一句。第二句。',
    '# 目次',
    '# 練習A',
    'れんしゅうです。',
    '# 学生',
    '学生です。',
    '# 第1課',
    'わたしは マイクです。',
    '# 第2課',
    'これは 辞書です。',
  ].join('\n');
  const classes = [
    cls('前言', 'noise'),
    cls('目次', 'toc'),
    cls('練習A', 'noise'),
    cls('学生', 'noise'),
    cls('第1課', 'lesson'),
    cls('第2課', 'lesson'),
  ];

  it('noise/toc 不成课；lesson 各成一课且顺序与出现序一致', () => {
    const res = markdownToAst(md, { bookId: 'pdf-cmd01-b', classes });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    expect(res.value.lessons.map((l) => l.id)).toEqual(['pdf-cmd01-b-l1', 'pdf-cmd01-b-l2']);
    expect(res.value.lessons[0]?.dialogues.length).toBe(1);
    expect(res.value.lessons[1]?.dialogues.length).toBe(1);
  });

  it('噪声标题不泄漏进正文（开篇噪声整体丢弃）', () => {
    const res = markdownToAst(md, { bookId: 'pdf-cmd01-b2', classes });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const all = res.value.lessons.flatMap((l) => l.dialogues.map((d) => `${d.speaker}：${d.japanese}`));
    for (const noise of ['前言', '目次', '練習A', '学生', 'れんしゅう']) {
      expect(all.some((t) => t.includes(noise))).toBe(false);
    }
  });

  it('section 不另起一课：正文并入当前课', () => {
    const md2 = ['# 第1課', 'わたしは マイクです。', '# 补充说明', 'これは 辞書です。'].join('\n');
    const res = markdownToAst(md2, {
      bookId: 'pdf-cmd01-sec',
      classes: [cls('第1課', 'lesson'), cls('补充说明', 'section')],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.dialogues.length).toBe(2);
  });
});

describe('C. OCR 方言', () => {
  it('(1) 页眉重复同名标题合并：连续同名一节，非连续同键归并', () => {
    const md = [
      '# 第10課 118',
      'ここは 食堂です。',
      '# 第10課 119',
      'エレベーターは あそこです。',
    ].join('\n');
    const consecutive = markdownToAst(md, {
      bookId: 'pdf-cmd01-c1',
      classes: [cls('第10課 118', 'lesson'), cls('第10課 119', 'lesson')],
    });
    expect(consecutive.ok).toBe(true);
    if (!consecutive.ok) return;
    expect(consecutive.value.lessons.length).toBe(1);
    expect(consecutive.value.lessons[0]?.dialogues.length).toBe(2);

    const md2 = ['# 第1課', 'Aです。', '# 第2課', 'Bです。', '# 第1課', 'Cです。'].join('\n');
    const scattered = markdownToAst(md2, {
      bookId: 'pdf-cmd01-c1b',
      classes: [cls('第1課', 'lesson'), cls('第2課', 'lesson')],
    });
    expect(scattered.ok).toBe(true);
    if (!scattered.ok) return;
    expect(scattered.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    expect(scattered.value.lessons[0]?.dialogues.length).toBe(2);
  });

  it('(2) 復習A42 粘连识别为复习单元而非页码噪声', () => {
    const md = ['# 復習A42', 'ふくしゅうです。'].join('\n');
    const res = markdownToAst(md, {
      bookId: 'pdf-cmd01-c2',
      classes: [{ text: '復習A42', page: 3, kind: 'lesson' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.title).toBe('復習A42');
    expect(res.value.lessons[0]?.dialogues.length).toBe(1);
  });

  it('(3) 未接地 class 被丢弃且不新增课；全未接地回退旧行为', () => {
    const md = ['# 第1課', 'わたしは マイクです。', '# 第2課', 'これは 辞書です。'].join('\n');
    const ghost: StructureClass = { text: '子虚乌有', page: 99, kind: 'lesson' };
    const withGhost = markdownToAst(md, {
      bookId: 'pdf-cmd01-c3',
      classes: [cls('第1課', 'lesson'), cls('第2課', 'lesson'), ghost],
    });
    expect(withGhost.ok).toBe(true);
    if (!withGhost.ok) return;
    expect(withGhost.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    const legacy = markdownToAst(md, { bookId: 'pdf-cmd01-c3' });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const onlyGhost = markdownToAst(md, { bookId: 'pdf-cmd01-c3', classes: [ghost] });
    expect(onlyGhost.ok).toBe(true);
    if (!onlyGhost.ok) return;
    expect(onlyGhost.value).toEqual(legacy.value);
  });

  it('40 字截断标题可 grounding（map 阶段候选上限容忍）', () => {
    const longTitle = `第1課${'あ'.repeat(42)}`;
    expect(longTitle.length).toBeGreaterThan(40);
    const md = [`# ${longTitle}`, 'わたしは マイクです。'].join('\n');
    const res = markdownToAst(md, {
      bookId: 'pdf-cmd01-c5',
      classes: [{ text: longTitle.slice(0, 40), page: 1, kind: 'lesson' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.title).toBe(longTitle);
  });

  it('groundClassesByTitle：同一标题多 class 取首个', () => {
    const sections = [{ title: '第1課', lines: [] as string[] }];
    const m = groundClassesByTitle(sections, [
      { text: '第1課', page: 2, kind: 'noise' },
      { text: '第1課', page: 1, kind: 'lesson' },
    ]);
    expect(m.get('第1課')?.kind).toBe('noise');
    expect(groupSectionsByClasses(sections, m)).toBeNull();
  });
});

describe('D. 导入链路：classes 参与切课且观测可查、行数一致', () => {
  it('convert→canonical→structure 同一批 classes，lessons 行数 == AST', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const md = [
      '# 目次',
      '# 第1課',
      'わたしは マイクです。',
      '# 第2課',
      'これは 辞書です。',
    ].join('\n');
    const classes = [cls('目次', 'toc'), cls('第1課', 'lesson'), cls('第2課', 'lesson')];
    const converted = await convertPdfToAst(
      { loadInspector: stubInspector(md) },
      { userId: 'u1', filename: 't.pdf', bytes: PDF_HEAD, classes }
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.value.book.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    const saved = await repo.saveCanonicalAst(
      {
        id: 'doc-cmd01-d', userId: 'u1', title: converted.value.book.title,
        sourceKind: 'user_import', language: 'ja', content: 'c',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
      converted.value.book
    );
    expect(isOk(saved)).toBe(true);
    if (!isOk(saved)) return;
    const docId = saved.value.id;
    const structure = await repo.saveDocumentStructure('u1', docId, {
      headings: [
        { page: 1, text: '目次' },
        { page: 2, text: '第1課' },
        { page: 3, text: '第2課' },
      ],
      classes: classes.map((c) => ({
        text: String(c.text),
        page: Number(c.page),
        kind: c.kind as 'lesson' | 'section' | 'toc' | 'noise',
        lessonNo: null,
        skillId: null,
      })),
      model: 'm',
      effort: 'e',
      dropped: 0,
    });
    expect(isOk(structure)).toBe(true);
    const back = await repo.getDocumentStructure('u1', docId);
    expect(isOk(back)).toBe(true);
    if (!isOk(back) || !back.value) return;
    expect(back.value.classes.map((c) => `${c.text}:${c.kind}`)).toEqual([
      '目次:toc',
      '第1課:lesson',
      '第2課:lesson',
    ]);
    const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(docId) as { n: number };
    expect(n.n).toBe(converted.value.book.lessons.length);
  });
});

describe('E. 非法 classes → 友好 BusinessError，零写不抛', () => {
  it('非数组 / 非法条目走 convert 即 err（E_INVALID_INPUT）', async () => {
    const md = '# 第1課\nわたしは マイクです。';
    const deps = { loadInspector: stubInspector(md) };
    const base = { userId: 'u1', filename: 't.pdf', bytes: PDF_HEAD };
    const notArray = await convertPdfToAst(deps, { ...base, classes: '第1課' });
    expect(notArray.ok).toBe(false);
    if (notArray.ok) return;
    expect(notArray.error.code).toBe('E_INVALID_INPUT');
    const badItem = await convertPdfToAst(deps, { ...base, classes: [{ kind: 'lesson' }] });
    expect(badItem.ok).toBe(false);
    if (badItem.ok) return;
    expect(badItem.error.code).toBe('E_INVALID_INPUT');
    expect(badItem.error.userMessage.length).toBeGreaterThan(0);
  });

  it('extractRequestClasses：数组透传 / 字符串解析 / 垃圾透传待 convert 拒 / 缺席 undefined', () => {
    const arr = [{ text: '第1課', page: 1, kind: 'lesson' }];
    expect(extractRequestClasses({ classes: arr })).toEqual(arr);
    expect(extractRequestClasses({ classes: JSON.stringify(arr) })).toEqual(arr);
    expect(extractRequestClasses({ classes: 'not-json{{{' })).toBe('not-json{{{');
    expect(extractRequestClasses({})).toBeUndefined();
  });
});
