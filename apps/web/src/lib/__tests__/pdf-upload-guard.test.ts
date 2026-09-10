import { describe, expect, test } from 'bun:test';
import {
  PDF_UPLOAD_SIZE_LIMIT_BYTES,
  isPdfUploadTooLarge,
  pdfTooLargeMessage,
  stripPdfPathQuotes,
} from '../pdf-upload-guard.js';

describe('isPdfUploadTooLarge（大文件不走上传）', () => {
  test('32MiB 为界：小文件可上传，界上拒绝', () => {
    expect(PDF_UPLOAD_SIZE_LIMIT_BYTES).toBe(32 * 1024 * 1024);
    expect(isPdfUploadTooLarge(1024)).toBe(false);
    expect(isPdfUploadTooLarge(PDF_UPLOAD_SIZE_LIMIT_BYTES - 1)).toBe(false);
    expect(isPdfUploadTooLarge(PDF_UPLOAD_SIZE_LIMIT_BYTES)).toBe(true);
    expect(isPdfUploadTooLarge(200 * 1024 * 1024)).toBe(true);
  });
});

describe('pdfTooLargeMessage（超大文件引导文案，单源）', () => {
  test('含文件名、约 MB 与直读引导', () => {
    const msg = pdfTooLargeMessage('big-scan.pdf', 32 * 1024 * 1024);
    expect(msg).toContain('big-scan.pdf');
    expect(msg).toContain('32MB');
    expect(msg).toContain('本机绝对路径直读');
    expect(msg).toContain('开始导入');
  });

  test('百 MB 大书约数正确（167MB）', () => {
    const msg = pdfTooLargeMessage('big-scan.pdf', 167 * 1024 * 1024);
    expect(msg).toContain('big-scan.pdf');
    expect(msg).toContain('167MB');
    expect(msg).toContain('不能用选择文件上传');
  });

  test('小于 32MiB 不触发上传守卫（不走该文案）', () => {
    expect(isPdfUploadTooLarge(31 * 1024 * 1024)).toBe(false);
  });
});

describe('stripPdfPathQuotes（截图路径剥两端引号）', () => {
  test('成对双引号/单引号剥掉，无引号不变', () => {
    expect(stripPdfPathQuotes('"C:\\Books\\a.pdf"')).toBe('C:\\Books\\a.pdf');
    expect(stripPdfPathQuotes("'C:\\Books\\a.pdf'")).toBe('C:\\Books\\a.pdf');
    expect(stripPdfPathQuotes('C:\\Books\\a.pdf')).toBe('C:\\Books\\a.pdf');
  });

  test('只剥两端：不成对与中间字符不动', () => {
    expect(stripPdfPathQuotes('"C:\\Books\\a.pdf')).toBe('"C:\\Books\\a.pdf');
    expect(stripPdfPathQuotes("C:\\It's\\a.pdf")).toBe("C:\\It's\\a.pdf");
    expect(stripPdfPathQuotes('  "C:\\Books\\a.pdf"  ')).toBe('C:\\Books\\a.pdf');
  });
});
