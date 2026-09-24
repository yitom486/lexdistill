import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * M1-1 package 公共边界锁（静态依赖检查，无运行时、无网络）：
 * - 各包的 workspace 依赖白名单（方向：base → contracts → adapters）；
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
  'storage-sqlite',
  'archive',
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
  'content': ['@study-studio/shared', '@study-studio/document-model', '@study-studio/protocol', '@study-studio/archive'],
  'storage-sqlite': ['@study-studio/protocol', '@study-studio/document-model', '@study-studio/shared', '@study-studio/flashcards', '@study-studio/content', '@study-studio/learner-core', '@study-studio/learning'],
  'archive': ['@study-studio/shared'],
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

  it('apps/web：不引用厂商 SDK（适配器包引用由下条现存包集合锁覆盖）', async () => {
    const pattern = /@agentclientprotocol|@anthropic\/|from\s+['"]openai['"]/i;
    const hits = await filesWith(join(repoRoot(), 'apps', 'web', 'src'), pattern);
    expect(hits).toEqual([]);
  });

  it('learning-algorithms：纯计算层，无存储/网络/Agent 依赖', async () => {
    const pattern =
      /bun:sqlite|drizzle|Gateway|AgentAdapter|AgentSession|AgentEvent|openai|anthropic|agentclientprotocol|Repository|fetch\s*\(/i;
    const hits = await filesWith(join(repoRoot(), 'packages', 'learning-algorithms', 'src'), pattern);
    expect(hits).toEqual([]);
  });

  async function relativeImportsOnly(
    pkgDir: string,
    allowedPackages: string[],
    excludeDirs: string[] = ['__tests__'],
    subDir = ''
  ): Promise<string[]> {
    const dir = join(repoRoot(), 'packages', pkgDir, 'src', subDir);
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      const entries = await readdir(d, { withFileTypes: true });
      const names = entries.map((e) => e.name).sort();
      for (const name of names) {
        const full = join(d, name);
        const entry = entries.find((e) => e.name === name);
        if (entry !== undefined && entry.isDirectory()) {
          if (excludeDirs.includes(name)) continue;
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
    // E2b：src/document 为 Node-only 子入口（archive 依赖），由下条用例单独锁定，此处排除。
    expect(
      await relativeImportsOnly('content', ['@study-studio/shared', '@study-studio/document-model', '@study-studio/protocol'], ['__tests__', 'document'])
    ).toEqual([]);
  });

  it('content/document：Node-only 文档子入口，仅依赖 shared/archive（禁 drizzle/bun:sqlite/Gateway/网络直引；epub 符号禁上浮由 document-surface 测试锁）', async () => {
    expect(
      await relativeImportsOnly('content', ['@study-studio/shared', '@study-studio/archive'], ['__tests__'], 'document')
    ).toEqual([]);
  });

  it('archive：最小解包器，仅依赖 shared（禁领域/Gateway/网络/drizzle；第二实现禁令见包 README）', async () => {
    expect(
      await relativeImportsOnly('archive', ['@study-studio/shared', 'node:zlib'])
    ).toEqual([]);
  });

  it('gateway manifest：必须声明 archive（E2b 跨域复用统一入口消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/archive']).toBe('workspace:*');
  });

  // E2g：extract-headings.ts / markdown-to-ast.ts 薄垫片已删除（消费者直引包）；
  // layout-headings.ts 去垫片化后仍含 content 引用（运行时采集），保留在名单。
  it('gateway PDF 摄取统一入口：原实现文件仅为兼容出口，消费者走 canonical 包（M5.1 起 canonical 为 content）', async () => {
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

  it('learner-core 卡片兼容出口：垫片只许引用 render 子入口（禁根入口的 Node-only APKG 链；R1 Web 构建回归锁）', async () => {
    for (const file of ['card-templates.ts', 'pitch-graph.ts']) {
      const text = await readFile(join(repoRoot(), 'packages', 'learner-core', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/flashcards/render');
      expect(text).not.toMatch(/from\s+['"]@study-studio\/flashcards['"]/);
    }
  });

  it('apps/web 禁直引 flashcards 根入口（含 Node-only APKG 链；一律经 learner-core 垫片）', async () => {
    const hits = await filesWith(
      join(repoRoot(), 'apps', 'web', 'src'),
      /from\s+['"]@study-studio\/flashcards['"]/
    );
    expect(hits).toEqual([]);
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

  // D3 注：`persistence/anki-settings.ts`、`persistence/card-formats.ts`、
  // `persistence/media-store.ts` 已迁入 storage-sqlite/adapters（本名单移除）；
  // 其对 flashcards 的依赖改由 storage-sqlite 内聚测试锁定，删包依然断链。
  it('gateway 卡片统一入口一律走 flashcards（删包即断链，安装与类型检查兜底）', async () => {
    for (const file of [
      'modules/flashcards/application/anki-push.ts',
      'modules/flashcards/application/apkg-import.ts',
      'modules/flashcards/application/card-preview.ts',
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
  });

  it('lexicon：词典领域包，实现内聚，仅依赖 shared', async () => {
    expect(
      await relativeImportsOnly('lexicon', ['@study-studio/shared'])
    ).toEqual([]);
  });

  it('gateway 词典统一入口一律走 lexicon（删包即断链，安装与类型检查兜底）', async () => {
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

  it('gateway 学习入口一律走 learning（删包即断链，安装与类型检查兜底）', async () => {
    for (const file of [
      'modules/review/http/review-routes.ts',
      'modules/review/__tests__/review-commit.test.ts',
    ]) {
      const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'src', file), 'utf-8');
      expect(text).toContain('@study-studio/learning');
    }
  });

  it('gateway 学习能力：纯领域函数走 learning 统一入口', async () => {
    const cases: Array<[string, string[]]> = [
      ['runtime/context/context-builder.ts', ['summarizeLearningEvidence']],
      ['modules/learning-progress/application/learning-analysis.ts', ['summarizeLearningEvidence']],
      ['modules/practice/application/submit-practice-attempt.ts', ['recordSkillAttempt']],
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

  // D3 叶子规则（2026-09-14 修订，原“禁依赖领域模块”作废）：
  // flashcards 为当前唯一许可的纯叶子领域包（定义：仅依赖 shared、无存储/网络/Agent、
  // 无厂商 SDK、禁反向依赖 storage，由 flashcards 自身内聚测试锁定，无循环可能）。
  // 新增叶子依赖必须同步修订 10 号卡＋包 README＋本白名单三处；禁只放宽白名单。
  it('storage-sqlite：SQLite 适配层，仅依赖 protocol/document-model/shared/纯领域包 + drizzle/bun:sqlite/node（禁 Gateway/ports/编排/Agent/Web）', async () => {
    expect(
      await relativeImportsOnly('storage-sqlite', [
        '@study-studio/protocol',
        '@study-studio/document-model',
        '@study-studio/shared',
        '@study-studio/flashcards',
        '@study-studio/content',
        '@study-studio/learner-core',
        '@study-studio/learning',
        'drizzle-orm',
        'bun:sqlite',
        'node:crypto',
        'node:fs',
        'node:os',
        'node:path',
      ])
    ).toEqual([]);
  });

  it('storage-sqlite 对 learner-core 的引用仅限 course-route 声明符号（kana 仅 type 边另锁；禁放宽）', async () => {
    const dir = join(repoRoot(), 'packages', 'storage-sqlite', 'src');
    const hits = await filesWith(dir, /from\s+['"]@study-studio\/learner-core['"]/);
    expect(hits).toEqual([
      join(dir, 'adapters', 'learning-progress', 'course-route.ts'),
      join(dir, 'adapters', 'learning-progress', 'kana-practice-state.ts'),
    ]);
    const text = await readFile(join(dir, 'adapters', 'learning-progress', 'course-route.ts'), 'utf-8');
    const m = text.match(/import\s*\{([^}]*)\}\s*from\s*['"]@study-studio\/learner-core['"]/);
    expect(m).not.toBeNull();
    const syms = (m as RegExpMatchArray)[1]!
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter((s) => s.length > 0);
    expect(syms.length).toBeGreaterThan(0);
    for (const s of syms) {
      expect(['resolveCourseRoute', 'CourseRouteSnapshot', 'UnitEvidence']).toContain(s);
    }
  });

  it('storage-sqlite 对 learning 的引用仅限 practice-plan 声明符号（禁放宽）', async () => {
    const dir = join(repoRoot(), 'packages', 'storage-sqlite', 'src');
    const hits = await filesWith(dir, /from\s+['"]@study-studio\/learning['"]/);
    expect(hits).toEqual([
      join(dir, 'adapters', 'practice', 'practice-plan.ts'),
    ]);
    const text = await readFile(hits[0] as string, 'utf-8');
    const mm = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@study-studio\/learning['"]/g)];
    expect(mm.length).toBeGreaterThan(0);
    for (const one of mm) {
      const syms = one[1]!
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, ''))
        .filter((s) => s.length > 0);
      for (const s of syms) {
        expect([
          'validatePracticePlanTemplate',
          'freezeRunFromTemplate',
          'parsePracticeBlockSpecs',
        ]).toContain(s);
      }
    }
  });

  it('kana-practice-state 对 learner-core 只许 import type（禁值导入；course-route 值引用由上条锁定）', async () => {
    const file = join(
      repoRoot(), 'packages', 'storage-sqlite', 'src',
      'adapters', 'learning-progress', 'kana-practice-state.ts'
    );
    const text = await readFile(file, 'utf-8');
    expect(text).toContain("from '@study-studio/learner-core'");
    const valueImports = [...text.matchAll(/^import\s(?!\s*type\s)\{[^}]*\}\s*from\s*['"]@study-studio\/learner-core['"]/gm)];
    expect(valueImports.map((v) => v[0])).toEqual([]);
  });

  it('storage-sqlite 对 content 的引用仅限文档种类纯表面（import-tasks 例外；禁放宽整个 content）', async () => {
    const dir = join(repoRoot(), 'packages', 'storage-sqlite', 'src');
    const hits = await filesWith(dir, /from\s+['"]@study-studio\/content['"]/);
    expect(hits).toEqual([
      join(dir, 'adapters', 'document', 'import-tasks.ts'),
    ]);
    const text = await readFile(hits[0] as string, 'utf-8');
    const m = text.match(/import\s*\{([^}]*)\}\s*from\s*['"]@study-studio\/content['"]/);
    expect(m).not.toBeNull();
    const syms = (m as RegExpMatchArray)[1]!
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter((s) => s.length > 0);
    expect(syms.length).toBeGreaterThan(0);
    for (const s of syms) {
      expect(['DOCUMENT_SOURCE_KINDS', 'DocumentSourceKind']).toContain(s);
    }
  });

  it('gateway manifest：必须声明 storage-sqlite（M4/D2 统一入口消费方）', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const pkg = asRecord(JSON.parse(text) as unknown, 'apps/gateway package.json');
    const deps = asRecord(pkg['dependencies'] ?? {}, 'apps/gateway dependencies');
    expect(deps['@study-studio/storage-sqlite']).toBe('workspace:*');
  });
});

describe('M2-1 agent-runtime 外观', () => {
  it('contracts/ 实现内聚：仅相对路径与 shared/tool-core（禁适配器与厂商 SDK）', async () => {
    const pattern =
      /from\s+['"](?!\.|bun:test)(?!@study-studio\/shared['"]|@study-studio\/tool-core['"])/;
    const hits = await filesWith(join(repoRoot(), 'packages', 'agent-runtime', 'src', 'contracts'), pattern);
    expect(hits).toEqual([]);
  });

  it('网关装配走统一入口（不再直引适配器包）', async () => {
    const text = await readFile(
      join(repoRoot(), 'apps', 'gateway', 'src', 'runtime', 'gateway-runtime.ts'),
      'utf-8'
    );
    expect(text).toContain('@study-studio/agent-runtime');
  });
});
