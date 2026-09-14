import { describe, expect, it, beforeEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { decodeTextBytes } from '@study-studio/content';
import {
  xhtmlToMarkdown,
  extractEpubText,
  parseNcxToc,
  parseNavToc,
} from '@study-studio/content/document';
import {
  guessSourceKind,
  DOCUMENT_SOURCE_KINDS,
} from '@study-studio/content';
import { LibraryImportTool } from '../modules/library/tools/library-import-tool.js';
import { extractMobiText } from '@study-studio/content';
import {
  assertPublicWebUrl,
  fetchPublicWebText,
} from '../modules/library/application/document-import/web-url.js';
import { extractWebArticle } from '../modules/library/application/document-import/url-reader.js';

// ---------- 最小 PalmDB/MOBI 构造器（未压缩，单测自包含） ----------
function buildMobiBytes(opts: { compression?: number; magic?: boolean; text?: string } = {}): Uint8Array {
  const enc = new TextEncoder();
  const textBytes = enc.encode(opts.text ?? 'Hello MOBI world. 第二段文本。');
  const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const u32 = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const out: number[] = [];
  const pushStr = (s: string, len: number) => {
    const b = enc.encode(s);
    for (let i = 0; i < len; i += 1) out.push(b[i] ?? 0);
  };
  pushStr('TestBook', 32);
  out.push(...u16(0), ...u16(0));
  out.push(...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0));
  pushStr(opts.magic === false ? 'XXXX' : 'BOOK', 4);
  pushStr('MOBI', 4);
  out.push(...u32(0), ...u32(0));
  const numRecords = 2;
  out.push(...u16(numRecords));
  const rec0Off = 78 + numRecords * 8;
  const rec1Off = rec0Off + 16 + 232;
  out.push(...u32(rec0Off), 0, 0, 0, 0);
  out.push(...u32(rec1Off), 0, 0, 0, 0);
  // record 0: PalmDOC(16) + MOBI 头
  out.push(...u16(opts.compression ?? 1), ...u16(0));
  out.push(...u32(textBytes.length), ...u16(1), ...u16(4096), ...u32(0));
  out.push(...enc.encode('MOBI'));
  out.push(...u32(232), ...u32(2));
  while (out.length < rec0Off + 16 + 28) out.push(0);
  out.push(...u32(65001));
  while (out.length < rec1Off) out.push(0);
  for (const b of textBytes) out.push(b);
  return new Uint8Array(out);
}

// ---------- 最小 stored-zip 构造器（单测自包含） ----------
function buildStoredZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  const concat = (parts: Uint8Array[]) => {
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const lh = concat([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(0), u32(f.data.length), u32(f.data.length),
      u16(nameBytes.length), u16(0),
      nameBytes,
    ]);
    chunks.push(lh, f.data);
    central.push(
      concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(0), u32(f.data.length), u32(f.data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset),
        nameBytes,
      ])
    );
    offset += lh.length + f.data.length;
  }
  const cd = concat(central);
  const end = concat([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(central.length), u16(central.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concat([...chunks, cd, end]);
}

function buildEpubBytes(): Uint8Array {
  const enc = new TextEncoder();
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试电子书</dc:title></metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="cover" linear="no"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>第一章</text></navLabel><content src="ch1.xhtml"/></navPoint><navPoint id="n2"><navLabel><text>第二章</text></navLabel><content src="ch2.xhtml"/><navPoint id="n3"><navLabel><text>第二节</text></navLabel><content src="ch2.xhtml#s3"/></navPoint></navPoint></navMap></ncx>`;
  const cover = `<html><body><p>封面图 COVER-MARKER</p></body></html>`;
  const ch1 = `<html><head><title>1</title></head><body><h1>第一章</h1><p>彼はご飯を食べる。</p><script>alert(1)</script></body></html>`;
  const ch2 = `<html><body><p>Hello world &amp; friends</p></body></html>`;
  return buildStoredZip([
    { name: 'mimetype', data: enc.encode('application/epub+zip') },
    { name: 'META-INF/container.xml', data: enc.encode(container) },
    { name: 'OEBPS/content.opf', data: enc.encode(opf) },
    { name: 'OEBPS/toc.ncx', data: enc.encode(ncx) },
    { name: 'OEBPS/cover.xhtml', data: enc.encode(cover) },
    { name: 'OEBPS/ch1.xhtml', data: enc.encode(ch1) },
    { name: 'OEBPS/ch2.xhtml', data: enc.encode(ch2) },
  ]);
}

describe('document source kinds', () => {
  it('扩展名推断；未知不猜', () => {
    expect(guessSourceKind('a.pdf')).toBe('pdf');
    expect(guessSourceKind('a.EPUB')).toBe('epub');
    expect(guessSourceKind('a.md')).toBe('text');
    expect(guessSourceKind('a.zip')).toBeUndefined();
    expect(DOCUMENT_SOURCE_KINDS).toEqual(['pdf', 'epub', 'mobi', 'text', 'url']);
  });
});

describe('text reader', () => {
  it('BOM 剥离；空拒绝', () => {
    const enc = new TextEncoder();
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('hello')]);
    expect(decodeTextBytes(withBom, 'a.txt')).toEqual({ title: 'a', markdown: 'hello' });
    expect(() => decodeTextBytes(new Uint8Array([32]), 'a.txt')).toThrow();
  });
});

describe('epub reader', () => {
  it('xhtml 脱衣（标题/段落/实体/script 丢弃）', () => {
    const md = xhtmlToMarkdown('<h1>T</h1><p>a<br>b &amp; c</p><script>x()</script>');
    expect(md).toContain('# T');
    expect(md).toContain('a\nb & c');
    expect(md.includes('x()')).toBe(false);
  });

  it('spine 顺序组装 + 标题', () => {
    const res = extractEpubText(buildEpubBytes(), 't.epub');
    expect(res.title).toBe('测试电子书');
    expect(res.markdown.indexOf('第一章') < res.markdown.indexOf('第二章')).toBe(true);
    expect(res.markdown).toContain('彼はご飯を食べる。');
    expect(res.markdown.includes('alert')).toBe(false);
    // 封面（linear=no）不进正文
    expect(res.markdown.includes('COVER-MARKER')).toBe(false);
    // 目录单元：无碎片优先，spine 顺序
    expect(res.units).toEqual(['第一章', '第二章']);
    // 无标题章由目录标签起课
    expect(res.markdown).toContain('# 第二章');
  });

  it('NCX 嵌套层级解析；EPUB3 nav 回退', () => {
    const ncx = `<ncx><navMap><navPoint id="a"><navLabel><text>卷一</text></navLabel><content src="a.xhtml"/><navPoint id="b"><navLabel><text>第一回</text></navLabel><content src="a.xhtml#r1"/></navPoint></navMap></ncx>`;
    const items = parseNcxToc(ncx, '');
    expect(items).toEqual([
      { label: '卷一', href: 'a.xhtml', level: 0 },
      { label: '第一回', href: 'a.xhtml#r1', level: 1 },
    ]);
    const nav = `<html><body><nav epub:type="toc"><ol><li><a href="x.xhtml">X</a></li></ol></nav></body></html>`;
    expect(parseNavToc(nav, 'OEBPS/nav.xhtml')).toEqual([{ label: 'X', href: 'OEBPS/x.xhtml', level: 0 }]);
    expect(parseNavToc('<html></html>', 'nav.xhtml')).toEqual([]);
  });

  it('坏包/缺 container 友好抛错', () => {
    expect(() => extractEpubText(new Uint8Array([1, 2, 3]), 'x.epub')).toThrow();
    expect(() =>
      extractEpubText(buildStoredZip([{ name: 'a', data: new Uint8Array([1]) }]), 'x.epub')
    ).toThrow();
  });
});

describe('document import service', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('EPUB 端到端：任务 done + 文档入库 + 课数', async () => {
    const res = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'epub',
      filename: 't.epub',
      bytes: buildEpubBytes(),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.task.status).toBe('done');
    expect(res.value.lessons).toBeGreaterThanOrEqual(2);
    expect(res.value.document.title).toContain('测试电子书');
    const task = await repo.getImportTask(res.value.task.id);
    expect(task?.status).toBe('done');
    expect(task?.documentId).toBe(res.value.document.id);
  });

  it('文本直传入库；坏输入任务 failed', async () => {
    const enc = new TextEncoder();
    const okRes = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'text',
      filename: 'note.txt',
      bytes: enc.encode('# 标题\n\nHello world, this is a test note with enough content here.'),
    });
    expect(isOk(okRes)).toBe(true);
    const bad = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'text',
      filename: 'empty.txt',
      bytes: new Uint8Array(0),
    });
    expect(isOk(bad)).toBe(false);
  });

  it('library.import_document Tool（真实文件往返）', async () => {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'ss-doc-tool-'));
    try {
      const file = join(dir, 'n.txt');
      await fsp.writeFile(file, '# T\n\nSome English learning text content for import testing here.');
      const tool = new (await import('../modules/library/tools/library-import-tool.js')).LibraryImportTool(repo);
      expect(tool.name).toBe('library.import_document');
      const res = await tool.execute({ userId: 'u1', kind: 'text', filePath: file }, { userId: 'u1', sessionId: 's' });
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) return;
      expect(res.value.task.status).toBe('done');
      expect(res.value.lessons).toBeGreaterThan(0);
      const missing = await tool.execute({ userId: 'u1', filePath: join(dir, 'no.txt') }, { userId: 'u1', sessionId: 's' });
      expect(isOk(missing)).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('mobi reader', () => {  it('未压缩正文提取；标题取文件名', () => {
    const res = extractMobiText(buildMobiBytes(), 'book.mobi');
    expect(res.title).toBe('book');
    expect(res.markdown).toContain('Hello MOBI world.');
  });

  it('坏魔数/压缩格式/AZW3 明示拒绝', () => {
    expect(() => extractMobiText(buildMobiBytes({ magic: false }), 'x.mobi')).toThrow();
    expect(() => extractMobiText(buildMobiBytes({ compression: 2 }), 'x.mobi')).toThrow(
      /calibre/
    );
    expect(() => extractMobiText(buildMobiBytes({ compression: 17480 }), 'x.mobi')).toThrow();
    expect(guessSourceKind('a.azw')).toBe('mobi');
    expect(guessSourceKind('a.azw3')).toBeUndefined();
  });

  it('MOBI 端到端入库', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const res = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'mobi',
      filename: 'b.mobi',
      bytes: buildMobiBytes(),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.task.status).toBe('done');
    expect(res.value.lessons).toBeGreaterThan(0);
  });
});

describe('web url guard + reader', () => {
  it('本机/私网/非法 scheme 拒绝（无 DNS 开销）', async () => {
    for (const url of [
      'http://127.0.0.1:8765/x',
      'http://localhost/x',
      'http://10.1.2.3/x',
      'http://192.168.1.1/x',
      'http://169.254.1.1/x',
      'ftp://example.com/x',
      'not a url',
    ]) {
      await expect(assertPublicWebUrl(url)).rejects.toThrow();
    }
  });

  it('重定向落点私网被拦截；超大与非 HTML 拒绝', async () => {
    const redirectToLocal = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:9/evil' },
      })) as unknown as typeof fetch;
    await expect(
      fetchPublicWebText('http://93.184.216.0/start', redirectToLocal)
    ).rejects.toThrow();
    const big = (async () =>
      new Response('x', {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) },
      })) as unknown as typeof fetch;
    await expect(fetchPublicWebText('http://93.184.216.0/big', big)).rejects.toThrow();
    const pdf = (async () =>
      new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch;
    await expect(fetchPublicWebText('http://93.184.216.0/f.pdf', pdf)).rejects.toThrow();
  });

  it('正文抽取 + 标题；抽不出判空', async () => {
    const article = (async () =>
      new Response(
        '<html><head><title>Test News</title></head><body><article><p>First paragraph with enough content to pass the minimum length requirement for full text extraction logic here.</p><p>Second paragraph adds more study material for the learner reading set generation pipeline test.</p></article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      )) as unknown as typeof fetch;
    const res = await extractWebArticle('http://93.184.216.0/news/1', article);
    expect(res.title).toBe('Test News');
    expect(res.markdown).toContain('First paragraph');
    const empty = (async () =>
      new Response('<html><body><p>hi</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    await expect(extractWebArticle('http://93.184.216.0/empty', empty)).rejects.toThrow();
  });

  it('URL 端到端入库（桩抓取）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    // 经 repo 委托走真实抓取函数：此处仅验任务失败路径（无网不外发）
    const res = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'url',
      filename: 'web',
      url: 'http://127.0.0.1:9/blocked',
    });
    expect(isOk(res)).toBe(false);
    const task = await repo.getImportTask('import-0000000000000000');
    expect(task).toBeUndefined();
  });
});

describe('import tasks', () => {
  it('建任务→更新→读取（读侧永不抛）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const created = await repo.createImportTask({ userId: 'u1', sourceKind: 'epub', filename: 'b.epub' });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.status).toBe('processing');
    const done = await repo.updateImportTask(created.value.id, {
      status: 'done',
      documentId: 'doc1',
      lessons: 3,
    });
    expect(isOk(done)).toBe(true);
    if (!isOk(done)) return;
    expect(done.value.documentId).toBe('doc1');
    const fetched = await repo.getImportTask(created.value.id);
    expect(fetched?.status).toBe('done');
    expect(await repo.getImportTask('nope')).toBeUndefined();
    const missing = await repo.updateImportTask('nope', { status: 'failed', error: 'x' });
    expect(isOk(missing)).toBe(false);
  });
});
