/**
 * 假名音频响度归一（运维脚本，离线无 API 成本，可反复跑）。
 * 用法：bun scripts/ops/normalize-kana-audio.ts [--write]
 * 默认只打印；--write 才回写 wav。
 *
 * 做法：首尾静音裁到 80ms，峰值归一到 -1dBFS，单文件增益上限 +20dB
 *（超限的只给到上限并标出，需重生成而非硬拉）。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/audio/kana');
const TARGET_PEAK = 0.89;
const MAX_GAIN = 10; // +20dB
const SILENCE = 0.0032; // ≈ -50dB
const KEEP_MS = 80;

function parseWav(bytes: Buffer): { samples: Int16Array; sampleRate: number; dataStart: number; dataLen: number } | null {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 0;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      sampleRate = bytes.readUInt32LE(offset + 12);
      channels = bytes.readUInt16LE(offset + 10);
      bits = bytes.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size;
  }
  if (dataStart < 0 || bits !== 16 || channels < 1) return null;
  const count = Math.floor(dataLen / 2 / channels);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = bytes.readInt16LE(dataStart + i * 2 * channels);
  return { samples, sampleRate, dataStart, dataLen };
}

const write = process.argv.includes('--write');
const files = (await readdir(AUDIO_DIR)).filter((f) => f.endsWith('.wav')).sort();
for (const f of files) {
  const path = join(AUDIO_DIR, f);
  const bytes = await readFile(path);
  const parsed = parseWav(bytes);
  if (!parsed) {
    console.log(`${f}: 非 PCM16，跳过`);
    continue;
  }
  const { samples, sampleRate } = parsed;
  const n = samples.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]!) / 32768);
  if (peak <= 0) {
    console.log(`${f}: 全静音，跳过`);
    continue;
  }
  let lead = 0;
  while (lead < n && Math.abs(samples[lead]!) / 32768 < SILENCE) lead++;
  let trail = 0;
  while (trail < n - lead && Math.abs(samples[n - 1 - trail]!) / 32768 < SILENCE) trail++;
  const keep = Math.floor((sampleRate * KEEP_MS) / 1000);
  const start = Math.max(0, lead - keep);
  const end = Math.min(n, n - trail + keep);
  const gain = Math.min(TARGET_PEAK / peak, MAX_GAIN);
  const capped = TARGET_PEAK / peak > MAX_GAIN ? ' GAIN-CAPPED需重生' : '';
  console.log(`${f}: peak ${peak.toFixed(3)}→${(Math.min(peak * gain, 1)).toFixed(3)} gain x${gain.toFixed(1)} 裁 ${(lead / sampleRate * 1000).toFixed(0)}/${(trail / sampleRate * 1000).toFixed(0)}ms${capped}`);
  if (!write) continue;
  const out = Buffer.from(bytes);
  for (let i = start; i < end; i++) {
    const v = Math.max(-1, Math.min(1, (samples[i]! / 32768) * gain));
    out.writeInt16LE(Math.round(v * 32767), parsed.dataStart + i * 2);
  }
  // 重写 data 长度（裁剪后）与 RIFF 总长
  const newDataLen = (end - start) * 2;
  out.writeUInt32LE(newDataLen, parsed.dataStart - 4);
  out.writeUInt32LE(36 + newDataLen, 4);
  await writeFile(path, out.subarray(0, parsed.dataStart + newDataLen));
}
console.log(write ? '已回写。' : '试运行（加 --write 回写）。');
