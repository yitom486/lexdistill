import { describe, expect, it, afterEach } from 'bun:test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultRuntimeDir } from '../../../infrastructure/persistence/app-paths.js';
import { pinProcessToTestRuntime, testRuntimeDir } from './pdf-test-runtime.js';

/**
 * test-runtime safety：测试目录解析与生产路径隔离（纯 env 逻辑，不 bootstrap、不碰盘 runtime）。
 *
 * 不变量：
 * - 测试只认 `STUDY_STUDIO_TEST_RUNTIME_DIR`；通用生产变量 `STUDY_STUDIO_RUNTIME_DIR` 一律无视；
 * - pin 之后进程内产品解析（defaultRuntimeDir）必指测试目录，外部传入的生产路径被改写；
 * - 产品 `defaultRuntimeDir` 本身行为不变（对照组断言）。
 */
const PROD_VAR = 'STUDY_STUDIO_RUNTIME_DIR';
const TEST_VAR = 'STUDY_STUDIO_TEST_RUNTIME_DIR';

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

const DEFAULT_TEST_DIR = resolve(import.meta.dir, '../../../.test-runtime');

describe('pdf-test-runtime safety', () => {
  it('无视生产变量：即使它指向外部生产路径，测试目录仍是默认测试目录', () => {
    setEnv(PROD_VAR, join(homedir(), '.study-studio', 'runtime'));
    setEnv(TEST_VAR, undefined);
    expect(testRuntimeDir()).toBe(DEFAULT_TEST_DIR);
  });

  it('只认测试变量覆盖', () => {
    setEnv(PROD_VAR, join(homedir(), '.study-studio', 'runtime'));
    setEnv(TEST_VAR, '/tmp/explicit-test-runtime');
    expect(testRuntimeDir()).toBe('/tmp/explicit-test-runtime');
  });

  it('pin 无条件改写生产变量：外部生产路径绝不会被测试读写', () => {
    const prodPath = join(homedir(), '.study-studio', 'runtime');
    setEnv(PROD_VAR, prodPath);
    setEnv(TEST_VAR, undefined);
    const pinned = pinProcessToTestRuntime();
    expect(pinned).toBe(DEFAULT_TEST_DIR);
    // 产品解析（空依赖调用走这里）已被钉到测试目录，不再是外部生产路径
    expect(process.env[PROD_VAR]).toBe(DEFAULT_TEST_DIR);
    expect(defaultRuntimeDir()).toBe(DEFAULT_TEST_DIR);
    expect(defaultRuntimeDir()).not.toBe(prodPath);
  });

  it('对照组：产品 defaultRuntimeDir 行为一字未动', () => {
    setEnv(PROD_VAR, undefined);
    expect(defaultRuntimeDir()).toBe(join(homedir(), '.study-studio', 'runtime'));
    setEnv(PROD_VAR, '/tmp/some-prod');
    expect(defaultRuntimeDir()).toBe('/tmp/some-prod');
  });
});
