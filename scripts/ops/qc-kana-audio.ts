/**
 * 假名音频质检（运维脚本）：解析每个 wav 的 PCM，输出能量/削波/静音/时长，
 * 定位“明显不对”的条目。用法：bun scripts/ops/qc-kana-audio.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/audio/kana');

interface Stats {
  file: string;
  seconds: number;
  peak: number;
  clippedPct: number;
  rmsDb: number;
  leadSilenceMs: number;
  trailSilenceMs: number;
  format: string;
}

function parseWav(bytes: Buffer): { samples: Int16Array; sampleRate: number } | null {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  // 找 data chunk（跳过 fact/LIST 等）
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
  if (dataStart < 0 || bits !== 16) return null;
  const count = Math.floor(dataLen / 2 / Math.max(1, channels));
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    // 多声道取首声道
    samples[i] = bytes.readInt16LE(dataStart + i * 2 * channels);
  }
  return { samples, sampleRate };
}

function statsFor(file: string, samples: Int16Array, sampleRate: number): Stats {
  const n = samples.length;
  let peak = 0;
  let clipped = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(samples[i]!) / 32768;
    if (v > peak) peak = v;
    if (v >= 0.99) clipped++;
    sumSq += v * v;
  }
  const rmsDb = 10 * Math.log10(sumSq / Math.max(1, n) + 1e-12);
  const silenceAt = (i: number) => Math.abs(samples[i]!) / 32768 < 0.0032; // ≈ -50dB
  let lead = 0;
  while (lead < n && silenceAt(lead)) lead++;
  let trail = 0;
  while (trail < n - lead && silenceAt(n - 1 - trail)) trail++;
  const ms = (c: number) => Math.round((c / sampleRate) * 1000);
  return {
    file,
    seconds: Math.round((n / sampleRate) * 100) / 100,
    peak: Math.round(peak * 1000) / 1000,
    clippedPct: Math.round((clipped / Math.max(1, n)) * 10000) / 100,
    rmsDb: Math.round(rmsDb * 10) / 10,
    leadSilenceMs: ms(lead),
    trailSilenceMs: ms(trail),
    format: `${sampleRate}Hz`,
  };
}

const files = (await readdir(AUDIO_DIR)).filter((f) => f.endsWith('.wav')).sort();
const rows: Stats[] = [];
for (const f of files) {
  const bytes = await readFile(join(AUDIO_DIR, f));
  const parsed = parseWav(bytes);
  if (!parsed) {
    console.log(`${f}: 非 PCM16 wav，跳过`);
    continue;
  }
  rows.push(statsFor(f, parsed.samples, parsed.sampleRate));
}

console.log('file peak clip% rmsDb leadMs trailMs dur');
for (const r of rows) {
  const flags: string[] = [];
  if (r.clippedPct > 0.1) flags.push('CLIP');
  if (r.rmsDb < -35) flags.push('QUIET');
  if (r.seconds < 0.3 || r.seconds > 3) flags.push('DUR');
  if (r.trailSilenceMs > 800) flags.push('TRAIL');
  if (r.leadSilenceMs > 800) flags.push('LEAD');
  console.log(
    `${r.file} ${r.peak} ${r.clippedPct}% ${r.rmsDb}dB ${r.leadSilenceMs}ms ${r.trailSilenceMs}ms ${r.seconds}s ${flags.join(',')}`,
  );
}
