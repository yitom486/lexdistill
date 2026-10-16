import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AZURE_DEFAULT_VOICES,
  azureTtsEndpoint,
  azureTtsHeaders,
  azureVoicesEndpoint,
  buildAzureSsml,
  buildOpenAiSpeechPayload,
  isHttpEndpoint,
  mapAzureVoiceList,
  normalizeTtsTrackLanguage,
  openAiSpeechHeaders,
} from '@lexdistill/speech';
import type { AzureVoiceOption, TtsTrackLanguage } from '@lexdistill/speech';

/**
 * C1 Speech 自检（所属包内断言，无反向边）。
 *
 * - 顶层出口透出 TTS 公共 API（值与类型编译期贯通；键集合与合并前一致）；
 * - speech/src 内无 Agent 相关引用（TTS 独立能力）；
 * - Gateway manifest 必须声明 speech（网关装配经统一入口）。
 */
function repoRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
}

describe('C1 speech 入口', () => {
  it('顶层出口透出 TTS 公共 API', () => {
    expect(typeof AZURE_DEFAULT_VOICES).toBe('object');
    expect(typeof AZURE_DEFAULT_VOICES.en.FEMALE).toBe('string');
    for (const fn of [
      azureTtsEndpoint,
      azureTtsHeaders,
      azureVoicesEndpoint,
      buildAzureSsml,
      buildOpenAiSpeechPayload,
      isHttpEndpoint,
      mapAzureVoiceList,
      normalizeTtsTrackLanguage,
      openAiSpeechHeaders,
    ] as const) {
      expect(typeof fn).toBe('function');
    }
    const voice: AzureVoiceOption | null = null;
    const lang: TtsTrackLanguage | null = null;
    expect(voice).toBeNull();
    expect(lang).toBeNull();
  });

  it('speech 内无 Agent 相关引用', async () => {
    const pattern = /agent-core|agent-codex|agent-responses|agent-runtime|@agentclientprotocol|@anthropic\//i;
    const srcDir = join(repoRoot(), 'packages', 'speech', 'src');
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(srcDir, { withFileTypes: true });
    const hits: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.endsWith('.ts')) continue;
      const text = await readFile(join(srcDir, entry.name), 'utf-8');
      if (pattern.test(text)) hits.push(entry.name);
    }
    expect(hits).toEqual([]);
  });

  it('Gateway manifest 声明 speech', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('malformed apps/gateway/package.json');
    }
    const deps = (raw as { dependencies?: unknown }).dependencies;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
      throw new Error('apps/gateway/package.json missing dependencies');
    }
    const table = deps as Record<string, unknown>;
    expect(table['@lexdistill/speech']).toBe('workspace:*');
  });

  it('apps/web 引用的 workspace 包必须现存（删包即断链；悬挂引用零容忍）', async () => {
    const { readdir } = await import('node:fs/promises');
    const pkgEntries = await readdir(join(repoRoot(), 'packages'), { withFileTypes: true });
    const live = new Set(pkgEntries.filter((e) => e.isDirectory()).map((e) => e.name));
    const roots = [join(repoRoot(), 'apps', 'web', 'src')];
    const bad: string[] = [];
    const collect = (text: string, full: string): void => {
      const patterns = [
        /from\s+['"]@lexdistill\/([^/'"]+)(?:\/[^'"]*)?['"]/g,
        /import\(\s*['"]@lexdistill\/([^/'"]+)(?:\/[^'"]*)?['"]/g,
      ];
      for (const pattern of patterns) {
        for (const m of text.matchAll(pattern)) {
          const pkg = m[1] as string;
          // apps 内应用互引（web → gateway）走 tsconfig paths，不在 packages 集合内，属既有状态，此处放行。
          if (pkg === 'gateway') continue;
          if (!live.has(pkg)) bad.push(`${full}: @lexdistill/${pkg}`);
        }
      }
    };
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const names = entries.map((e) => e.name).sort();
      for (const name of names) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        const entry = entries.find((e) => e.name === name);
        if (entry !== undefined && entry.isDirectory()) {
          await walk(full);
        } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          collect(await readFile(full, 'utf-8'), full);
        }
      }
    };
    for (const root of roots) {
      await walk(root);
    }
    expect(bad).toEqual([]);
  });
});
