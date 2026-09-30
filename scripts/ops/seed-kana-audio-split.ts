/**
 * 五十音整段合成一切分（运维脚本，不进安装包）。
 *
 * 用法：
 *   bun scripts/ops/seed-kana-audio-split.ts --key <GEMINI_API_KEY> [--voice aoede] [--model gemini-3.8-flash-lite-tts]
 *
 * 流程：104 音用 、 连接成一段（`あ、い、う、…、を。`）一次合成
 * → 按静音（-50dB、≥180ms）切成 104 段 →[] 与种子顺序一一对应落盘
 * → 重生成 `apps/web/src/lib/kana-audio-manifest.ts`。
 * 段数对不上就直接报错退出，不静默错位（错一位全错）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_SEEDS } from '../../packages/storage-sqlite/src/seeds/kana-seed.js';
// eslint-disable-next-line import/no-unresolved
import { geminiProvider } from '../../apps/gateway/node_modules/gemini-tts-studio/lib/server/app.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIO_DIR = join(REPO_ROOT, 'apps/web/public/audio/kana');
const MANIFEST_TS = join(REPO_ROOT, 'apps/web/src/lib/kana-audio-manifest.ts');
const FULL_WAV = join(REPO_ROOT, '.studio-internal/kana-full.wav');
const DEFAULT_MIN_SILENCE_MS = 180;
const SILENCE = 0.0032; // ≈ -50dB

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1] ?? fallback;
  return fallback;
}

function splitSegments(
  samples: Int16Array,
  sampleRate: number,
  minSilenceMs: number,
): Array<[number, number]> {
  const n = samples.length;
  const minGap = Math.floor((sampleRate * minSilenceMs) / 1000);
  const segments: Array<[number, number]> = [];
  let i = 0;
  while (i < n) {
    while (i < n && Math.abs(samples[i]!) / 32768 < SILENCE) i++;
    if (i >= n) break;
    const start = i;
    while (i < n) {
      if (Math.abs(samples[i]!) / 32768 < SILENCE) {
        let j = i;
        while (j < n && Math.abs(samples[j]!) / 32768 < SILENCE) j++;
        if (j - i >= minGap) break;
        i = j;
      } else {
        i++;
      }
    }
    segments.push([start, Math.min(i, n)]);
  }
  return segments;
}

async function main(): Promise<void> {
  const apiKey = arg('key') || process.env['GEMINI_API_KEY'] || '';
  if (!apiKey) {
    console.error('缺少 Gemini Key：传 --key <key> 或设置 GEMINI_API_KEY。');
    process.exit(1);
  }
  const voice = arg('voice', 'aoede');
  const model = arg('model', 'gemini-3.8-flash-lite-tts');
  // 顿号停顿偏短（约 100ms 级），阈值可调；--reuse-full 直接复用已合成的整段，不花钱。
  const minSilenceMs = Number(arg('min-silence-ms', String(DEFAULT_MIN_SILENCE_MS))) || DEFAULT_MIN_SILENCE_MS;
  const reuseFull = process.argv.includes('--reuse-full');

  const items = KANA_SEEDS.filter((k) => k.audioText.trim());
  const sepArg = arg('sep', '、');
  const sep = sepArg === 'NL' ? '\n' : sepArg;
  const text = items.map((k) => k.audioText.trim()).join(sep) + '。';

  let audioBytes: Buffer;
  if (reuseFull) {
    const { readFileSync, existsSync } = await import('node:fs');
    if (!existsSync(FULL_WAV)) throw new Error(`找不到 ${FULL_WAV}，先正常跑一次合成。`);
    audioBytes = readFileSync(FULL_WAV);
    console.log(`复用整段 ${FULL_WAV}（${audioBytes.length}B），minSilence=${minSilenceMs}ms。`);
  } else {
    console.log(`整段文本 ${text.length} 字，${items.length} 音，一次合成…`);
    const out = (await geminiProvider.synthesize(
      { text, voiceName: voice, model, languageCode: 'ja' },
      apiKey,
    )) as { audioBuffer: Buffer; mimeType: string };
    await mkdir(dirname(FULL_WAV), { recursive: true });
    await writeFile(FULL_WAV, out.audioBuffer);
    console.log(`整段已存 ${FULL_WAV}（${out.audioBuffer.length}B）。`);
    audioBytes = out.audioBuffer;
  }

  // 解析 PCM（单声道 16bit，跳过非 data chunk）
  const bytes = audioBytes;
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      sampleRate = bytes.readUInt32LE(offset + 12);
      channels = bytes.readUInt16LE(offset + 10);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size;
  }
  if (dataStart < 0 || channels < 1) throw new Error('整段音频不是可用 WAV。');
  const count = Math.floor(dataLen / 2 / channels);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = bytes.readInt16LE(dataStart + i * 2 * channels);

  const segments = splitSegments(samples, sampleRate, minSilenceMs);
  console.log(`切出 ${segments.length} 段，期望 ${items.length} 段。`);
  if (segments.length !== items.length) {
    segments.forEach(([s, e], i) => console.log(`  段${i}: ${((e - s) / sampleRate).toFixed(2)}s`));
    throw new Error(`段数不符（${segments.length} vs ${items.length}），停止，不落盘。请检查整段录音。`);
  }

  await mkdir(AUDIO_DIR, { recursive: true });
  const manifest: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i]!;
    const k = items[i]!;
    const dur = (e - s) / sampleRate;
    if (dur < 0.12 || dur > 3) throw new Error(`段${i}（${k.id}）时长异常 ${dur.toFixed(2)}s，停止。`);
    const pcm = Buffer.alloc((e - s) * 2);
    for (let j = s; j < e; j++) pcm.writeInt16LE(samples[j]!, (j - s) * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const file = `${k.id}.wav`;
    await writeFile(join(AUDIO_DIR, file), Buffer.concat([header, pcm]));
    manifest[k.id] = file;
  }
  const manifestTs = `/**\n * 假名内置音频清单（整段合成一切分，随包发布但音频本身 gitignore）。\n * voice=${voice} model=${model} text=顿号连接整段。\n */\nexport const KANA_AUDIO_MANIFEST: Record<string, string> = ${JSON.stringify(manifest, null, 2)};\n`;
  await writeFile(MANIFEST_TS, manifestTs);
  console.log(`落盘 ${Object.keys(manifest).length} 个，清单已写。后续跑 normalize --write 统一响度。`);
}

await main();
