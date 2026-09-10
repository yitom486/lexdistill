import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk } from '@study-studio/shared';
import { readLocalPdfFile, stripLocalPdfPathQuotes } from '../application/pdf-import/local-file.js';

describe('stripLocalPdfPathQuotes（网关入口剥引号）', () => {
  it('成对引号剥掉，无引号不变，不成对不动', () => {
    expect(stripLocalPdfPathQuotes('"C:\\Books\\a.pdf"')).toBe('C:\\Books\\a.pdf');
    expect(stripLocalPdfPathQuotes("'C:\\Books\\a.pdf'")).toBe('C:\\Books\\a.pdf');
    expect(stripLocalPdfPathQuotes('C:\\Books\\a.pdf')).toBe('C:\\Books\\a.pdf');
    expect(stripLocalPdfPathQuotes('"C:\\Books\\a.pdf')).toBe('"C:\\Books\\a.pdf');
  });
});

describe('readLocalPdfFile 带引号路径可直读（临时文件，跑完即删）', () => {
  it('两端双引号包裹的绝对路径读出同一文件', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpdir(), 'cmd10-quote-'));
    try {
      const file = path.join(dir, 'q.pdf');
      await fsp.writeFile(file, new TextEncoder().encode('%PDF-1.4 quote-probe'));
      const res = await readLocalPdfFile(`"${file}"`);
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) return;
      expect(res.value.filename).toBe('q.pdf');
      expect(res.value.bytes.length).toBeGreaterThan(0);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
