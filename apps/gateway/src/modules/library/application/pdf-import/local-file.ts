import { promises as fsp, createReadStream } from 'node:fs';
import path from 'node:path';
import { BusinessError, err, ok, type Result } from '@lexdistill/shared';

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

function isReadAborted(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return false;
  }
}

/** 分块读取进度（只含字节数，无路径无内容）。 */
export interface LocalPdfReadProgress {
  readBytes: number;
  totalBytes: number;
}

export type LocalPdfStreamedOutcome =
  | { cancelled: true }
  | { cancelled: false; result: Result<LocalPdfFile, BusinessError> };

export interface LocalPdfStreamedHooks {
  onProgress?: (progress: LocalPdfReadProgress) => void;
  signal?: AbortSignal;
}

/**
 * CMD-LINGUA-P2.1a：分块可取消本地读取（流式目录探测的文件源）。
 *
 * 与 `readLocalPdfFile` 同校验、同错误码/文案（绝对路径/.pdf/stat/500MB/
 * 魔数），差别有三：① `stat.size` 先行给出总量；② 分块累积，每跨
 * `LOCAL_PDF_PROGRESS_BYTES` 上报一次真实已读字节（调用方转进度事件，
 * 小文件可能零次 progress、直接 ready，不伪造）；③ 分块间查 signal，
 * abort 即销毁流并停读（不抛，用 cancelled 标记，调用方只发 cancelled）。
 * 不建缓存、不写临时文件、不起后台任务。
 */
export const LOCAL_PDF_PROGRESS_BYTES = 256 * 1024;

export async function readLocalPdfFileStreamed(
  filePath: string,
  hooks: LocalPdfStreamedHooks = {}
): Promise<LocalPdfStreamedOutcome> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', '请提供本地 PDF 路径', 'VALIDATION')),
    };
  }
  filePath = stripLocalPdfPathQuotes(filePath);
  if (!path.isAbsolute(filePath)) {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', '只接受绝对路径（相对路径拒绝）', 'VALIDATION')),
    };
  }
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', '只支持 .pdf 文件导入', 'VALIDATION')),
    };
  }
  if (isReadAborted(hooks.signal)) return { cancelled: true };
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', '本地文件不存在或无权读取', 'VALIDATION')),
    };
  }
  if (isReadAborted(hooks.signal)) return { cancelled: true };
  if (!stat.isFile()) {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', '路径不是文件', 'VALIDATION')),
    };
  }
  if (stat.size === 0 || stat.size > MAX_LOCAL_PDF_BYTES) {
    return {
      cancelled: false,
      result: err(new BusinessError('E_INVALID_INPUT', 'PDF 文件过大（本地直读上限 500MB）', 'VALIDATION')),
    };
  }
  const totalBytes = stat.size;
  const filename = path.basename(filePath);
  return new Promise<LocalPdfStreamedOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: LocalPdfStreamedOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const chunks: Buffer[] = [];
    let readBytes = 0;
    let lastEmitted = 0;
    let stream: ReturnType<typeof createReadStream>;
    try {
      stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
    } catch {
      finish({
        cancelled: false,
        result: err(new BusinessError('E_INVALID_INPUT', '本地文件读取失败', 'VALIDATION')),
      });
      return;
    }
    const onAbort = (): void => {
      try {
        stream.destroy();
      } catch {
        // 销毁失败可忽略：以 cancelled 标记为准，不再读后续分块。
      }
      finish({ cancelled: true });
    };
    try {
      hooks.signal?.addEventListener('abort', onAbort, { once: true });
    } catch {
      // signal 不可用时退化为无取消（旧行为），分块循环仍受上限保护。
    }
    stream.on('data', (chunk: Buffer | string) => {
      if (isReadAborted(hooks.signal)) {
        onAbort();
        return;
      }
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      chunks.push(buf);
      readBytes += buf.length;
      if (readBytes > MAX_LOCAL_PDF_BYTES) {
        try {
          stream.destroy();
        } catch {
          // 同上，销毁失败不掩盖上限错误。
        }
        finish({
          cancelled: false,
          result: err(new BusinessError('E_INVALID_INPUT', 'PDF 文件过大（本地直读上限 500MB）', 'VALIDATION')),
        });
        return;
      }
      if (readBytes - lastEmitted >= LOCAL_PDF_PROGRESS_BYTES) {
        lastEmitted = readBytes;
        try {
          hooks.onProgress?.({ readBytes, totalBytes });
        } catch {
          // 进度回调异常不得中断读取（显示问题不影响 IO）。
        }
      }
    });
    stream.on('end', () => {
      if (isReadAborted(hooks.signal)) {
        finish({ cancelled: true });
        return;
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const magic = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
      if (magic !== '%PDF-') {
        finish({
          cancelled: false,
          result: err(new BusinessError('E_INVALID_INPUT', '文件头不是合法 PDF，请确认文件未损坏', 'VALIDATION')),
        });
        return;
      }
      finish({ cancelled: false, result: ok({ bytes, filename }) });
    });
    stream.on('error', () => {
      finish({
        cancelled: false,
        result: err(new BusinessError('E_INVALID_INPUT', '本地文件读取失败', 'VALIDATION')),
      });
    });
  });
}
