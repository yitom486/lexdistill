import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * M1-1 package 公共边界锁（静态依赖检查，无运行时、无网络）：
 * - 8 个包的 workspace 依赖白名单（方向：base → contracts → adapters）；
 * - 全仓无厂商 SDK 包依赖；
 * - agent-core 只含契约，不反向依赖适配器；
 * - tool-core/protocol/learner-core/shared 不触达适配器与厂商 SDK；
 * - `new ToolRegistry(` 只许在 apps/gateway（装配根），packages 内禁实例化；
 * - apps/web 不引用适配器包与厂商 SDK。
 */

const PACKAGES = [
  'shared',
  'protocol',
  'tool-core',
  'agent-core',
  'agent-codex',
  'agent-responses',
  'agent-runtime',
  'learner-core',
  'tts-core',
  'speech',
  'learning-algorithms',
  'dictionary-core',
  'dictionary-integrations',
  'flashcard-integrations',
  'flashcard-core',
  'review-core',
  'practice-core',
  'learning',
] as const;

const ALLOWED_WORKSPACE_DEPS: Record<string, string[]> = {
  'shared': [],
  'protocol': ['@study-studio/shared'],
  'tool-core': ['@study-studio/shared', '@study-studio/protocol'],
  'agent-core': ['@study-studio/shared', '@study-studio/tool-core'],
  'agent-codex': ['@study-studio/shared', '@study-studio/agent-core', '@study-studio/tool-core'],
  'agent-responses': ['@study-studio/shared', '@study-studio/agent-core', '@study-studio/tool-core'],
  'agent-runtime': ['@study-studio/agent-core', '@study-studio/agent-codex', '@study-studio/agent-responses'],
  'learner-core': ['@study-studio/shared', '@study-studio/protocol', '@study-studio/learning-algorithms', '@study-studio/review-core', '@study-studio/practice-core', '@study-studio/flashcard-core'],
  'tts-core': ['@study-studio/shared'],
  'speech': ['@study-studio/tts-core'],
  'learning-algorithms': ['@study-studio/shared', '@study-studio/protocol'],
  'dictionary-core': [],
  'dictionary-integrations': ['@study-studio/shared'],
  'flashcard-integrations': ['@study-studio/shared'],
  'flashcard-core': [],
  'review-core': ['@study-studio/shared', '@study-studio/protocol', '@study-studio/learning-algorithms'],
  'practice-core': ['@study-studio/shared', '@study-studio/protocol'],
  'learning': ['@study-studio/learner-core', '@study-studio/learning-algorithms', '@study-studio/review-core', '@study-studio/practice-core'],
};

const FORBIDDEN_DEP_FRAGMENTS = ['openai', 'anthropic', 'agentclientprotocol'];

function repoRoot(): string {
  // packages/agent-core/src/__tests__/package-boundary.test.ts → 上 4 级到仓库根
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`malformed ${what}: not an object`);
  }
  return value as Record<string, unknown>;
}

async function readPackageJson(name: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(repoRoot(), 'packages', name, 'package.json'), 'utf-8');
  const raw: unknown = JSON.parse(text);
  return asRecord(raw, `${name}/package.json`);
}

async function collectTsFiles(dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
  } catch {
    return;
  }
  const names = entries.map((e) => e.name).sort();
  for (const name of names) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const entry = entries.find((e) => e.name === name);
    if (entry !== undefined && entry.isDirectory()) {
      await collectTsFiles(full, out);
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

async function filesWith(rootDir: string, pattern: RegExp): Promise<string[]> {
  const files: string[] = [];
  await collectTsFiles(rootDir, files);
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf-8').catch(() => '');
    if (pattern.test(text)) hits.push(file);
  }
  return hits.sort();
}

function pkgSrc(name: string): string {
  return join(repoRoot(), 'packages', name, 'src');
}

describe('M1-1 package 依赖方向', () => {
  for (const name of PACKAGES) {
    it(`${name}：workspace 依赖白名单 + 无厂商 SDK`, async () => {
      const pkg = await readPackageJson(name);
      const deps = asRecord(pkg['dependencies'] ?? {}, `${name} dependencies`);
      for (const key of Object.keys(deps)) {
        const lower = key.toLowerCase();
        for (const frag of FORBIDDEN_DEP_FRAGMENTS) {
          expect(lower.includes(frag)).toBe(false);
        }
        if (key.startsWith('@study-studio/')) {
          expect(ALLOWED_WORKSPACE_DEPS[name] ?? []).toContain(key);
        }
      }
    });
  }

  it('agent-core：只含契约，不反向依赖适配器', async () => {
    const hits = await filesWith(pkgSrc('agent-core'), /@study-studio\/agent-(codex|responses)/);
    // 单测自身的断言字面量除外（产品代码禁反向引用）
    expect(hits.filter((f) => !f.includes('__tests__'))).toEqual([]);
  });

  it('tool-core/protocol/learner-core/shared：不触达适配器与厂商 SDK', async () => {
    const pattern = /@study-studio\/agent-(codex|responses)|@agentclientprotocol|@anthropic\/|from\s+['"]openai['"]/i;
    const hits: string[] = [];
    for (const name of ['tool-core', 'protocol', 'learner-core', 'shared'] as const) {
      hits.push(...(await filesWith(pkgSrc(name), pattern)));
    }
    expect(hits).toEqual([]);
  });

  it('ToolRegistry 实例化只许在 apps/gateway（packages 产品代码内禁 new）', async () => {
    const hits: string[] = [];
    for (const name of PACKAGES) {
      const found = await filesWith(pkgSrc(name), /new ToolRegistry\s*\(/);
      // 单测允许构造被测类本身；产品代码禁实例化（装配根在 Gateway）
      hits.push(...found.filter((f) => !f.includes('__tests__')));
    }
    expect(hits).toEqual([]);
    const wiring = await filesWith(
      join(repoRoot(), 'apps', 'gateway', 'src', 'runtime'),
      /new ToolRegistry\s*\(/
    );
    expect(wiring.length).toBeGreaterThan(0);
  });

  it('apps/web：不引用适配器包与厂商 SDK', async () => {
    const pattern =
      /@study-studio\/agent-(codex|responses)|@agentclientprotocol|@anthropic\/|from\s+['"]openai['"]/i;
    const hits = await filesWith(join(repoRoot(), 'apps', 'web', 'src'), pattern);
    expect(hits).toEqual([]);
  });

  it('learning-algorithms：纯计算层，无存储/网络/Agent 依赖', async () => {
    const pattern =
      /bun:sqlite|drizzle|Gateway|AgentAdapter|AgentSession|AgentEvent|openai|anthropic|agentclientprotocol|Repository|fetch\s*\(/i;
    const hits = await filesWith(join(repoRoot(), 'packages', 'learning-algorithms', 'src'), pattern);
    expect(hits).toEqual([]);
  });

  async function relativeImportsOnly(pkgDir: string, allowedPackages: string[]): Promise<string[]> {
    const dir = join(repoRoot(), 'packages', pkgDir, 'src');
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      const entries = await readdir(d, { withFileTypes: true });
      const names = entries.map((e) => e.name).sort();
      for (const name of names) {
        const full = join(d, name);
        const entry = entries.find((e) => e.name === name);
        if (entry !== undefined && entry.isDirectory()) {
          if (name === '__tests__') continue;
          await walk(full);
        } else if (name.endsWith('.ts')) {
          files.push(full);
        }
      }
    };
    await walk(dir);
    const bad: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf-8');
      const targets = [
        ...text.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => m[1] as string);
      for (const target of targets) {
        if (target.startsWith('.')) continue;
        if (allowedPackages.some((p) => target === p || target.startsWith(`${p}/`))) continue;
        bad.push(`${file} -> ${target}`);
      }
    }
    return bad;
  }

  it('dictionary-core：纯形态学，导入目标仅限相对路径', async () => {
    expect(await relativeImportsOnly('dictionary-core', [])).toEqual([]);
  });

  it('dictionary-integrations：纯解析，导入目标仅限相对路径与 shared', async () => {
    expect(await relativeImportsOnly('dictionary-integrations', ['@study-studio/shared'])).toEqual([]);
  });

  it('review-core：纯排程，仅依赖 learning-algorithms/protocol/shared', async () => {
    expect(
      await relativeImportsOnly('review-core', [
        '@study-studio/shared',
        '@study-studio/protocol',
        '@study-studio/learning-algorithms',
      ])
    ).toEqual([]);
  });

  it('practice-core：纯规则，仅依赖 shared/protocol（禁反向依赖 learner-core）', async () => {
    expect(
      await relativeImportsOnly('practice-core', ['@study-studio/shared', '@study-studio/protocol'])
    ).toEqual([]);
  });

  it('flashcard-integrations：纯传输/解析层，仅依赖 shared 与解析必需运行时（禁 Gateway/learner-core/Agent/Web）', async () => {
    expect(
      await relativeImportsOnly('flashcard-integrations', [
        '@study-studio/shared',
        'bun:sqlite',
        'node:fs',
        'node:os',
        'node:path',
      ])
    ).toEqual([]);
  });

  it('flashcard-core：纯模板渲染，零依赖（禁 Gateway/SQLite/Agent/Web/网络）', async () => {
    expect(await relativeImportsOnly('flashcard-core', [])).toEqual([]);
  });

  it('learner-core 卡片兼容出口：垫片转出 flashcard-core（apkg-export 未迁移不断裂）', async () => {
    for (const file of ['card-templates.ts', 'pitch-graph.ts']) {
      const text = await readFile(join(repoRoot(), 'packages', 'learner-core', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/flashcard-core');
    }
  });

  it('learning：领域组合入口，仅组合 learner/algorithms/review/practice-core', async () => {
    expect(
      await relativeImportsOnly('learning', [
        '@study-studio/learner-core',
        '@study-studio/learning-algorithms',
        '@study-studio/review-core',
        '@study-studio/practice-core',
      ])
    ).toEqual([]);
  });

  it('gateway 统一入口：禁直引 review-core/practice-core，一律走 learning', async () => {
    const hits = await filesWith(
      join(repoRoot(), 'apps', 'gateway', 'src'),
      /@study-studio\/(review-core|practice-core)/
    );
    expect(hits).toEqual([]);
    for (const file of [
      'modules/review/http/review-routes.ts',
      'modules/review/__tests__/review-commit.test.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/learning');
    }
  });

  it('gateway 学习进度 API：三纯函数走 learning 统一入口', async () => {
    const cases: Array<[string, string[]]> = [
      ['context/context-builder.ts', ['summarizeLearningEvidence']],
      ['modules/learning-progress/application/learning-analysis.ts', ['summarizeLearningEvidence']],
      ['runtime/handlers/learner-handlers.ts', ['recordSkillAttempt']],
    ];
    for (const [file, symbols] of cases) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/learning');
      for (const line of text.split('\n')) {
        for (const sym of symbols) {
          if (line.includes(sym) && line.includes('from')) {
            expect(line).toContain('@study-studio/learning');
          }
        }
      }
    }
  });

  it('gateway manifest：必须声明 learning（M6-3 统一入口消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/learning']).toBe('workspace:*');
  });

  it('gateway manifest：必须声明 dictionary-integrations（M5-2 消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/dictionary-integrations']).toBe('workspace:*');
  });
});

describe('M2-1 agent-runtime 外观', () => {
  it('contracts/ 内无适配器与厂商 SDK 痕迹', async () => {
    const pattern = /agent-codex|agent-responses|openai|anthropic|agentclientprotocol/i;
    const hits = await filesWith(join(repoRoot(), 'packages', 'agent-runtime', 'src', 'contracts'), pattern);
    expect(hits).toEqual([]);
  });

  it('网关装配走统一入口（不再直引适配器包）', async () => {
    const text = await readFile(
      join(repoRoot(), 'apps', 'gateway', 'src', 'runtime', 'gateway-runtime.ts'),
      'utf-8'
    );
    expect(text).toContain('@study-studio/agent-runtime');
    expect(text).not.toContain('@study-studio/agent-codex');
    expect(text).not.toContain('@study-studio/agent-responses');
  });
});
