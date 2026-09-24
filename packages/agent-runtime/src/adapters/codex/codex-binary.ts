import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

interface CodexVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseCodexVersion(output: string): CodexVersion | null {
  const match = /\bcodex-cli\s+v?(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?\b/.exec(output);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0) return right.length === 0 ? 0 : 1;
  if (right.length === 0) return -1;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else {
      const difference = a < b ? -1 : a > b ? 1 : 0;
      if (difference !== 0) return difference;
    }
  }
  return 0;
}

function compareVersions(left: CodexVersion, right: CodexVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
    || comparePrerelease(left.prerelease, right.prerelease);
}

/** A version probe is bounded so one broken editor install cannot stall Gateway startup. */
function readInstalledVersion(binary: string): string | null {
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 2_000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

/** Keep the first candidate on equal versions, preferring the standalone install. */
export function selectNewestCodexBinary(
  candidates: readonly string[],
  probeVersion: (binary: string) => string | null
): string | undefined {
  let newest: { binary: string; version: CodexVersion } | undefined;
  for (const binary of candidates) {
    const output = probeVersion(binary);
    const version = output ? parseCodexVersion(output) : null;
    if (version && (!newest || compareVersions(version, newest.version) > 0)) {
      newest = { binary, version };
    }
  }
  return newest?.binary;
}

function listDirectory(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Known Windows install locations are searched once when a Gateway process starts. */
export function findInstalledCodexBinaries(home?: string, localAppData?: string): string[] {
  if (process.platform !== 'win32') return [];
  const binaries: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    const key = candidate.toLowerCase();
    if (!seen.has(key) && existsSync(candidate)) {
      seen.add(key);
      binaries.push(candidate);
    }
  };

  if (localAppData) {
    add(path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  }

  if (home) {
    const architecture = process.arch === 'arm64' ? 'windows-aarch64' : 'windows-x86_64';
    for (const editor of ['.vscode', '.cursor']) {
      const extensions = path.join(home, editor, 'extensions');
      for (const name of listDirectory(extensions)) {
        if (name.startsWith('openai.chatgpt-')) {
          add(path.join(extensions, name, 'bin', architecture, 'codex.exe'));
        }
      }
    }
  }

  if (localAppData) {
    const packages = path.join(localAppData, 'Zed', 'external_agents', 'registry', 'npx',
      'codex-acp', 'node_modules', '@openai');
    const platform = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const packageName = `codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
    add(path.join(packages, packageName, 'vendor', `${platform}-pc-windows-msvc`, 'bin', 'codex.exe'));
  }

  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const trimmed = directory.trim().replace(/^"|"$/g, '');
    if (trimmed) add(path.join(trimmed, 'codex.exe'));
  }
  return binaries;
}

let cachedDiscovery: { key: string; binary: string | undefined } | undefined;

export function resolveNewestInstalledCodexBinary(home?: string, localAppData?: string): string | undefined {
  const key = JSON.stringify([home, localAppData, process.env.PATH]);
  if (cachedDiscovery?.key === key) return cachedDiscovery.binary;
  const candidates = findInstalledCodexBinaries(home, localAppData);
  const binary = selectNewestCodexBinary(candidates, readInstalledVersion) ?? candidates[0];
  cachedDiscovery = { key, binary };
  return binary;
}
