import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { detectDocScript, markdownToAst } from '../modules/library/application/pdf-import/markdown-to-ast.js';
import {
  extractHeadingsFromMarkdown,
  extractTocEntries,
} from '../modules/library/application/pdf-import/extract-headings.js';
import {
  appendPdfToDocument,
  convertPdfToAst,
  importPdfDocument,
  mapPdfPages,
} from '../modules/library/application/pdf-import/pdf-import-service.js';
import { readLocalPdfFile } from '../modules/library/application/pdf-import/local-file.js';
import type { DocumentItem } from '@study-studio/protocol';
import { extractTarGz, extractZip } from '../modules/library/application/pdf-import/archive.js';
import { assertArtifactUrlAllowed, currentRuntimePlatform } from '../modules/library/application/pdf-import/pdf-artifacts.js';
import { fetchRuntimeArtifact, napiDirName } from '../modules/library/application/pdf-import/pdf-runtime.js';import { isOk } from '@study-studio/shared';

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
});

function stubInspector(result: {
  pdfType: string;
  pageCount: number;
  markdown?: string | null;
  pagesNeedingOcr?: number[];
  ocrMarkdown?: string | null;
}) {
  return async () => ({
    processPdf: () => ({
      pdfType: result.pdfType,
      pageCount: result.pageCount,
      markdown: result.markdown ?? null,
      pagesNeedingOcr: result.pagesNeedingOcr ?? [],
      confidence: 0.9,
    }),
    processPdfWithOcr: async () => ({
      markdown: result.ocrMarkdown ?? null,
      pagesRoutedToOcr: result.pagesNeedingOcr ?? [],
      pagesRecommendingHosted: [],
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
    expect(res.value.classification.ocrUsed).toBe(false);
    expect(res.value.stats.lessons).toBe(2);
    expect(res.value.book.title).toBe('标日');
  });

  test('扫描版走 OCR：ocrUsed=true', async () => {
    const res = await convertPdfToAst(
      {
        loadInspector: stubInspector({
          pdfType: 'Scanned',
          pageCount: 1,
          markdown: null,
          pagesNeedingOcr: [1],
          ocrMarkdown: JA_MD,
        }),
      },
      { userId: 'u1', filename: 'scan.pdf', bytes: PDF_HEAD }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.classification.ocrUsed).toBe(true);
  });

  test('OCR 无输出 → E_OCR_LANG_UNSUPPORTED（韩语包缺口如实报错）', async () => {
    const res = await convertPdfToAst(
      {
        loadInspector: stubInspector({
          pdfType: 'Scanned',
          pageCount: 1,
          markdown: null,
          pagesNeedingOcr: [1],
          ocrMarkdown: '',
        }),
      },
      { userId: 'u1', filename: 'ko-scan.pdf', bytes: PDF_HEAD }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('E_OCR_LANG_UNSUPPORTED');
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

  test('选页：越界拒绝；文字选页直提；OCR 超 30 页拒绝', async () => {
    const base = { userId: 'u1', filename: 'big.pdf', bytes: PDF_HEAD };
    const calls: Array<{ pages?: number[]; ocrPages?: number[] }> = [];
    const loadInspector = async () => ({
      processPdf: (pdf: Uint8Array, pages?: number[]) => {
        if (pages !== undefined) calls.push({ pages });
        else calls.push({});
        void pdf;
        return {
          pdfType: 'Mixed',
          pageCount: 371,
          markdown: null,
          pagesNeedingOcr: Array.from({ length: 371 }, (_, i) => i + 1),
          confidence: 0.9,
        };
      },
      processPdfWithOcr: async (pdf: Uint8Array, options?: { pageNumbers?: number[] }) => {
        if (options?.pageNumbers !== undefined) calls.push({ ocrPages: options.pageNumbers });
        else calls.push({});
        void pdf;
        return { markdown: JA_MD, pagesRoutedToOcr: options?.pageNumbers ?? [], pagesRecommendingHosted: [] };
      },
    });
    // 越界
    const oob = await convertPdfToAst({ loadInspector }, { ...base, pages: [999] });
    expect(oob.ok).toBe(false);
    // OCR 31 页拒绝（先经过校验，不调 OCR）
    const tooMany = await convertPdfToAst(
      { loadInspector },
      { ...base, pages: Array.from({ length: 31 }, (_, i) => i + 1) }
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe('E_INVALID_INPUT');
    // 正常选页：只 OCR 所选
    const okRes = await convertPdfToAst({ loadInspector }, { ...base, pages: [1, 2, 3] });
    expect(okRes.ok).toBe(true);
    if (!okRes.ok) return;
    expect(okRes.value.classification.ocrUsed).toBe(true);
    expect(okRes.value.classification.selectedPages).toEqual([1, 2, 3]);
    expect(okRes.value.stats.lessons).toBe(2);
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
    const perPage = [
      { pageNumber: 16, markdown: '# 目录\n第 1 課 … 18' },
      { pageNumber: 17, markdown: '# 第 1 課\n李さん：はじめまして。' },
    ];
    const loadInspector = async () => ({
      processPdf: () => ({ pdfType: 'Mixed', pageCount: 371, markdown: null, pagesNeedingOcr: [16, 17], confidence: 0.9 }),
      processPdfWithOcr: async () => ({
        markdown: perPage.map((p) => p.markdown).join('\n'),
        pages: perPage,
        pagesRoutedToOcr: [16, 17],
        pagesRecommendingHosted: [],
      }),
    });
    const res = await mapPdfPages({ loadInspector }, { userId: 'u1', filename: 'm.pdf', bytes: PDF_HEAD });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.window).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(res.value.headings).toEqual([{ page: 17, level: 1, text: '第 1 課' }]);
    expect(res.value.tocEntries).toEqual([{ label: '第 1 課 … 18', lessonNo: '1', printedPage: 18 }]);
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
    const res = await importPdfDocument(
      {
        saveDocument: async (doc) => {
          saved.push(doc);
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 1, markdown: JA_MD }),
      },
      { userId: 'u1', filename: '标日.pdf', bytes: PDF_HEAD }
    );
    expect(isOk(res)).toBe(true);
    expect(saved.length).toBe(1);
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
      const { ok } = await import('@study-studio/shared');
      return ok(doc);
    },
    getDocument: async () => {
      const { ok } = await import('@study-studio/shared');
      return ok({ ...baseDoc });
    },
    loadInspector: stubInspector({ pdfType: 'TextBased', pageCount: 2, markdown: '李さん：はじめまして。' }),
  };
  test('新课续排号并存库', async () => {
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
        const { ok } = await import('@study-studio/shared');
        return ok({ ...baseDoc, userId: 'someone' });
      } },
      { userId: 'u1', documentId: 'doc1', filename: 'p.pdf', bytes: PDF_HEAD }
    );
    expect(other.ok).toBe(false);
    const noAst = await appendPdfToDocument(
      { ...deps, getDocument: async () => {
        const { ok } = await import('@study-studio/shared');
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
