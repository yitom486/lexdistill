import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { detectDocScript, markdownToAst } from '@lexdistill/content';
import {
  extractHeadingsFromMarkdown,
  extractTocEntries,
} from '@lexdistill/content';
import {
  appendPdfToDocument,
  convertPdfToAst,
  importPdfDocument,
  mapPdfPages,
} from '../modules/library/application/pdf-import/pdf-import-service.js';
import { readLocalPdfFile } from '../modules/library/application/pdf-import/local-file.js';
import type { DocumentItem } from '@lexdistill/protocol';
import { extractTarGz, extractZip } from '@lexdistill/archive';
import { assertArtifactUrlAllowed, currentRuntimePlatform } from '../infrastructure/pdf-runtime/pdf-artifacts.js';
import { napiDirName } from '../infrastructure/pdf-runtime/pdf-runtime.js';
import { fetchRuntimeArtifact } from '../infrastructure/pdf-runtime/pdf-runtime-provision.js';
import { isOk } from '@lexdistill/shared';

const JA_MD = `# 第 1 课
李さん：はじめまして。李です。
森：はじめまして。森です。どうぞよろしく。
「ありがとうございます」
## 第 2 课
王：これは本ですか。
李：はい、それは本です。
`;

describe('markdownToAst', () => {
  test('标题切课、说话人前缀成句、引号成句', () => {
    const res = markdownToAst(JA_MD, { title: '标日初上', bookId: 'pdf-test' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.language).toBe('JA');
    expect(res.value.lessons.length).toBe(2);
    expect(res.value.lessons[0]?.dialogues.length).toBe(3);
    expect(res.value.lessons[0]?.dialogues[0]).toMatchObject({
      speaker: '李さん',
      japanese: 'はじめまして。李です。',
    });
    expect(res.value.lessons[0]?.dialogues[2]?.speaker).toBe('课文');
    // 生词/语法不臆造
    expect(res.value.lessons[0]?.vocabularies).toEqual([]);
    expect(res.value.lessons[0]?.grammarPoints).toEqual([]);
  });

  test('提取器并行不丢说话人：行内多说话人切分', () => {
    const merged =
      '李さん：はじめまして。李です。 森：はじめまして。森です。どうぞよろしく。 「ありがとう」';
    const res = markdownToAst(merged, { bookId: 'pdf-merged' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const dialogues = res.value.lessons[0]?.dialogues ?? [];
    expect(dialogues.length).toBe(3);
    expect(dialogues[0]).toMatchObject({ speaker: '李さん' });
    expect(dialogues[1]).toMatchObject({ speaker: '森' });
    expect(dialogues[2]).toMatchObject({ speaker: '课文', japanese: 'ありがとう' });
  });

  test('无标题整篇一课', () => {
    const res = markdownToAst('おはようございます。\nこんにちは。', { bookId: 'pdf-one' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.dialogues.length).toBe(2);
  });

  test('韩语/英语语种判定', () => {
    const ko = markdownToAst('친구와 카페에서 한국어를 공부합니다.', { bookId: 'k' });
    expect(ko.ok && ko.value.language).toBe('KO');
    const en = markdownToAst('The professor suggested that each student write.', { bookId: 'e' });
    expect(en.ok && en.value.language).toBe('EN');
  });

  test('空输入与纯目录返回 E_CONTENT_EMPTY（不编造）', () => {
    expect(markdownToAst('', {}).ok).toBe(false);
    expect(markdownToAst('目录\n1 ...... 5\n2 ...... 9', {}).ok).toBe(false);
  });

  test('封面元数据/tofu 乱码行被丢弃（整页无实质课文则报错）', () => {
    const tofu = String.fromCharCode(0xfffd);
    const junk = `[General Information] ${tofu}${tofu} ${tofu}${tofu}${tofu}${tofu}`;
    const res = markdownToAst(`${junk}\n18`, { bookId: 'pdf-junk' });
    expect(res.ok).toBe(false);
    // 混在正常课文里的单行乱码只丢该行，不影响整课
    const mixed = markdownToAst(`李さん：はじめまして。\n${junk}`, { bookId: 'pdf-mixed' });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.value.lessons[0]?.dialogues.length).toBe(1);
  });

  test('detectDocScript 混写行不误判中文为主', () => {
    expect(detectDocScript('注意助词で表示场所')).toBe('JA');
    expect(detectDocScript('纯中文讲解无假名')).toBe('JA'); // 无信号回退默认
  });

  test('MinerU 方言：非课标题不成课，行末中文括号拆译文', () => {
    const md = [
      '# 目次',
      '# 第1課',
      '1・わたしは マイク・ミラーです。',
      '2： それは わたしの 傘です。',
      '# 会話：初めまして',
      'サントスさん：はじめまして。',
      'エアコンをつけます（开空调）',
      '会社員（かいしゃいん）です。',
      '## 第2課',
      'これは 辞書です（这是词典）。',
    ].join('\n');
    const res = markdownToAst(md, { bookId: 'pdf-mineru' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 目次/会話不成课：只切出 2 课
    expect(res.value.lessons.length).toBe(2);
    expect(res.value.lessons[0]?.title).toBe('第1課');
    const d0 = res.value.lessons[0]?.dialogues ?? [];
    // 习题编号剥离、无说话人数字
    expect(d0.some((d) => d.speaker === '2')).toBe(false);
    expect(d0.some((d) => d.japanese.startsWith('わたしは マイク'))).toBe(true);
    // 行末中文括号拆译文；注音括号不动
    const aircon = d0.find((d) => d.japanese.includes('エアコン'));
    expect(aircon).toMatchObject({ japanese: 'エアコンをつけます', chinese: '开空调' });
    const emp = d0.find((d) => d.japanese.includes('会社員'));
    expect(emp?.chinese).toBe('');
    // 第二课译文（句末句号在括号外也拆）
    const d1 = res.value.lessons[1]?.dialogues ?? [];
    expect(d1.some((d) => d.japanese === 'これは 辞書です' && d.chinese === '这是词典')).toBe(true);
  });

  test('扫描版页眉重复标题合并（页码不同也算同名）', () => {
    const md = [
      '# 第10課 118',
      'ここは 食堂です。',
      '# 第10課 119',
      'エレベーターは あそこです。',
      '# 第11課',
      '今何時ですか。',
    ].join('\n');
    const res = markdownToAst(md, { bookId: 'pdf-runhead' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(2);
    expect(res.value.lessons[0]?.dialogues.length).toBe(2);
    expect(res.value.lessons[1]?.title).toBe('第11課');
  });

  test('同课本文+題按N归并，復習自成单元，开篇杂页丢弃', () => {
    const md = [
      'ISBN 978-4-88319-000-0',
      'CIP data page',
      '# 第1課',
      'わたしは マイクです。',
      '# だい 円第1課',
      'れんしゅう1です。',
      '# ふくしゆう 復習A',
      'ふくしゅうです。',
      '# 第2課',
      'これは 辞書です。',
    ].join('\n');
    const res = markdownToAst(md, { bookId: 'pdf-group' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons.length).toBe(3);
    expect(res.value.lessons[0]?.title).toBe('第1課');
    expect(res.value.lessons[0]?.dialogues.length).toBe(2);
    expect(res.value.lessons[1]?.title).toContain('復習');
    expect(res.value.lessons[2]?.title).toBe('第2課');
    // 开篇杂页（ISBN/CIP）没混进第一课
    expect(
      res.value.lessons[0]?.dialogues.some((d) => d.japanese.includes('ISBN'))
    ).toBe(false);
  });
});

function stubInspector(result: {
  pdfType: string;
  pageCount: number;
  markdown?: string | null;

}) {
  return async () => ({
    processPdf: () => ({
      pdfType: result.pdfType,
      pageCount: result.pageCount,
      markdown: result.markdown ?? null,
      confidence: 0.9,
    }),

  });
}

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('convertPdfToAst', () => {
  test('文字版直提：分类透传 + AST + 统计', async () => {
    const res = await convertPdfToAst(
      { loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 3, markdown: JA_MD }) },
      { userId: 'u1', filename: '标日.pdf', bytes: PDF_HEAD }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.classification.pdfType).toBe('TextBased');
    expect(res.value.stats.lessons).toBe(2);
    expect(res.value.book.title).toBe('标日');
  });

  test('无文字层不运行 OCR，提示改用模型读取 PDF', async () => {
    const result = await convertPdfToAst({loadInspector:stubInspector({pdfType:'Scanned',pageCount:1})},{userId:'owner',filename:'scan.pdf',bytes:PDF_HEAD});
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.error.code).toBe('E_PDF_TEXT_EMPTY');
  });

  test('非 PDF 魔数 / 超页 / 非 pdf 后缀拒绝', async () => {
    const bad = await convertPdfToAst(
      { loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 1, markdown: JA_MD }) },
      { userId: 'u1', filename: 'a.pdf', bytes: new Uint8Array([1, 2, 3]) }
    );
    expect(bad.ok).toBe(false);
    const txt = await convertPdfToAst(
      { loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 1, markdown: JA_MD }) },
      { userId: 'u1', filename: 'a.txt', bytes: PDF_HEAD }
    );
    expect(txt.ok).toBe(false);
    const many = await convertPdfToAst(
      { loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 401, markdown: JA_MD }) },
      { userId: 'u1', filename: 'big.pdf', bytes: PDF_HEAD }
    );
    expect(many.ok).toBe(false);
  });

  test('选页只读取所选文字页，不存在 OCR 的 30 页限制；越界仍拒绝', async () => {
    const calls: (number[] | undefined)[]=[];
    const loadInspector=async()=>({processPdf:(_pdf:Uint8Array,pages?:number[])=>{calls.push(pages);return {pdfType:'TextBased',pageCount:371,markdown:JA_MD};}});
    const base={userId:'owner',filename:'big.pdf',bytes:PDF_HEAD};
    expect((await convertPdfToAst({loadInspector},{...base,pages:[999]})).ok).toBe(false);
    const pages=Array.from({length:31},(_,i)=>i+1), result=await convertPdfToAst({loadInspector},{...base,pages});
    expect(result.ok).toBe(true);
    if(result.ok) expect(result.value.classification.selectedPages).toEqual(pages);
    expect(calls.at(-1)).toEqual(pages);
  });
});

describe('mapPdfPages（目录感知第一步）', () => {
  const TOC_MD = `# 目录\n第 1 課 あいさつ ………… 18\n第 2 課 買い物 ………… 30\n# 第 1 課\n李さん：はじめまして。`;
  test('标题 + 目录条目抽取', () => {
    expect(extractHeadingsFromMarkdown('# 第 1 課\n## 文法', 17)).toEqual([
      { page: 17, level: 1, text: '第 1 課' },
    ]);
    // 非课程标题（前言/作者名）不收
    expect(extractHeadingsFromMarkdown('# 執筆協力\n# 徐前', 3)).toEqual([]);
    const toc = extractTocEntries(TOC_MD);
    expect(toc).toEqual([
      { label: '第 1 課 あいさつ ………… 18', lessonNo: '1', printedPage: 18 },
      { label: '第 2 課 買い物 ………… 30', lessonNo: '2', printedPage: 30 },
    ]);
  });

  test('扫描版 OCR 毛病缝合（J1 点线断行 / J2 页码前置 / 復習A粘连）', () => {
    // J1：点线结尾，页码掉到后面两行内
    expect(extractTocEntries('## 第3課 ………\n\n30\n')).toEqual([
      { label: '第3課 ……… 30', lessonNo: '3', printedPage: 30 },
    ]);
    // J2：裸页码紧贴裸课标题之前（OCR 先吐右端数字）
    expect(
      extractTocEntries('4.サントスさんも会社員です。\n18\n## 第2課\n1.これは辞書です。')
    ).toEqual([{ label: '第2課 … 18', lessonNo: '2', printedPage: 18 }]);
    // 復習A 粘连与点线式
    expect(extractTocEntries('#### 復習A42')).toEqual([
      { label: '復習A42', lessonNo: '復習A', printedPage: 42 },
    ]);
    expect(extractTocEntries('復習B ………… 78')).toEqual([
      { label: '復習B ………… 78', lessonNo: '復習B', printedPage: 78 },
    ]);
    // 反例：有点线的非课行不误收；裸数字后跟的不是课标题不回贴
    expect(extractTocEntries('はじめに ………\n第3課の復習 12\n18\n今日はいい天気です。')).toEqual([]);
  });

  test('map 服务：窗口扫描 + 越界拒绝', async () => {
    const loadInspector = async () => ({processPdf:() => ({pdfType:'TextBased',pageCount:371,markdown:TOC_MD})});
    const res = await mapPdfPages({ loadInspector }, { userId: 'u1', filename: 'm.pdf', bytes: PDF_HEAD });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.window).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(res.value.headings).toEqual([{ page: 1, level: 1, text: '第 1 課' }]);
    expect(res.value.tocEntries).toEqual([{ label: '第 1 課 あいさつ ………… 18', lessonNo: '1', printedPage: 18 }, { label: '第 2 課 買い物 ………… 30', lessonNo: '2', printedPage: 30 }]);
    const oob = await mapPdfPages({ loadInspector }, { userId: 'u1', filename: 'm.pdf', bytes: PDF_HEAD, pages: [999] });
    expect(oob.ok).toBe(false);
  });
});

describe('importPdfDocument', () => {
  test('本地路径直读：相对路径/非pdf/不存在拒绝', async () => {
    expect((await readLocalPdfFile('')).ok).toBe(false);
    expect((await readLocalPdfFile('relative/path.pdf')).ok).toBe(false);
    expect((await readLocalPdfFile('C:\\x\\y.txt')).ok).toBe(false);
    const noExist = await readLocalPdfFile(
      `C:\\no-such-dir-xyz\\${Date.now()}.pdf`
    );
    expect(noExist.ok).toBe(false);
  });

  test('转换 + 经仓储入库（单写路径不断言库实现）', async () => {
    const saved: unknown[] = [];
    const projected: Array<{ userId: string; documentId: string }> = [];
    const res = await importPdfDocument(
      {
        saveDocument: async (doc) => {
          saved.push(doc);
          const { ok } = await import('@lexdistill/shared');
          return ok(doc);
        },
        // 显式 atomic fake（import 必经 canonical 写入口）
        saveCanonicalAst: async (docBase, book) => {
          const full = { ...docBase, astJson: JSON.stringify(book) };
          saved.push(full);
          const { ok } = await import('@lexdistill/shared');
          return ok(full);
        },
        // P2-2a recorder：断言提交后显式调用（成功与否不挡导入由服务保证）。
        projectLinesSegments: async (userId: string, documentId: string) => {
          projected.push({ userId, documentId });
          const { ok } = await import('@lexdistill/shared');
          return ok({ inserted: 1, skipped: 0 });
        },
        loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 1, markdown: JA_MD }),
      },
      { userId: 'u1', filename: '标日.pdf', bytes: PDF_HEAD }
    );
    expect(isOk(res)).toBe(true);
    expect(saved.length).toBe(1);
    // P2-2a：提交后显式调用 lines 投影钩子（用户＋文档对齐）。
    if (!isOk(res)) return;
    expect(projected).toEqual([{ userId: 'u1', documentId: res.value.document.id }]);
  });
});

describe('appendPdfToDocument（接力）', () => {
  const baseAst = {
    id: 'b1',
    language: 'JA',
    title: 'Base',
    shortTitle: 'Base',
    level: 'N5',
    lessons: [
      {
        id: 'l1',
        lessonNumber: 1,
        title: '第 1 課',
        vocabularies: [],
        grammarPoints: [],
        dialogues: [{ speaker: 'A', japanese: 'こんにちは。', chinese: '' }],
        exercises: [],
      },
    ],
  };
  const baseDoc: DocumentItem = {
    id: 'doc1',
    userId: 'u1',
    title: 'Base',
    sourceKind: 'user_import' as const,
    language: 'ja',
    content: 'Base',
    astJson: JSON.stringify(baseAst),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  const deps = {
    saveDocument: async (doc: typeof baseDoc) => {
      const { ok } = await import('@lexdistill/shared');
      return ok(doc);
    },
    // 显式 atomic fake（append 必经 canonical 写入口，不退化）
    saveCanonicalAst: async (docBase: Omit<typeof baseDoc, 'astJson'>, book: unknown) => {
      const { ok } = await import('@lexdistill/shared');
      return ok({ ...docBase, astJson: JSON.stringify(book) });
    },
    getDocument: async () => {
      const { ok } = await import('@lexdistill/shared');
      return ok({ ...baseDoc });
    },
    projectLinesSegments: async (_userId: string, _documentId: string) => {
      const { ok } = await import('@lexdistill/shared');
      return ok({ inserted: 0, skipped: 0 });
    },
    loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 2, markdown: '李さん：はじめまして。' }),
  };
  // legacy characterization（P1-B replacement target）：续排号是 positional maxNo+1，
  // 不是教材真实课号；P1-B 后新课 sort_order = 现有 canonical 课数 + i + 1。
  test('新课续排号并存库（legacy positional）', async () => {
    const res = await appendPdfToDocument(deps, {
      userId: 'u1',
      documentId: 'doc1',
      filename: 'part2.pdf',
      bytes: PDF_HEAD,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.addedLessons).toBe(1);
    expect(res.value.totalLessons).toBe(2);
    const merged = JSON.parse(res.value.document.astJson as string);
    expect(merged.lessons.map((l: { lessonNumber: number }) => l.lessonNumber)).toEqual([1, 2]);
  });

  test('别人的文档 / 无 AST 接力拒绝', async () => {
    const other = await appendPdfToDocument(
      { ...deps, getDocument: async () => {
        const { ok } = await import('@lexdistill/shared');
        return ok({ ...baseDoc, userId: 'someone' });
      } },
      { userId: 'u1', documentId: 'doc1', filename: 'p.pdf', bytes: PDF_HEAD }
    );
    expect(other.ok).toBe(false);
    const noAst = await appendPdfToDocument(
      { ...deps, getDocument: async () => {
        const { ok } = await import('@lexdistill/shared');
        const { astJson: _drop, ...rest } = baseDoc;
        void _drop;
        return ok(rest);
      } },
      { userId: 'u1', documentId: 'doc1', filename: 'p.pdf', bytes: PDF_HEAD }
    );
    expect(noAst.ok).toBe(false);
  });
});

describe('archive', () => {
  test('tar.gz 回环：官方包布局可解', () => {
    // 手工组装最小 ustar（单文件 package/index.js）
    const payload = Buffer.from('module.exports = 1;');
    const header = Buffer.alloc(512);
    header.write('package/index.js', 0);
    header.write('0000777', 100);
    header.write('0000000', 108);
    header.write('0000000', 116);
    header.write(payload.length.toString(8).padStart(11, '0'), 124);
    header.write('00000000000', 136);
    header[156] = 48; // '0'
    header.write('ustar', 257);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    header.write(sum.toString(8).padStart(6, '0'), 148);
    header[154] = 0;
    const tar = Buffer.concat([header, payload, Buffer.alloc(512 - (payload.length % 512))]);
    const entries = extractTarGz(gzipSync(tar));
    expect(entries.length).toBe(1);
    expect(entries[0]?.path).toBe('package/index.js');
    expect(Buffer.from(entries[0]?.data ?? []).toString()).toBe('module.exports = 1;');
  });

  test('zip 越界路径由写盘层拦截（此处验解析不抛）', () => {
    // 仅验非法输入被拒，不构造完整 zip
    expect(() => extractZip(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => extractTarGz(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('artifacts', () => {
  test('白名单外 URL 拒绝下载', async () => {
    const res = await fetchRuntimeArtifact('https://evil.example.com/x.tgz', {
      fetchImpl: (async () => {
        throw new Error('must not fetch');
      }) as unknown as typeof fetch,
      sha256: '00',
    });
    expect(res.ok).toBe(false);
  });

  test('data: URL + integrity 校验走通（无网络）', async () => {
    const { createHash } = await import('node:crypto');
    const body = new TextEncoder().encode('hello-artifact');
    const b64 = createHash('sha512').update(body).digest('base64');
    const url = `data:application/octet-stream;base64,${Buffer.from(body).toString('base64')}`;
    const res = await fetchRuntimeArtifact(url, {
      integrity: `sha512-${b64}`,
    });
    expect(res.ok).toBe(true);
  });

  test('当前平台可解析；未知平台抛错不猜', () => {
    expect(() => currentRuntimePlatform('win32', 'x64')).not.toThrow();
    expect(() => currentRuntimePlatform('plan9', 'x64')).toThrow();
  });

  test('napi 目录去 scope（回归：曾双重嵌套导致加载失败）', () => {
    expect(napiDirName('@firecrawl/pdf-inspector-win32-x64-msvc')).toBe(
      'pdf-inspector-win32-x64-msvc'
    );
    expect(napiDirName('plain-pkg')).toBe('plain-pkg');
  });

  test('assertArtifactUrlAllowed 仅放行三处官方源', () => {
    expect(() =>
      assertArtifactUrlAllowed('https://registry.npmjs.org/@firecrawl/pdf-inspector/-/x.tgz')
    ).not.toThrow();
    expect(() => assertArtifactUrlAllowed('https://registry.npmjs.org.evil.com/x')).toThrow();
  });
});
