import { describe, expect, test } from 'bun:test';
import { PDF_UPLOAD_SIZE_LIMIT_BYTES, isPdfUploadTooLarge } from '../pdf-upload-guard.js';

describe('isPdfUploadTooLarge（大文件不走上传）', () => {
  test('32MiB 为界：小文件可上传，界上拒绝', () => {
    expect(PDF_UPLOAD_SIZE_LIMIT_BYTES).toBe(32 * 1024 * 1024);
    expect(isPdfUploadTooLarge(1024)).toBe(false);
    expect(isPdfUploadTooLarge(PDF_UPLOAD_SIZE_LIMIT_BYTES - 1)).toBe(false);
    expect(isPdfUploadTooLarge(PDF_UPLOAD_SIZE_LIMIT_BYTES)).toBe(true);
    expect(isPdfUploadTooLarge(200 * 1024 * 1024)).toBe(true);
  });
});
