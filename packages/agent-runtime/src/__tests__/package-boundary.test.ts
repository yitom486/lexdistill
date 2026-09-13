import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * M1-1 package 公共边界锁（静态依赖检查，无运行时、无网络）：
 * - 8 个包的 workspace 依赖白名单（方向：base → contracts → adapters）；
 * - 全仓无厂商 SDK 包依赖；
 * - agent-runtime/contracts 只含契约，不反向依赖适配器；
 * - tool-core/protocol/learner-core/shared 不触达适配器与厂商 SDK；
 * - `new ToolRegistry(` 只许在 apps/gateway（装配根），packages 内禁实例化；
 * - apps/web 不引用适配器包与厂商 SDK。
 */

const PACKAGES = [
  'shared',
  'protocol',
  'tool-core',
  'agent-runtime',
  'learner-core',
  'speech',
  'learning-algorithms',
  'flashcards',
  'ai-content',
  'lexicon',
  'learning',
  'document-model',
  'content',
] as const;

const ALLOWED_WORKSPACE_DEPS: Record<string, string[]> = {
  'shared': [],
  'protocol': ['@study-studio/shared', '@study-studio/document-model'],
  'tool-core': ['@study-studio/shared', '@study-studio/protocol'],
  'agent-runtime': ['@study-studio/shared', '@study-studio/tool-core', 'zod'],
  'learner-core': ['@study-studio/shared', '@study-studio/protocol', '@study-studio/learning-algorithms', '@study-studio/flashcards'],
  'speech': ['@study-studio/shared'],
  'learning-algorithms': ['@study-studio/shared', '@study-studio/protocol'],
  'flashcards': ['@study-studio/shared'],
  'ai-content': ['@study-studio/shared', '@study-studio/learning', '@study-studio/protocol'],
  'lexicon': ['@study-studio/shared'],
  'learning': ['@study-studio/shared', '@study-studio/protocol', '@study-studio/document-model', '@study-studio/learner-core', '@study-studio/learning-algorithms'],
  'document-model': ['@study-studio/shared'],
  'content': ['@study-studio/shared', '@study-studio/document-model', '@study-studio/protocol'],
};

const FORBIDDEN_DEP_FRAGMENTS = ['openai', 'anthropic', 'agentclientprotocol'];

function repoRoot(): string {
  // packages/agent-runtime/src/__tests__/package-boundary.test.ts → 上 4 级到仓库根
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

  it('agent-runtime/contracts：只含契约，不反向依赖适配器', async () => {
    const hits = await filesWith(join(repoRoot(), 'packages', 'agent-runtime', 'src', 'contracts'), /agent-codex|agent-responses/);
    expect(hits).toEqual([]);
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

  it('lexicon/morphology+sources：实现内聚，仅相对路径与 shared', async () => {
    const pattern = /from\s+['"]@study-studio\/(?!shared['"])/;
    const hits: string[] = [];
    for (const sub of ['morphology', 'sources'] as const) {
      hits.push(...(await filesWith(join(repoRoot(), 'packages', 'lexicon', 'src', sub), pattern)));
    }
    expect(hits).toEqual([]);
  });

  it('learning/scheduling+practice：实现内聚（排程仅 algorithms/protocol/shared；组卷仅 shared/protocol/document-model，禁反向依赖 learner-core）', async () => {
    const schedHits = await filesWith(
      join(repoRoot(), 'packages', 'learning', 'src', 'scheduling'),
      /from\s+['"](?!\.|bun:test)(?!@study-studio\/shared['"]|@study-studio\/protocol['"]|@study-studio\/learning-algorithms['"])/
    );
    expect(schedHits.filter((f) => !f.includes('__tests__'))).toEqual([]);
    const practiceHits = await filesWith(
      join(repoRoot(), 'packages', 'learning', 'src', 'practice'),
      /from\s+['"](?!\.|bun:test)(?!@study-studio\/shared['"]|@study-studio\/protocol['"]|@study-studio\/document-model['"])/
    );
    expect(practiceHits.filter((f) => !f.includes('__tests__'))).toEqual([]);
  });

  it('document-model：教材 AST 正典，仅依赖 shared 与 zod（禁 Gateway/learner/Agent/Web/SQLite/Drizzle）', async () => {
    expect(
      await relativeImportsOnly('document-model', ['@study-studio/shared', 'zod'])
    ).toEqual([]);
  });

  it('content：Content 域纯解析层，仅依赖 shared/document-model/protocol（禁 Gateway/SQLite/Drizzle/learner-core/Agent/Web/网络/PDF runtime）', async () => {
    expect(
      await relativeImportsOnly('content', ['@study-studio/shared', '@study-studio/document-model', '@study-studio/protocol'])
    ).toEqual([]);
  });

  it('gateway PDF 摄取统一入口：原实现文件仅为兼容出口，消费者走 canonical 包（M5.1 起 canonical 为 content）', async () => {
    for (const file of [
      'modules/library/application/pdf-import/extract-headings.ts',
      'modules/library/application/pdf-import/markdown-to-ast.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/content');
      expect(text).not.toMatch(/^export function /m);
      expect(text).not.toMatch(/^function /m);
    }
    for (const file of [
      'modules/library/application/document-import/document-import-service.ts',
      'modules/library/application/pdf-import/layout-headings.ts',
      'modules/library/application/pdf-import/pdf-import-service.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/content');
    }
  });

  it('gateway manifest：必须声明 content（M5.1）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/content']).toBe('workspace:*');
  });

  it('flashcards/render+integrations：实现内聚（render 零外部依赖；integrations 仅 shared/解析运行时）', async () => {
    const renderHits = await filesWith(
      join(repoRoot(), 'packages', 'flashcards', 'src', 'render'),
      /from\s+['"](?!\.|bun:test)/
    );
    expect(renderHits.filter((f) => !f.includes('__tests__'))).toEqual([]);
    const integHits = await filesWith(
      join(repoRoot(), 'packages', 'flashcards', 'src', 'integrations'),
      /from\s+['"](?!\.|bun:test|node:|@study-studio\/shared['"]|bun:sqlite['"])/
    );
    expect(integHits.filter((f) => !f.includes('__tests__'))).toEqual([]);
  });

  it('learner-core 卡片兼容出口：垫片转出 flashcards（C5 后规范源；C6 删除）', async () => {
    for (const file of ['card-templates.ts', 'pitch-graph.ts']) {
      const text = await readFile(join(repoRoot(), 'packages', 'learner-core', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/flashcards');
      expect(text).not.toContain('@study-studio/flashcard-core');
    }
  });

  it('ai-content：确定性内容规则，仅依赖 shared/learning/protocol（禁 AgentAdapter/Gateway/SQLite/Web/SDK）', async () => {
    expect(
      await relativeImportsOnly('ai-content', ['@study-studio/shared', '@study-studio/learning', '@study-studio/protocol'])
    ).toEqual([]);
  });

  it('gateway 学习分析：纯规则走 ai-content（快照/缓存/会话仍归 Gateway）', async () => {
    const text = await readFile(
      join(repoRoot(), 'apps', 'gateway', 'src', 'modules', 'learning-progress', 'application', 'learning-analysis.ts'),
      'utf-8'
    );
    expect(text).toContain('@study-studio/ai-content');
  });

  it('learning：领域组合入口 + 快照/建议用例，仅组合 shared/protocol/document-model/learner/algorithms', async () => {
    expect(
      await relativeImportsOnly('learning', [
        '@study-studio/shared',
        '@study-studio/protocol',
        '@study-studio/document-model',
        '@study-studio/learner-core',
        '@study-studio/learning-algorithms',
      ])
    ).toEqual([]);
  });

  it('flashcards：卡片领域包，仅依赖 shared 与解析必需运行时（禁 Gateway/learner-core/Agent/Web）', async () => {
    expect(
      await relativeImportsOnly('flashcards', [
        '@study-studio/shared',
        'bun:sqlite',
        'node:fs',
        'node:os',
        'node:path',
      ])
    ).toEqual([]);
  });

  it('gateway 卡片统一入口：禁直引 flashcard-core/integrations，一律走 flashcards', async () => {
    const hits = await filesWith(
      join(repoRoot(), 'apps', 'gateway', 'src'),
      /@study-studio\/flashcard-(core|integrations)/
    );
    expect(hits).toEqual([]);
    for (const file of [
      'modules/flashcards/application/anki-push.ts',
      'modules/flashcards/application/apkg-import.ts',
      'modules/flashcards/application/card-preview.ts',
      'modules/flashcards/persistence/card-formats.ts',
      'modules/flashcards/persistence/anki-settings.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/flashcards');
    }
  });

  it('gateway manifest：必须声明 flashcards 且移除两旧直依赖（M7-5）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/flashcards']).toBe('workspace:*');
    expect(deps['@study-studio/flashcard-core']).toBeUndefined();
    expect(deps['@study-studio/flashcard-integrations']).toBeUndefined();
  });

  it('lexicon：词典领域包，实现内聚，仅依赖 shared', async () => {
    expect(
      await relativeImportsOnly('lexicon', ['@study-studio/shared'])
    ).toEqual([]);
  });

  it('gateway 词典统一入口：禁直引 dictionary-core/integrations，一律走 lexicon', async () => {
    const hits = await filesWith(
      join(repoRoot(), 'apps', 'gateway', 'src'),
      /@study-studio\/dictionary-(core|integrations)/
    );
    expect(hits).toEqual([]);
    for (const file of [
      'modules/dictionary/application/dictionary-packages.ts',
      'modules/dictionary/application/yomitan.ts',
      'modules/dictionary/persistence/dictionary.ts',
      'scripts/import-oewn.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/lexicon');
    }
  });

  it('gateway manifest：必须声明 lexicon（M7-4 统一入口消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/lexicon']).toBe('workspace:*');
    expect(deps['@study-studio/dictionary-core']).toBeUndefined();
    expect(deps['@study-studio/dictionary-integrations']).toBeUndefined();
  });

  it('gateway/web 教材统一入口：教材 AST 符号一律走 document-model，不走 protocol', async () => {
    const sym =
      /parseTextbookAST|TextbookASTSchema|TextbookAST|TextbookLesson|TextbookVocabulary|TextbookGrammar|DialogueLine|ExerciseItem/;
    const hits: string[] = [];
    for (const root of [join(repoRoot(), 'apps', 'gateway', 'src'), join(repoRoot(), 'apps', 'web', 'src')]) {
      const files = await filesWith(root, sym);
      for (const file of files) {
        const text = await readFile(file, 'utf-8');
        for (const line of text.split('\n')) {
          if (sym.test(line) && line.includes(`from '@study-studio/protocol'`)) {
            hits.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('gateway manifest：必须声明 document-model（M8-2 教材统一入口消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/document-model']).toBe('workspace:*');
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
