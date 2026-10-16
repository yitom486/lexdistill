import { describe, expect, it } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { extractTarGz } from '@lexdistill/archive';

/** 最小 tar 包（含一个 fake.pdb + 一个 keep.dll），再 gzip。 */
function makeTarGz(): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number): Uint8Array => {
    const h = Buffer.alloc(512, 0);
    h.write(name, 0, 'latin1');
    h.write(size.toString(8).padStart(11, '0') + ' ', 124, 'latin1');
    h[156] = 48; // typeflag '0'
    return new Uint8Array(h);
  };
  const blob = (name: string, data: string): void => {
    const body = Buffer.from(data, 'utf8');
    blocks.push(header(name, body.length));
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512, 0);
    body.copy(padded);
    blocks.push(new Uint8Array(padded));
  };
  blob('pkg/keep.dll', 'dll-bytes');
  blob('pkg/debug.pdb', 'pdb-bytes-should-be-skipped');
  blocks.push(new Uint8Array(1024)); // 两个零块结束
  const tar = Buffer.concat(blocks.map((b) => Buffer.from(b)));
  return new Uint8Array(gzipSync(tar));
}

describe('archive skipEntry denylist', () => {
  it('默认全解；*.pdb 可跳过（ORT 403MB pdb 回归）', () => {
    const tgz = makeTarGz();
    const all = extractTarGz(tgz);
    expect(all.map((e) => e.path).sort()).toEqual(['pkg/debug.pdb', 'pkg/keep.dll']);
    const kept = extractTarGz(tgz, { skipEntry: (p) => /\.pdb$/i.test(p) });
    expect(kept.map((e) => e.path)).toEqual(['pkg/keep.dll']);
    expect(new TextDecoder().decode(kept[0]?.data)).toBe('dll-bytes');
  });
});
