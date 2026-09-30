/**
 * 五十音内置音频批量建库（运维脚本，不进安装包）。
 *
 * 直调 gemini-tts-studio 包（相对路径导入，不依赖 live 网关，
 * 避免网关 node_modules 热更新问题）。用法：
 *   # 批量（优先；建单失败直接退出，不静默降级）
 *   bun scripts/ops/seed-kana-audio.ts --key <GEMINI_API_KEY> [--voice aoede] [--model gemini-3.8-flash-tts]
 *   # 用户确认后，显式改用单条（104 次实时合成，免费额度 3 次/分钟，约 40 分钟）
 *   bun scripts/ops/seed-kana-audio.ts --single --key <GEMINI_API_KEY>
 *   # 任务未完成时稍后继续轮询（读上次 job 名）
 *   bun scripts/ops/seed-kana-audio.ts --resume --key <GEMINI_API_KEY>
 *   # 强制逐条实时合成（104 次，慢但一定能跑）
 *   bun scripts/ops/seed-kana-audio.ts --key <KEY> --single
 *
 * 流程：读 KANA_SEEDS（104 音）→ 拆成 ≤100/批 → 建批量任务
 * → 轮询到 SUCCEEDED → 落盘 `apps/web/public/audio/kana/*.wav`
 * → 重生成 `apps/web/src/lib/kana-audio-manifest.ts`。
 * 建单不带 speechMetadata：批量通道原文逐字合成，不会有朗读前奏。
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
  validateBatchCreateInput,
} from '../../apps/gateway/node_modules/gemini-tts-studio/lib/server/app.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIO_DIR = join(REPO_ROOT, 'apps/web/public/audio/kana');
const MANIFEST_TS = join(REPO_ROOT, 'apps/web/src/lib/kana-audio-manifest.ts');
const STATE_FILE = join(REPO_ROOT, '.studio-internal/kana-batch-jobs.json');
const MAX_ITEMS_PER_JOB = 100;

interface JobState {
  name: string;
  keys: string[];
  voice: string;
  model: string;
}
interface SeedState {
  mode: 'batch' | 'single';
  voice: string;
  model: string;
  createdAt: string;
  jobs: JobState[];
}

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1] ?? fallback;
  return fallback;
}

async function writeResults(
  collected: Map<string, { audioBase64: string; mimeType: string }>,
  voice: string,
  model: string,
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
  const manifestTs = `/**\n * 假名内置音频清单（批量 TTS 预生成，随安装包发布）。\n *\n * 由 \`scripts/ops/seed-kana-audio.ts\` 生成并提交；key 为假名种子 id\n *（如 \`kana_a\`），value 为 \`public/audio/kana/\` 下的文件名。\n * 平假名/片假名同音，共用同一文件。 voice=${voice} model=${model}。\n */\nexport const KANA_AUDIO_MANIFEST: Record<string, string> = ${JSON.stringify(manifest, null, 2)};\n`;
  await writeFile(MANIFEST_TS, manifestTs);
  console.log(`落盘 ${Object.keys(manifest).length} 个音频，缺 ${missing} 个。清单已写 ${MANIFEST_TS}。`);
  if (missing > 0) process.exit(2);
}

async function verifyKeyAndVoice(apiKey: string, voice: string): Promise<void> {
  const voices = (await geminiProvider.listVoices(apiKey)) as Array<{ id?: string; name?: string }>;
  const ids = voices.map((v) => v.id || v.name).filter(Boolean) as string[];
  if (!ids.some((id) => id.toLowerCase() === voice.toLowerCase())) {
    throw new Error(`音色 ${voice} 不在远端列表（共 ${ids.length} 个）：${ids.slice(0, 12).join(', ')}…`);
  }
  console.log(`Key 有效，远端 ${ids.length} 个音色，${voice} 存在。`);
}

const PROGRESS_FILE = join(REPO_ROOT, '.studio-internal/kana-seed-progress.json');

interface SeedProgress {
  voice: string;
  model: string;
  done: string[];
}

async function loadProgress(voice: string, model: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await readFile(PROGRESS_FILE, 'utf8')) as SeedProgress;
    if (raw.voice === voice && raw.model === model) return new Set(raw.done);
  } catch { /* 无进度，从头开始 */ }
  return new Set();
}

async function saveProgress(voice: string, model: string, done: Set<string>): Promise<void> {
  await mkdir(dirname(PROGRESS_FILE), { recursive: true });
  await writeFile(PROGRESS_FILE, JSON.stringify({ voice, model, done: [...done] }));
}

function retryDelayMs(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const m = message.match(/retry in ([\d.]+)s/i) || message.match(/retryDelay["']?\s*:\s*["']?(\d+)/i);
  const seconds = m?.[1] ? Number(m[1]) : 30;
  return (Number.isFinite(seconds) ? seconds : 30) * 1000 + 2000;
}

async function runSingle(
  apiKey: string,
  voice: string,
  model: string,
): Promise<Map<string, { audioBase64: string; mimeType: string }>> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const collected = new Map<string, { audioBase64: string; mimeType: string }>();
  const done = await loadProgress(voice, model);
  // 免费配额 3 次/分钟：主动 pacing 22 秒/条，429 按官方 retryDelay 睡眠重试。
  // 每条成功立即落盘 + 写进度，任何中断都可直接重跑续做。
  const items = KANA_SEEDS.filter((k) => k.audioText.trim());
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
        audio = (await geminiProvider.synthesize(
          { text: k.audioText.trim(), voiceName: voice, model, languageCode: 'ja' },
          apiKey,
        )) as { audioBuffer: Buffer; mimeType: string };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(message) && attempt < 8) {
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
    await saveProgress(voice, model, done);
    collected.set(k.id, { audioBase64: audio.audioBuffer.toString('base64'), mimeType: audio.mimeType });
    console.log(`单条合成 ${index}/${items.length}（已落盘 ${done.size}）`);
    await new Promise((r) => setTimeout(r, 22000));
  }
  return collected;
}

async function main(): Promise<void> {
  const resume = process.argv.includes('--resume');
  const forceSingle = process.argv.includes('--single');
  const apiKey = arg('key') || process.env['GEMINI_API_KEY'] || '';
  if (!apiKey) {
    console.error('缺少 Gemini Key：传 --key <key> 或设置 GEMINI_API_KEY。');
    process.exit(1);
  }
  const voice = arg('voice', 'aoede');
  const model = arg('model', 'gemini-3.8-flash-tts');
  const timeoutMin = Number(arg('timeout-min', '120')) || 120;

  await verifyKeyAndVoice(apiKey, voice);

  if (forceSingle) {
    console.log('强制单条模式：104 次实时合成。');
    await writeResults(await runSingle(apiKey, voice, model), voice, model);
    return;
  }

  let state: SeedState;
  if (resume) {
    if (!existsSync(STATE_FILE)) {
      console.error(`找不到状态文件 ${STATE_FILE}，先正常建单。`);
      process.exit(1);
    }
    state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as SeedState;
    console.log(`继续轮询 ${state.jobs.length} 个任务（voice=${state.voice} model=${state.model}）。`);
  } else {
    const items = KANA_SEEDS.filter((k) => k.audioText.trim()).map((k) => ({
      key: k.id,
      text: k.audioText.trim(),
    }));
    if (items.length === 0) throw new Error('KANA_SEEDS 为空，无法建单。');
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += MAX_ITEMS_PER_JOB) chunks.push(items.slice(i, i + MAX_ITEMS_PER_JOB));
    console.log(`共 ${items.length} 音，拆成 ${chunks.length} 批（voice=${voice} model=${model}）。`);
    const jobs: JobState[] = [];
    try {
      for (let b = 0; b < chunks.length; b++) {
        const input = validateBatchCreateInput({
          model,
          voiceName: voice,
          languageCode: 'ja',
          displayName: `kana-seed-${voice}-${b + 1}of${chunks.length}`,
          items: chunks[b],
        });
        const job = (await geminiProvider.createBatchJob(apiKey, input)) as { name: string; state: string };
        if (!job.name) throw new Error(`建单无 name：${JSON.stringify(job)}`);
        console.log(`batch ${b + 1}: ${job.name}（${job.state}）`);
        jobs.push({ name: job.name, keys: (chunks[b] ?? []).map((c) => c.key), voice, model });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 不静默降级：批量建单失败就直接退出，由用户显式决定是否走单条。
      // 单条=104 次实时合成、免费额度 3 次/分钟、约 40 分钟，用户确认后再开：
      //   bun scripts/ops/seed-kana-audio.ts --single --key <KEY>
      console.error(`批量建单失败，不自动降级：${message}`);
      console.error('如需改用单条合成（慢、免费额度内），请显式加 --single 重跑。');
      process.exit(3);
    }
    state = { mode: 'batch', voice, model, createdAt: new Date().toISOString(), jobs };
    await mkdir(dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`任务状态已存 ${STATE_FILE}。`);
  }

  // 轮询：官方异步任务小时级；超时退出后可用 --resume 继续。
  const deadline = Date.now() + timeoutMin * 60_000;
  const pending = new Set(state.jobs.map((j) => j.name));
  const collected = new Map<string, { audioBase64: string; mimeType: string }>();
  while (pending.size > 0) {
    for (const job of state.jobs) {
      if (!pending.has(job.name)) continue;
      const detail = (await geminiProvider.getBatchJob(apiKey, job.name)) as {
        state: string;
        results?: Array<{ key: string; ok: boolean; audioBase64?: string; mimeType?: string; error?: string }>;
      };
      console.log(`${job.name}: ${detail.state}`);
      if (/FAILED|CANCELLED|EXPIRED/.test(detail.state)) throw new Error(`任务失败 ${job.name}: ${detail.state}`);
      if (detail.state === 'JOB_STATE_SUCCEEDED') {
        for (const r of detail.results ?? []) {
          if (r.ok && r.audioBase64) collected.set(r.key, { audioBase64: r.audioBase64, mimeType: r.mimeType ?? 'audio/wav' });
          else console.error(`  ${r.key} 失败：${r.error ?? '未知'}`);
        }
        pending.delete(job.name);
      }
    }
    if (pending.size > 0) {
      if (Date.now() > deadline) {
        console.log(`超时（${timeoutMin}min），剩余 ${pending.size} 个任务稍后用 --resume 继续轮询。`);
        break;
      }
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
  if (pending.size > 0) return;
  await writeResults(collected, state.voice, state.model);
}

await main();
