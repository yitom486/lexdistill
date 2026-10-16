import { describe, expect, it, beforeEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { detectMediaType } from '@lexdistill/storage-sqlite';

describe('detectMediaType', () => {
  it('魔数优先：jpeg/png/mp3/wav/ogg', () => {
    expect(detectMediaType('x.bin', new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(
      detectMediaType('x.bin', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))
    ).toBe('image/png');
    expect(detectMediaType('x.bin', new Uint8Array([0x49, 0x44, 0x33]))).toBe('audio/mpeg');
    expect(
      detectMediaType('x.bin', new Uint8Array([0x52, 0x49, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x57, 0x00, 0x00, 0x00]))
    ).toBe('audio/wav');
  });

  it('魔数缺失回退扩展名；都认不出返回 undefined（不猜）', () => {
    expect(detectMediaType('a.WAV', new Uint8Array([1, 2, 3]))).toBe('audio/wav');
    expect(detectMediaType('a.webp', new Uint8Array([1, 2, 3]))).toBe('image/webp');
    expect(detectMediaType('a.xyz', new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('media store', () => {
  let repo: DrizzleLearnerRepository;
  let mediaRoot: string;
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    mediaRoot = await fsp.mkdtemp(join(tmpdir(), 'ss-media-test-'));
  });

  it('入库→读回往返；同哈希复用', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    const first = await repo.storeMediaFile('apkg:Test', 'photo.jpg', bytes, mediaRoot);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.mediaType).toBe('image/jpeg');
    expect(first.value.path.endsWith('.jpg')).toBe(true);
    const read = await repo.readMediaFile(first.value.fileHash, mediaRoot);
    expect(isOk(read)).toBe(true);
    if (!isOk(read)) return;
    expect(read.value.mediaType).toBe('image/jpeg');
    expect([...read.value.bytes]).toEqual([...bytes]);
    const second = await repo.storeMediaFile('apkg:Other', 'copy.jpg', bytes, mediaRoot);
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.fileHash).toBe(first.value.fileHash);
    const rows = repo
      .getRawDb()
      .query<{ n: number }, []>('SELECT COUNT(*) as n FROM dictionary_media')
      .all();
    expect(rows[0]?.n).toBe(1);
  });

  it('空文件/超大/未知类型/坏哈希/不存在友好拒绝', async () => {
    expect(isOk(await repo.storeMediaFile('s', 'e.mp3', new Uint8Array(0), mediaRoot))).toBe(false);
    expect(
      isOk(await repo.storeMediaFile('s', 'e.xyz', new Uint8Array([1, 2, 3]), mediaRoot))
    ).toBe(false);
    const badHash = await repo.readMediaFile('not-a-hash');
    expect(isOk(badHash)).toBe(false);
    const missing = await repo.readMediaFile('0'.repeat(64));
    expect(isOk(missing)).toBe(false);
    if (!isOk(missing)) expect(missing.error.code).toBe('E_NOT_FOUND');
  });
});
