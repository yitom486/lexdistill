import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import * as practicePublic from '../modules/practice/public.js';
import * as learningProgressPublic from '../modules/learning-progress/public.js';

/**
 * G5：模块边界回归测试。
 *
 * 允许的方向：
 * - transport/bootstrap/index 组装 runtime、modules、infrastructure（显式装配）。
 * - modules 经 `deps` 或 public.ts / ports.ts 消费其他模块能力；跨模块依赖必须登记，
 *   深路径引用仅允许下表注明的过渡例外。
 * - 测试文件不受装配规则约束，但跨模块引用同样登记。
 */
const SRC = resolve(import.meta.dir, '..');

const ASSEMBLERS = new Set([
  'index.ts',
  // Desktop sidecar is a second process entrypoint, not a domain module.
  'sidecar.ts',
  'bootstrap/config.ts',
  'bootstrap/create-gateway.ts',
  'bootstrap/start-gateway.ts',
  'transport/http/create-app.ts',
  'composition/gateway-deps.ts',
  'composition/agent-deps.ts',
  'transport/tools/register-tools.ts',
  'transport/websocket/websocket-handler.ts',
]);

/** 过渡例外：from -> to（src 相对路径，.js 后缀归一后比较） */
// M1-2：跨模块统一走各域 public.ts / ports.ts，不再登记深路径。
const CROSS_MODULE_ALLOWLIST = new Set([
  'modules/review/persistence/cards.ts -> modules/learning-progress/public.js',
  'modules/practice/persistence/practice.ts -> modules/learning-progress/public.js',
  'modules/practice/persistence/questions.ts -> modules/learning-progress/public.js',
  'modules/practice/application/practice-proposal.ts -> modules/learning-progress/public.js',
  'modules/practice/http/practice-routes.ts -> modules/learning-progress/public.js',
  'modules/practice/__tests__/practice-phase-d.test.ts -> modules/learning-progress/public.js',
  // practice consumes content generation through the learning-content public API.
  'modules/practice/application/practice-assembly.ts -> modules/learning-content/public.js',
  'modules/practice/__tests__/practice-assembly.test.ts -> modules/learning-content/public.js',
  // learning-content declares borrowed domain capabilities through public ports.
  'modules/learning-content/ports.ts -> modules/dictionary/ports.js',
  'modules/learning-content/ports.ts -> modules/library/ports.js',
  'modules/learning-content/ports.ts -> modules/practice/ports.js',
  // learning-content reuses dictionary sampling and curriculum seed reads through domain APIs.
  // E2b：yomitan 改直引 @study-studio/archive，library/public 中转边消除。
  // Anki 推送复用 tts-proxy 合成（只取音频字节；Key 随调用来、用完即弃，永不落盘）。
  'modules/flashcards/application/anki-push.ts -> modules/tts/application/tts-proxy.js',
  // E2b：apkg-import 改直引 @study-studio/archive，library/public 中转边消除。
  // flashcards.collect 复用词典 collect 的输出类型（type-only；与查词面板同一命令）。
  'modules/flashcards/tools/flashcards-collect-tool.ts -> modules/dictionary/public.js',
  // 草稿域复用相遇词 term_key 归一 + 回填（同键跨包稳定；accept 与 collect 同级信号）。
  'modules/flashcards/persistence/card-drafts.ts -> modules/dictionary/public.js',
  // 批注转卡复用相遇词 collect 信号（短 quote 才记；语种取所属文档）。
  'modules/library/persistence/documents-annotations.ts -> modules/dictionary/public.js',
  // 定级考复用档位写入（跳级通道；run/装配仍走 practice 自家）。
  'modules/practice/persistence/placement.ts -> modules/learning-progress/public.js',
  // M1-2 仓储能力接口：上层经 ports 消费，不再直连 Drizzle 实现类。
  'modules/curriculum/tools/learning-curriculum-tool.ts -> modules/library/ports.js',
  'modules/flashcards/tools/flashcards-collect-tool.ts -> modules/dictionary/ports.js',
  'modules/learning-progress/tools/mistakes-resolve-tool.ts -> modules/practice/ports.js',
  'modules/practice/application/practice-assembly.ts -> modules/library/ports.js',
  // E2b：epub-reader 已迁入 @study-studio/content/document，archive 走包引用，
  // 跨模块深路径边消除（删包由 content/document 内聚测试兜底）。
  // 网页正文复用新闻管线的 Readability 抽取纯函数（抓取层自备 SSRF 防护）。
  'modules/library/application/document-import/url-reader.ts -> modules/curriculum/infrastructure/news-article-fetch.js',
  // 新闻管线复用 URL 导入的 SSRF 守卫（公网断言/重定向复检/限流读取同一口径）。
  'modules/curriculum/infrastructure/news-article-fetch.ts -> modules/library/application/document-import/web-url.js',
  'modules/curriculum/infrastructure/news-rss.ts -> modules/library/application/document-import/web-url.js',
  // E4b registrar 跨模块仓储契约类型（type-only；构造仍由装配根注入实例）。
  'modules/learning-progress/tools/register-learning-progress-tools.ts -> modules/practice/ports.js',
  'modules/curriculum/tools/register-curriculum-tools.ts -> modules/library/ports.js',
  'modules/flashcards/tools/register-flashcards-tools.ts -> modules/dictionary/ports.js',
]);

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.test-runtime') continue;
      collectTs(full, out);
    } else if (
      (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) ||
      (entry.name.endsWith('.js') && !entry.name.endsWith('.js.map'))
    ) {
      // dist 编译副本同样可扫（.js）；.d.ts/.map 跳过。
      out.push(full);
    }
  }
  return out;
}

interface ImportRef {
  from: string;
  target: string;
  typeOnly: boolean;
}

function extractImports(file: string): ImportRef[] {
  const src = readFileSync(file, 'utf8');
  const refs: ImportRef[] = [];
  const staticRe = /import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(src))) {
    refs.push({ from: file, target: m[2]!, typeOnly: Boolean(m[1]) });
  }
  while ((m = dynamicRe.exec(src))) {
    refs.push({ from: file, target: m[1]!, typeOnly: false });
  }
  return refs;
}

function toSrcRelative(fromFile: string, target: string): string | null {
  if (!target.startsWith('.')) return null;
  const abs = resolve(dirname(fromFile), target);
  const rel = relative(SRC, abs).split(sep).join('/');
  if (rel.startsWith('..')) return null;
  return existsSync(abs) || existsSync(abs + '.ts') ? rel : rel;
}

function topDir(rel: string): string {
  return rel.split('/')[0]!;
}

describe('gateway module boundaries (G5)', () => {
  const files = collectTs(SRC);
  const violations: string[] = [];

  for (const file of files) {
    const rel = relative(SRC, file).split(sep).join('/');
    // 跨 dist/src 统一为 .ts 口径（allowlist 用 .ts from、.js to）。
    const relTs = rel.replace(/\.js$/, '.ts');
    const isTest = rel.includes('/__tests__/') || rel.endsWith('.test.ts') || rel.endsWith('.test.js');
    for (const ref of extractImports(file)) {
      const target = toSrcRelative(file, ref.target);
      if (!target) continue;
      const normTarget = target.replace(/\.ts$/, '.js');

      // R1：装配器之外不得引用启动装配（bootstrap / 应用组装 / 旧 server stub）。
      if (!ASSEMBLERS.has(rel) && !ASSEMBLERS.has(relTs) && !isTest) {
        if (
          normTarget.startsWith('bootstrap/') ||
          normTarget === 'transport/http/create-app.js' ||
          normTarget === 'server.js' ||
          normTarget.endsWith('/server.js')
        ) {
          violations.push(`R1 ${rel} -> ${normTarget}（禁止引用启动装配/旧入口）`);
        }
      }
      // R2：领域模块不得依赖 Runtime；其他层不得（值）引用运行时协调器单例实现。
      if (!isTest && relTs.startsWith('modules/') && normTarget.startsWith('runtime/')) {
        violations.push(`R2 ${rel} -> ${normTarget}（领域模块不得反向依赖 Runtime）`);
      }
      if (
        !isTest &&
        !ASSEMBLERS.has(rel) &&
        !ASSEMBLERS.has(relTs) &&
        !relTs.startsWith('modules/') &&
        normTarget === 'runtime/gateway-runtime.js' &&
        !ref.typeOnly
      ) {
        violations.push(`R2 ${rel} -> ${normTarget}（禁止值引用运行时协调器）`);
      }

      // R3：共享基础设施 persistence 不得反向依赖领域模块。
      // 注：infrastructure/ 根门面是过渡期兼容委托方，豁免；
      // `infrastructure/db/` 已于 M4/D2 整体迁入 `@study-studio/storage-sqlite`，本仓不再存在。
      if (
        rel.startsWith('infrastructure/persistence/') &&
        normTarget.startsWith('modules/')
      ) {
        violations.push(`R3 ${rel} -> ${normTarget}（基础设施不得依赖领域模块）`);
      }

      // R4：persistence 不得引用同域或异域的上层（application/http/tools）。
      if (relTs.includes('/persistence/') && !isTest) {
        if (
          normTarget.includes('/application/') ||
          normTarget.includes('/http/') ||
          normTarget.includes('/tools/')
        ) {
          violations.push(`R4 ${rel} -> ${normTarget}（持久层不得依赖上层）`);
        }
      }

      // R5：所有跨模块依赖必须登记；优先引用 public.ts / ports.ts，深路径需有明确理由。
      const fromModule = relTs.startsWith('modules/') ? relTs.split('/')[1] : null;
      const toModule = normTarget.startsWith('modules/') ? normTarget.split('/')[1] : null;
      if (fromModule && toModule && fromModule !== toModule) {
        const key = `${relTs} -> ${normTarget}`;
        if (!CROSS_MODULE_ALLOWLIST.has(key)) {
          violations.push(`R5 ${key}（新增跨模块依赖需登记，优先走 public.ts / ports.ts）`);
        }
      }

      // R6：模块引用 transport/tools 仅允许 import type（测试除外）。
      if (fromModule && !isTest && normTarget.startsWith('transport/tools/') && !ref.typeOnly) {
        violations.push(`R6 ${rel} -> ${normTarget}（模块仅允许 type-only 引用 Tool）`);
      }

      // R7：禁止绝对路径导入（盘符/UNC/file:// 裸 /）。
      // 实测（P3.4B-FIX4）：Windows Bun 下绝对路径与相对引用解析为两个模块实例，
      // 模块级状态（工具会话登记/暂存）直接分裂。测试文件同样禁（探针脚本放 Temp）。
      const raw = ref.target;
      if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('file:') || (raw.startsWith('/') && !raw.startsWith('//'))) {
        violations.push(`R7 ${rel} -> ${raw}（禁止绝对路径导入，相对引用是唯一合法形状）`);
      }
    }
  }

  it('has no boundary violations', () => {
    expect(violations).toEqual([]);
  });

  it('keeps learning.content implementation inside its domain module', () => {
    expect(existsSync(join(SRC, 'modules', 'learning-content', 'public.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'transport', 'tools', 'learning-content-tool.ts'))).toBe(false);
    expect(existsSync(join(SRC, 'transport', 'tools', 'learning-content'))).toBe(false);
  });

  it('keeps learning WebSocket handlers in domain modules behind public APIs', () => {
    expect(existsSync(join(SRC, 'modules', 'practice', 'websocket', 'quiz-handlers.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'modules', 'learning-progress', 'websocket', 'learner-handlers.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'runtime', 'handlers', 'learner-handlers.ts'))).toBe(false);
    for (const key of ['handleQuizSubmit', 'handleQuizGenerate', 'handleQuizGradeSubjective'] as const) {
      expect(typeof practicePublic[key]).toBe('function');
    }
    for (const key of [
      'handleProfileGet',
      'handleProfileUpdate',
      'handleTaskProgressGet',
      'handleTaskActivityRecord',
    ] as const) {
      expect(typeof learningProgressPublic[key]).toBe('function');
    }
  });

  it('keeps cross-cutting agent runtime capabilities under runtime/', () => {
    const movedFiles = [
      'runtime/context/context-builder.ts',
      'runtime/session/session-manager.ts',
      'runtime/router/agent-router.ts',
      'runtime/router/tool-router.ts',
      'runtime/router/turn-tools.ts',
      'runtime/router/README.md',
    ];
    const oldFiles = [
      'context/context-builder.ts',
      'session/session-manager.ts',
      'router/agent-router.ts',
      'router/tool-router.ts',
      'router/turn-tools.ts',
      'router/README.md',
    ];
    for (const file of movedFiles) expect(existsSync(join(SRC, ...file.split('/')))).toBe(true);
    for (const file of oldFiles) expect(existsSync(join(SRC, ...file.split('/')))).toBe(false);
  });

  it('getRawDb 原生直通仅限三处 legacy（禁新增生产调用方）', () => {
    // D3 getRawDb 决议：方法保留作测试/装配/词典包管理逃生口；
    // 新增生产调用必须先走 ports 评审（词典包管理收口为 ports 方法）。
    // 允许集合：门面定义本身、启动装配、词典路由三处 legacy 直通；
    // 测试与脚本不在此断言（测试探针另有归属，脚本走包导入）。
    const allowed = new Set([
      'bootstrap/create-gateway.ts',
      'modules/dictionary/http/dictionary-routes.ts',
      'infrastructure/drizzle-learner-repository.ts',
    ]);
    const bad: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel.includes('/__tests__/') || rel.endsWith('.test.ts')) continue;
      if (rel.startsWith('scripts/')) continue;
      const text = readFileSync(file, 'utf-8');
      if (text.includes('getRawDb()') && !allowed.has(rel)) {
        bad.push(rel);
      }
    }
    expect(bad).toEqual([]);
  });

  it('documents every cross-module exception', () => {
    // 例外表条目必须真实存在，防止过期条目掩盖新增违规。
    // 按去后缀基名比对，src 与 dist 编译副本都能跑。
    const baseOf = (rel: string) => rel.replace(/\.(d\.ts|ts|js)$/, '');
    const existing = new Set(
      files.map((f) => baseOf(relative(SRC, f).split(sep).join('/'))),
    );
    for (const key of CROSS_MODULE_ALLOWLIST) {
      const [from, to] = key.split(' -> ');
      expect(existing.has(baseOf(from!)), `allowlist from missing: ${from}`).toBe(true);
      expect(existing.has(baseOf(to!)), `allowlist to missing: ${to}`).toBe(true);
    }
  });
});
