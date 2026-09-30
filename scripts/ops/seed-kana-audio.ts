/**
 * 五十音内置音频建库（运维脚本，不进安装包）。
 *
 * 铁律：微文本资产只走单条合成，绝不走批量（批量在单字场景废品率 ~40%，返工更贵）。
 * 用法：
 *   # Gemini 单条
 *   bun scripts/ops/seed-kana-audio.ts --key <GEMINI_KEY> [--voice aoede] [--model gemini-3.8-flash-lite-tts] [--text-suffix 。] [--pace-ms 4000]
 *   # Azure 单条（F0 每月 50 万字符免费，日语女声默认 Nanami）
 *   bun scripts/ops/seed-kana-audio.ts --provider azure --azure-key <AZURE_KEY> --region japaneast [--voice ja-JP-NanamiNeural]
 *
 * 流程：逐条合成 → 立即落盘 `apps/web/public/audio/kana/*.wav`（gitignore）
 * → 重生成 `apps/web/src/lib/kana-audio-manifest.ts`。断点续跑（进度文件按
 * provider/voice/model/suffix 隔离）。合成文本默认加 。（陈述语调更稳）。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_SEEDS } from '../../packages/storage-sqlite/src/seeds/kana-seed.js';
// 直调包内 provider：脚本位于仓库 scripts/ops，经网关的 node_modules 解析，
// 不走正在运行的网关进程（其内存里可能是旧版包）。
// eslint-disable-next-line import/no-unresolved
import {
  geminiProvider,
  azureProvider,
} from '../../apps/gateway/node_modules/gemini-tts-studio/lib/server/app.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIO_DIR = join(REPO_ROOT, 'apps/web/public/audio/kana');
const MANIFEST_TS = join(REPO_ROOT, 'apps/web/src/lib/kana-audio-manifest.ts');
const PROGRESS_FILE = join(REPO_ROOT, '.studio-internal/kana-seed-progress.json');

interface SeedProgress {
  provider: string;
  voice: string;
  model: string;
  suffix: string;
  done: string[];
}

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1] ?? fallback;
  return fallback;
}

async function loadProgress(identity: Omit<SeedProgress, 'done'>): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await readFile(PROGRESS_FILE, 'utf8')) as SeedProgress;
    if (
      raw.provider === identity.provider &&
      raw.voice === identity.voice &&
      raw.model === identity.model &&
      (raw.suffix ?? '') === identity.suffix
    ) {
      return new Set(raw.done);
    }
  } catch { /* 无进度，从头开始 */ }
  return new Set();
}

async function saveProgress(identity: Omit<SeedProgress, 'done'>, done: Set<string>): Promise<void> {
  await mkdir(dirname(PROGRESS_FILE), { recursive: true });
  await writeFile(PROGRESS_FILE, JSON.stringify({ ...identity, done: [...done] }));
}

function retryDelayMs(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  // 官方 retry 信息两种写法都吃，单位毫秒/秒自适应，上限 5 分钟兜底。
  let seconds = 30;
  const inRetry = message.match(/retry in ([\d.]+)\s*s/i);
  const inDelay =
    message.match(/retryDelay["']?\s*:\s*["']?([\d.]+)\s*(ms|s)?/i) ??
    message.match(/retryDelaySeconds["']?\s*:\s*["']?([\d.]+)/i);
  if (inRetry?.[1]) {
    seconds = Number(inRetry[1]);
  } else if (inDelay?.[1]) {
    const unit = inDelay[2]?.toLowerCase() === 'ms' ? 'ms' : 's';
    seconds = unit === 'ms' ? Number(inDelay[1]) / 1000 : Number(inDelay[1]);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 30;
  return Math.min(seconds, 300) * 1000 + 2000;
}

async function writeResults(
  collected: Map<string, { audioBase64: string; mimeType: string }>,
  label: string,
): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const manifest: Record<string, string> = {};
  let missing = 0;
  for (const k of KANA_SEEDS) {
    const hit = collected.get(k.id);
    if (!hit) {
      console.error(`缺音频：${k.id}（${k.audioText}）`);
      missing++;
      continue;
    }
    const file = `${k.id}.wav`;
    await writeFile(join(AUDIO_DIR, file), Buffer.from(hit.audioBase64, 'base64'));
    manifest[k.id] = file;
  }
  const manifestTs = `/**\n * 假名内置音频清单（单条 TTS 预生成，随包发布但音频本身 gitignore）。\n * ${label}\n */\nexport const KANA_AUDIO_MANIFEST: Record<string, string> = ${JSON.stringify(manifest, null, 2)};\n`;
  await writeFile(MANIFEST_TS, manifestTs);
  console.log(`落盘 ${Object.keys(manifest).length} 个音频，缺 ${missing} 个。清单已写 ${MANIFEST_TS}。`);
  if (missing > 0) process.exit(2);
}

interface SynthConfig {
  provider: 'gemini' | 'azure';
  apiKey: string;
  voice: string;
  model: string;
  region: string;
  paceMs: number;
  textSuffix: string;
}

async function verifyVoice(cfg: SynthConfig): Promise<void> {
  const voices =
    cfg.provider === 'azure'
      ? ((await azureProvider.listVoices(cfg.apiKey, cfg.region)) as Array<{ id?: string; name?: string }>)
      : ((await geminiProvider.listVoices(cfg.apiKey)) as Array<{ id?: string; name?: string }>);
  const ids = voices.map((v) => v.id || v.name).filter(Boolean) as string[];
  if (!ids.some((id) => id.toLowerCase() === cfg.voice.toLowerCase())) {
    throw new Error(`音色 ${cfg.voice} 不在远端列表（共 ${ids.length} 个）：${ids.slice(0, 12).join(', ')}…`);
  }
  console.log(`Key 有效，远端 ${ids.length} 个音色，${cfg.voice} 存在。`);
}

async function synthesizeOne(cfg: SynthConfig, text: string): Promise<{ audioBuffer: Buffer; mimeType: string }> {
  if (cfg.provider === 'azure') {
    return (await azureProvider.synthesize(
      { text, voiceName: cfg.voice, region: cfg.region },
      cfg.apiKey,
    )) as { audioBuffer: Buffer; mimeType: string };
  }
  return (await geminiProvider.synthesize(
    { text, voiceName: cfg.voice, model: cfg.model, languageCode: 'ja' },
    cfg.apiKey,
  )) as { audioBuffer: Buffer; mimeType: string };
}

async function main(): Promise<void> {
  const provider = arg('provider', 'gemini').toLowerCase() === 'azure' ? 'azure' : 'gemini';
  const voice =
    arg('voice') || (provider === 'azure' ? 'ja-JP-NanamiNeural' : 'aoede');
  const model = arg('model', provider === 'azure' ? 'azure' : 'gemini-3.8-flash-lite-tts');
  const region = arg('region') || process.env['AZURE_SPEECH_REGION'] || '';
  const apiKey =
    provider === 'azure'
      ? arg('azure-key') || process.env['AZURE_SPEECH_KEY'] || ''
      : arg('key') || process.env['GEMINI_API_KEY'] || '';
  if (!apiKey) {
    console.error(
      provider === 'azure'
        ? '缺少 Azure Key：传 --azure-key <key> 或设置 AZURE_SPEECH_KEY。'
        : '缺少 Gemini Key：传 --key <key> 或设置 GEMINI_API_KEY。',
    );
    process.exit(1);
  }
  if (provider === 'azure' && !region) {
    console.error('Azure 缺少 region：传 --region <japaneast等> 或设置 AZURE_SPEECH_REGION（必须与 Key 同区）。');
    process.exit(1);
  }
  const paceMs = Number(arg('pace-ms', provider === 'azure' ? '1500' : '4000')) || 4000;
  const textSuffix = arg('text-suffix', '。');

  const cfg: SynthConfig = { provider, apiKey, voice, model, region, paceMs, textSuffix };
  const identity = { provider, voice, model, suffix: textSuffix };
  await verifyVoice(cfg);

  const items = KANA_SEEDS.filter((k) => k.audioText.trim());
  const done = await loadProgress(identity);
  const collected = new Map<string, { audioBase64: string; mimeType: string }>();
  let index = 0;
  for (const k of items) {
    index++;
    const file = join(AUDIO_DIR, `${k.id}.wav`);
    if (done.has(k.id) && existsSync(file)) {
      const bytes = await readFile(file);
      collected.set(k.id, { audioBase64: bytes.toString('base64'), mimeType: 'audio/wav' });
      continue;
    }
    let audio: { audioBuffer: Buffer; mimeType: string } | null = null;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        audio = await synthesizeOne(cfg, `${k.audioText.trim()}${textSuffix}`);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/429|RESOURCE_EXHAUSTED|quota|throttl/i.test(message) && attempt < 8) {
          const wait = retryDelayMs(error);
          console.log(`  ${k.id} 触发限流，${Math.round(wait / 1000)}s 后重试（${attempt}/8）…`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw error;
      }
    }
    if (!audio) throw new Error(`${k.id} 重试 8 次仍失败，中断；已落盘的可直接重跑续做。`);
    await writeFile(file, audio.audioBuffer);
    done.add(k.id);
    await saveProgress(identity, done);
    collected.set(k.id, { audioBase64: audio.audioBuffer.toString('base64'), mimeType: audio.mimeType });
    console.log(`单条合成 ${index}/${items.length}（已落盘 ${done.size}）`);
    await new Promise((r) => setTimeout(r, paceMs));
  }
  await writeResults(collected, `provider=${provider} voice=${voice} model=${model} suffix=${JSON.stringify(textSuffix)}`);
}

await main();
