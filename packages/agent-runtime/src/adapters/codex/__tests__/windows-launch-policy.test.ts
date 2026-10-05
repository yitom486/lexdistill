import { describe, expect, it } from 'bun:test';
import { backgroundCodexArgs } from '../windows-launch-policy.js';

describe('unattended Codex Windows launch', () => {
  it('overrides an elevated home configuration without changing workspace or approval policy', () => {
    const args = ['app-server', '--listen', 'stdio://', '-c', 'windows.sandbox="elevated"', '-c', 'sandbox_mode="workspace-write"'];
    expect(backgroundCodexArgs(args, 'win32')).toEqual([...args, '-c', 'windows.sandbox="unelevated"']);
    expect(args).toHaveLength(7);
  });
  it('preserves other platforms and custom test executors', () => {
    const args = ['app-server', '--listen', 'stdio://'];
    expect(backgroundCodexArgs(args, 'linux')).toEqual(args);
    expect(backgroundCodexArgs(['fixture.js'], 'win32')).toEqual(['fixture.js']);
  });
});
