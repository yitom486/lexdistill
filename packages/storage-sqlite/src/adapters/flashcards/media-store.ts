import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@lexdistill/shared';
import { dictionaryMedia } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

/**
 * 用户媒体库（内容寻址落盘 + SQLite 登记）。
 * 小文件亦落盘（BLOB 膨胀主库得不偿失）；调用方按 file_hash 去重，path 相对媒体根。
 *
 * D3 起家在 storage-sqlite（前身 gateway modules/flashcards/persistence/media-store.ts，
 * 逻辑不变）。参数收窄为 `{ db }`；媒体根目录解析内联于此（SSOT 仍是 gateway 侧
 * `infrastructure/persistence/app-paths.ts`，E2 搬迁 pdf-runtime 连带 app-paths 时
 * 在此改回引用，届时删除本文件内联实现——双源禁长期并存）。
 */

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
};

/** 默认媒体根（内联自 app-paths，见文件头注记；E2 重逢后改回引用）。 */
function resolveDefaultMediaDir(): string {
  const override = process.env.LEXDISTILL_RUNTIME_DIR || process.env.STUDY_STUDIO_RUNTIME_DIR;
  const legacyDir = path.join(homedir(), '.study-studio', 'runtime');
  const newDir = path.join(homedir(), '.lexdistill', 'runtime');
  const baseDir = (!existsSync(newDir) && existsSync(legacyDir)) ? legacyDir : newDir;
  const runtime = override && override.trim() ? override.trim() : baseDir;
  return path.join(runtime, 'media');
}

export interface StoredMedia {
  id: string;
  sourceId: string;
  path: string;
  mediaType: string;
  fileHash: string;
  fileSize: number;
}

/** 文件名/魔数双通道判定媒体类型（都认不出则拒绝，不猜）。 */
export function detectMediaType(filename: string, bytes: Uint8Array): string | undefined {
  const lower = filename.toLowerCase();
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) {
    return 'audio/wav';
  }
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'audio/ogg';
  }
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return undefined;
}

/** 媒体入库（同哈希复用文件；返回登记行）。 */
export async function storeMedia(
  deps: { db: DrizzleDb },
  sourceId: string,
  filename: string,
  bytes: Uint8Array,
  mediaRoot?: string
): Promise<Result<StoredMedia, BusinessError>> {
  try {
    if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
      return err(
        new BusinessError('E_INVALID_INPUT', '媒体文件为空或过大（上限 20MB），已跳过', 'VALIDATION', false)
      );
    }
    const mediaType = detectMediaType(filename, bytes);
    if (!mediaType) {
      return err(
        new BusinessError('E_INVALID_INPUT', `无法识别的媒体类型（${filename}），已跳过`, 'VALIDATION', false)
      );
    }
    const ext = MEDIA_EXTENSIONS[mediaType] ?? 'bin';
    const hash = createHash('sha256').update(bytes).digest('hex');
    const root = mediaRoot ?? resolveDefaultMediaDir();
    const relPath = `${hash.slice(0, 2)}/${hash}.${ext}`;
    const existing = await deps.db
      .select()
      .from(dictionaryMedia)
      .where(eq(dictionaryMedia.fileHash, hash))
      .limit(1);
    if (existing[0]) {
      const row = existing[0];
      return ok({
        id: row.id,
        sourceId: row.sourceId,
        path: row.path,
        mediaType: row.mediaType,
        fileHash: row.fileHash,
        fileSize: row.fileSize,
      });
    }
    await fsp.mkdir(path.join(root, hash.slice(0, 2)), { recursive: true });
    await fsp.writeFile(path.join(root, relPath), bytes);
    const record: StoredMedia = {
      id: generateId('media'),
      sourceId,
      path: relPath,
      mediaType,
      fileHash: hash,
      fileSize: bytes.length,
    };
    await deps.db.insert(dictionaryMedia).values({
      id: record.id,
      sourceId: record.sourceId,
      path: record.path,
      mediaType: record.mediaType,
      fileHash: record.fileHash,
      fileSize: record.fileSize,
      createdAt: nowIso(),
    });
    return ok(record);
  } catch (e) {
    return err(translateToBusinessError(e, 'storeMedia'));
  }
}

/** 按哈希读媒体字节（服务路由用；路径穿越无关——路径恒由哈希派生）。 */
export async function readMediaBytes(
  deps: { db: DrizzleDb },
  fileHash: string,
  mediaRoot?: string
): Promise<Result<{ bytes: Uint8Array; mediaType: string }, BusinessError>> {
  try {
    if (!/^[0-9a-f]{64}$/.test(fileHash)) {
      return err(new BusinessError('E_INVALID_INPUT', '媒体哈希不正确', 'VALIDATION', false));
    }
    const rows = await deps.db
      .select()
      .from(dictionaryMedia)
      .where(eq(dictionaryMedia.fileHash, fileHash))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return err(new BusinessError('E_NOT_FOUND', '媒体不存在', 'LEARNER_STATE', false));
    }
    const root = mediaRoot ?? resolveDefaultMediaDir();
    const data = await fsp.readFile(path.join(root, row.path));
    return ok({ bytes: new Uint8Array(data), mediaType: row.mediaType });
  } catch (e) {
    return err(translateToBusinessError(e, 'readMediaBytes'));
  }
}
