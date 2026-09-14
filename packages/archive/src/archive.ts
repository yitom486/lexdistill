import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { BusinessError } from '@study-studio/shared';

/**
 * 最小归档解包器（纯 TS，无系统依赖）。
 * 只支持解 pdf-inspector / PDFium / ORT 官方包所需的子集：
 * - tar.gz：ustar 普通文件（typeflag '0'/空格），忽略目录/链接/超长 pax；
 * - zip：stored(0) / deflate(8)，忽略目录与加密。
 * 体积上限 300MB，防 zip bomb。
 */
export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

/** zip 条目路径归一化（Windows 产包偶见反斜杠；zip 规范分隔符为 /）。 */
export function normalizeZipEntryPaths(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.map((e) => (e.path.includes('\\') ? { ...e, path: e.path.replace(/\\/g, '/') } : e));
}

const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MAX_ENTRY_BYTES = 150 * 1024 * 1024;

function ascii(view: Uint8Array, off: number, len: number): string {
  let end = off + len;
  for (let i = off; i < off + len; i++) {
    if (view[i] === 0) {
      end = i;
      break;
    }
  }
  return Buffer.from(view.subarray(off, end)).toString('latin1');
}

function octal(view: Uint8Array, off: number, len: number): number {
  const s = ascii(view, off, len).trim().replace(/\0/g, '');
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

export interface ExtractOptions {
  /**
   *  ingredient 级 denylist（运行时 bootstrap 用）：返回 true 即跳过该条目，
   *  不解压不落盘。当前唯一用途：跳过 ORT 包内 403MB 的 *.pdb 调试符号
   * （MAX_ENTRY_BYTES=150MB 会整体拒绝解包；pdb 永不被加载，跳过是安全的）。
   */
  skipEntry?: (path: string) => boolean;
}

export function extractTarGz(input: Uint8Array, opts: ExtractOptions = {}): ArchiveEntry[] {
  let tar: Uint8Array;
  try {
    tar = gunzipSync(input);
  } catch {
    throw new BusinessError('E_RUNTIME_EXTRACT', '构件包解压失败：不是有效的 gzip 数据', 'TOOL_EXECUTION');
  }
  if (tar.length > MAX_ARCHIVE_BYTES) {
    throw new BusinessError('E_RUNTIME_EXTRACT', '构件包过大，拒绝解包', 'TOOL_EXECUTION');
  }
  const entries: ArchiveEntry[] = [];
  let off = 0;
  for (;;) {
    if (off + 512 > tar.length) break;
    const name = ascii(tar, off, 100);
    if (!name) break; // 两个零块 = 结束
    const size = octal(tar, off + 124, 12);
    const typeflag = String.fromCharCode(tar[off + 156] ?? 0);
    // ustar 长名（'x' 扩展头）：跳过内容块即可，下一头才是真名（官方包无此情况，防御性跳过）
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new BusinessError('E_RUNTIME_EXTRACT', '构件包截断，拒绝解包', 'TOOL_EXECUTION');
    }
    if ((typeflag === '0' || typeflag === '\0') && size > 0 && size <= MAX_ENTRY_BYTES) {
      const prefix = ascii(tar, off + 345, 155);
      const fullName = prefix ? `${prefix}/${name}` : name;
      if (!opts.skipEntry?.(fullName)) {
        entries.push({ path: fullName, data: tar.subarray(dataStart, dataEnd) });
      }
    }
    off = dataEnd + ((512 - (size % 512)) % 512);
  }
  return entries;
}

function u16(view: Uint8Array, off: number): number {
  return (view[off] ?? 0) | ((view[off + 1] ?? 0) << 8);
}
function u32(view: Uint8Array, off: number): number {
  return (
    ((view[off] ?? 0) |
      ((view[off + 1] ?? 0) << 8) |
      ((view[off + 2] ?? 0) << 16) |
      ((view[off + 3] ?? 0) << 24)) >>>
    0
  );
}

export function extractZip(input: Uint8Array, opts: ExtractOptions = {}): ArchiveEntry[] {
  if (input.length > MAX_ARCHIVE_BYTES) {
    throw new BusinessError('E_RUNTIME_EXTRACT', '构件包过大，拒绝解包', 'TOOL_EXECUTION');
  }
  // 定位 End of Central Directory
  let eocd = -1;
  for (let i = input.length - 22; i >= 0 && i >= input.length - 22 - 65536; i--) {
    if (u32(input, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new BusinessError('E_RUNTIME_EXTRACT', '构件包解压失败：不是有效的 zip 数据', 'TOOL_EXECUTION');
  }
  return extractZipInner(input, eocd, opts);
}

function extractZipInner(input: Uint8Array, eocd: number, opts: ExtractOptions): ArchiveEntry[] {
  const text = (off: number, len: number) =>
    Buffer.from(input.subarray(off, off + len)).toString('utf8');
  const centralCount = u16(input, eocd + 10);
  let ptr = u32(input, eocd + 16);
  const entries: ArchiveEntry[] = [];
  for (let n = 0; n < centralCount; n++) {
    if (u32(input, ptr) !== 0x02014b50) {
      throw new BusinessError('E_RUNTIME_EXTRACT', '构件包中央目录损坏，拒绝解包', 'TOOL_EXECUTION');
    }
    const flags = u16(input, ptr + 8);
    const method = u16(input, ptr + 10);
    const compSize = u32(input, ptr + 20);
    const uncompSize = u32(input, ptr + 24);
    const nameLen = u16(input, ptr + 28);
    const extraLen = u16(input, ptr + 30);
    const commentLen = u16(input, ptr + 32);
    const localHeaderOff = u32(input, ptr + 42);
    const name = text(ptr + 46, nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || uncompSize === 0) continue; // 目录或空项
    if (opts.skipEntry?.(name)) continue; // denylist（如 *.pdb）：连解压都不做，省内存
    if (uncompSize > MAX_ENTRY_BYTES || compSize > MAX_ENTRY_BYTES) {
      throw new BusinessError('E_RUNTIME_EXTRACT', '构件包内单文件过大，拒绝解包', 'TOOL_EXECUTION');
    }
    if ((flags & 0x1) !== 0) {
      throw new BusinessError('E_RUNTIME_EXTRACT', '构件包内含加密文件，拒绝解包', 'TOOL_EXECUTION');
    }
    if (u32(input, localHeaderOff) !== 0x04034b50) {
      throw new BusinessError('E_RUNTIME_EXTRACT', '构件包局部头损坏，拒绝解包', 'TOOL_EXECUTION');
    }
    const lhNameLen = u16(input, localHeaderOff + 26);
    const lhExtraLen = u16(input, localHeaderOff + 28);
    const dataStart = localHeaderOff + 30 + lhNameLen + lhExtraLen;
    const comp = input.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) {
      data = comp;
    } else if (method === 8) {
      // 真实世界 zip（7z/Info-ZIP）存裸 deflate 流；Node deflateSync 产 zlib 包裹流；两者都接受
      try {
        data = inflateSync(comp);
      } catch {
        try {
          data = inflateRawSync(comp);
        } catch {
          throw new BusinessError('E_RUNTIME_EXTRACT', '构件包 deflate 解压失败', 'TOOL_EXECUTION');
        }
      }
    } else {
      throw new BusinessError(
        'E_RUNTIME_EXTRACT',
        `构件包使用了不支持的压缩方式（${method}），拒绝解包`,
        'TOOL_EXECUTION'
      );
    }
    entries.push({ path: name, data });
  }
  return entries;
}
