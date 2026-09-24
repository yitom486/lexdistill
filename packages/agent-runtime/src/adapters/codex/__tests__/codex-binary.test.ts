import { describe, expect, it } from 'bun:test';
import { selectNewestCodexBinary } from '../codex-binary.js';

describe('Codex binary selection', () => {
  it('chooses the newest installed CLI instead of the first installation', () => {
    const versions = new Map([
      ['desktop', 'codex-cli 0.153.4'],
      ['extension', 'codex-cli 0.154.0-alpha.6.2'],
      ['zed', 'codex-cli 0.156.1'],
    ]);
    expect(selectNewestCodexBinary([...versions.keys()], (binary) => versions.get(binary) ?? null))
      .toBe('zed');
  });

  it('prefers a stable release over a prerelease of the same version', () => {
    const versions = new Map([
      ['preview', 'codex-cli 0.156.1-alpha.10'],
      ['stable', 'codex-cli 0.156.1'],
    ]);
    expect(selectNewestCodexBinary([...versions.keys()], (binary) => versions.get(binary) ?? null))
      .toBe('stable');
  });

  it('skips candidates that fail the version probe', () => {
    expect(selectNewestCodexBinary(['broken', 'working'], (binary) =>
      binary === 'working' ? 'codex-cli 0.156.1' : null
    )).toBe('working');
  });
});
