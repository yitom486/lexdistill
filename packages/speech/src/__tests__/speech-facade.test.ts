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
} from '@study-studio/speech';
import type { AzureVoiceOption, TtsTrackLanguage } from '@study-studio/speech';

/**
 * M2-2 Speech 外观自检（所属包内断言，无反向边）。
 *
 * - 顶层出口透出 tts-core 当前所需 API（值与类型编译期贯通）；
 * - speech/src 内无 Agent 相关引用（TTS 独立能力）；
 * - Gateway manifest 必须声明 speech（网关装配经统一入口）。
 */
function repoRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
}

describe('M2-2 speech facade', () => {
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
    expect(table['@study-studio/speech']).toBe('workspace:*');
  });

  it('apps/web 只经 speech 消费 TTS（禁直引 tts-core）', async () => {
    const { readdir } = await import('node:fs/promises');
    const roots = [join(repoRoot(), 'apps', 'web', 'src')];
    const hits: string[] = [];
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
          const text = await readFile(full, 'utf-8');
          if (text.includes('@study-studio/tts-core')) hits.push(full);
        }
      }
    };
    for (const root of roots) {
      await walk(root);
    }
    expect(hits).toEqual([]);
  });
});
