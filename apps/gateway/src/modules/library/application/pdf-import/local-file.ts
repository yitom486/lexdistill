import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';

/**
 * 本地路径直读（大文件模式）。
 * 背景：171MB 级 PDF 走 multipart 上传会把网关进程 OOM 干崩（Hono parseBody 常驻缓冲；
 * 真机复现两次）。同机网关（本机 dev / Tauri sidecar）直接读文件，零 HTTP 拷贝。
 * 仅限本机路径：必须是绝对路径 .pdf 文件，上限 500MB，读后验魔数。
 */

export const MAX_LOCAL_PDF_BYTES = 500 * 1024 * 1024;

/**
 * 路径剥引号（纯函数）：trim 后只剥两端成对 `"` / `'`，不动中间字符。
 * 前端发送前同样剥一次（见 web `pdf-upload-guard.ts`），此处是网关入口兜底。
 */
export function stripLocalPdfPathQuotes(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export interface LocalPdfFile {
  bytes: Uint8Array;
  filename: string;
}

export async function readLocalPdfFile(filePath: string): Promise<Result<LocalPdfFile, BusinessError>> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '请提供本地 PDF 路径', 'VALIDATION'));
  }
  // CMD-10：截图/复制常带一对引号，入口先剥（只剥两端成对引号，不动中间字符）。
  filePath = stripLocalPdfPathQuotes(filePath);
  if (!path.isAbsolute(filePath)) {
    return err(new BusinessError('E_INVALID_INPUT', '只接受绝对路径（相对路径拒绝）', 'VALIDATION'));
  }
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return err(new BusinessError('E_INVALID_INPUT', '只支持 .pdf 文件导入', 'VALIDATION'));
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return err(new BusinessError('E_INVALID_INPUT', '本地文件不存在或无权读取', 'VALIDATION'));
  }
  if (!stat.isFile()) {
    return err(new BusinessError('E_INVALID_INPUT', '路径不是文件', 'VALIDATION'));
  }
  if (stat.size === 0 || stat.size > MAX_LOCAL_PDF_BYTES) {
    return err(
      new BusinessError('E_INVALID_INPUT', 'PDF 文件过大（本地直读上限 500MB）', 'VALIDATION')
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fsp.readFile(filePath));
  } catch {
    return err(new BusinessError('E_INVALID_INPUT', '本地文件读取失败', 'VALIDATION'));
  }
  const magic = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
  if (magic !== '%PDF-') {
    return err(new BusinessError('E_INVALID_INPUT', '文件头不是合法 PDF，请确认文件未损坏', 'VALIDATION'));
  }
  return ok({ bytes, filename: path.basename(filePath) });
}
