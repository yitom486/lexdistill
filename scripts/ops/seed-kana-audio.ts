/**
 * 五十音内置音频批量建库（运维脚本，不进安装包）。
 *
 * 用法：
 *   # 首次建单（需要 Gemini Key：--key 或 GEMINI_API_KEY 环境变量）
 *   bun scripts/ops/seed-kana-audio.ts --key <GEMINI_API_KEY> [--voice Kore] [--model gemini-3.8-flash-tts]
 *   # 任务未完成时稍后继续轮询（读上次 job 名）
 *   bun scripts/ops/seed-kana-audio.ts --resume
 *
 * 流程：读 KANA_SEEDS（104 音）→ 拆成 ≤100/批 → 经本机网关建批量任务
 * → 轮询到 SUCCEEDED → 落盘 `apps/web/public/audio/kana/*.wav`
 * → 重生成 `apps/web/src/lib/kana-audio-manifest.ts`。
 * 建单不带 speechMetadata：批量通道原文逐字合成，不会有朗读前奏。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_SEEDS } from '../../packages/storage-sqlite/src/seeds/kana-seed.js';

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

async function main(): Promise<void> {
  const resume = process.argv.includes('--resume');
  const apiKey = arg('key') || process.env['GEMINI_API_KEY'] || '';
  if (!apiKey) {
    console.error('缺少 Gemini Key：传 --key <key> 或设置 GEMINI_API_KEY。');
    process.exit(1);
  }
  const gateway = arg('gateway', 'http://127.0.0.1:8080');
  const voice = arg('voice', 'Kore');
  const model = arg('model', 'gemini-3.8-flash-tts');
  const timeoutMin = Number(arg('timeout-min', '120')) || 120;

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
    for (let b = 0; b < chunks.length; b++) {
      const res = await fetch(`${gateway}/api/tts-studio/tts/batch-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': apiKey },
        body: JSON.stringify({
          provider: 'gemini',
          model,
          voiceName: voice,
          languageCode: 'ja',
          displayName: `kana-seed-${voice}-${b + 1}of${chunks.length}`,
          items: chunks[b],
        }),
      });
      if (!res.ok) throw new Error(`建单失败 batch ${b + 1}: ${res.status} ${await res.text()}`);
      const job = (await res.json()) as { name: string; state: string };
      if (!job.name) throw new Error(`建单无 name：${JSON.stringify(job)}`);
      console.log(`batch ${b + 1}: ${job.name}（${job.state}）`);
      jobs.push({ name: job.name, keys: (chunks[b] ?? []).map((c) => c.key), voice, model });
    }
    state = { voice, model, createdAt: new Date().toISOString(), jobs };
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
      const res = await fetch(
        `${gateway}/api/tts-studio/tts/batch-jobs?name=${encodeURIComponent(job.name)}&provider=gemini`,
        { headers: { 'x-gemini-api-key': apiKey } },
      );
      if (!res.ok) throw new Error(`查询失败 ${job.name}: ${res.status} ${await res.text()}`);
      const detail = (await res.json()) as {
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

  // 全部完成：落盘 + 重生成清单。
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
  const manifestTs = `/**\n * 假名内置音频清单（批量 TTS 预生成，随安装包发布）。\n *\n * 由 \`scripts/ops/seed-kana-audio.ts\` 生成并提交；key 为假名种子 id\n *（如 \`kana_a\`），value 为 \`public/audio/kana/\` 下的文件名。\n * 平假名/片假名同音，共用同一文件。 voice=${state.voice} model=${state.model}。\n */\nexport const KANA_AUDIO_MANIFEST: Record<string, string> = ${JSON.stringify(manifest, null, 2)};\n`;
  await writeFile(MANIFEST_TS, manifestTs);
  console.log(`落盘 ${Object.keys(manifest).length} 个音频，缺 ${missing} 个。清单已写 ${MANIFEST_TS}。`);
  if (missing > 0) process.exit(2);
}

await main();
