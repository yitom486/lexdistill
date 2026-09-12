import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isDevProcess,
  killPid,
  killTree,
  listWatchedListeners,
  procInfos,
  shortCmd,
} from './dev-ports.js';

/**
 * dev 启动器（§7 根本修复：脏房间拒绝开工 + 启动器拥有整棵树）。
 *
 *   bun run dev:web                  # web(:3000) + gateway(:8080)，默认
 *   bun run dev:web -- --only=web    # 只要 web
 *   bun run dev:web -- --only=gateway# 只要网关
 *   bun run dev:web -- --force       # 先杀 dev-verified 占位者再起（大声记录）
 *   bun run dev:web -- --check       # 只做启动前核对，不起进程
 *
 * 语义：
 * - 启动前核对 3000/8080（strictPort + 不漂移的前提下，要绑的就是这两个）；
 *   被占即拒绝并打印占位表 + 指引 dev:clean，绝不“换个端口继续”（那是掩盖僵尸）。
 * - web/gateway 作为本进程的直接子进程启动（stdio 继承，日志仍在同一终端）；
 *   任一子进程退出或本进程收到信号，即杀整棵树后退出——Ctrl+C 必带走全部。
 * - Windows 直接关终端窗口不投递信号（OS 限制，无银弹）：残留由下次启动的
 *   拒绝开工挡住 + dev:clean 清理，堆积不可能再发生。
 */

const ROOT = dirname(fileURLToPath(new URL('..', import.meta.url)));
const WEB_PORT = 3000;
const GATEWAY_PORT = 8080;

function usage(): void {
  console.log('[dev-run] 用法：bun run dev:web [-- --only=web|gateway] [--force] [--check]');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return 0;
  }
  let only: 'web' | 'gateway' | 'both' = 'both';
  for (const arg of args) {
    if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      if (value === 'web' || value === 'gateway') only = value;
      else {
        console.error(`[dev-run] 非法 --only=${value}（只要 web|gateway）。`);
        return 1;
      }
    } else if (arg !== '--force' && arg !== '--check') {
      console.error(`[dev-run] 非法参数 ${arg}。`);
      usage();
      return 1;
    }
  }
  const force = args.includes('--force');
  const checkOnly = args.includes('--check');
  const wantPorts = only === 'web' ? [WEB_PORT] : only === 'gateway' ? [GATEWAY_PORT] : [WEB_PORT, GATEWAY_PORT];

  // 1) 启动前核对：脏房间先自动收孤儿，收不动才拒绝开工（§7.1）。
  // 自动清理谓词（缺一不可，宁可拒启不盲杀）：
  //   ① 父进程已死（孤儿）；② 命令行命中 dev 形状；
  //   ③ 归属明确：命令行含本仓库根路径，或端口+角色对得上（300x↔vite / 808x↔gateway）。
  // 父活着的、非 dev 的、归属不明的 → 一律拒绝，人工 dev:clean 处理。
  const holders = listWatchedListeners().filter((l) => wantPorts.includes(l.port));
  const holderVerdict = (
    info: { cmd: string; parentAlive: boolean } | undefined,
    port: number
  ): 'auto' | 'manual' => {
    if (!info || info.parentAlive || !isDevProcess(info.cmd)) return 'manual';
    const cmdLower = info.cmd.toLowerCase();
    const rootLower = ROOT.toLowerCase();
    if (cmdLower.includes(rootLower)) return 'auto';
    if (port === GATEWAY_PORT && /--watch.*index\.ts|gateway/i.test(info.cmd)) return 'auto';
    if (port >= 3000 && port <= 3010 && /vite/i.test(info.cmd)) return 'auto';
    return 'manual';
  };
  if (holders.length > 0) {
    const infos = procInfos(holders.map((h) => h.pid));
    const autoKillable = holders.filter((h) => holderVerdict(infos.get(h.pid), h.port) === 'auto');
    const manualOnly = holders.filter((h) => holderVerdict(infos.get(h.pid), h.port) !== 'auto');
    if (checkOnly) {
      for (const h of holders) {
        const info = infos.get(h.pid);
        const verdict = holderVerdict(info, h.port);
        console.log(
          `  端口 ${h.port} ← PID ${h.pid}：${verdict === 'auto' ? '可自动清理（孤儿+dev+归属明确）' : '需手动处理'}${info ? ` ${shortCmd(info.cmd)}` : '（不可读）'}`
        );
      }
      return holders.length === 0 ? 0 : 1;
    }
    // --force：把“父活着的 dev 进程”也纳入可杀（同样大声记录；非 dev 照样拒绝）。
    const killable = force
      ? holders.filter((h) => {
          const info = infos.get(h.pid);
          return !!info && isDevProcess(info.cmd);
        })
      : autoKillable;
    const unkillable = holders.filter((h) => !killable.includes(h));
    if (unkillable.length > 0) {
      for (const h of unkillable) {
        const info = infos.get(h.pid);
        console.error(
          `  端口 ${h.port} ← PID ${h.pid}：不可自动清理（${!info ? '进程不可读' : info.parentAlive ? '父进程还活着，疑似有人在用（加 --force 可覆盖 dev 进程）' : !isDevProcess(info.cmd) ? '非 dev 进程' : '归属不明'}）${info ? shortCmd(info.cmd) : ''}`
        );
      }
      console.error('[dev-run] 拒绝启动：以上占位者需人工核对（bun run dev:clean）。本次未启动任何进程。');
      return 1;
    }
    if (killable.length > 0) {
      // 默认即自动清理孤儿（大声记录）；--force 只是把“父活着的 dev 进程”也纳入（同样大声）。
      // 注意：被清理进程服务的页面会一起死——先关掉旧标签页再启动。
      console.log(`[dev-run] 自动清理 ${killable.length} 个占位者…`);
      for (const h of holders) {
        const info = infos.get(h.pid);
        if (!info || !isDevProcess(info.cmd)) {
          console.error(`[dev-run] 端口 ${h.port} ← PID ${h.pid} 非 dev 进程，拒绝自动杀：${info ? shortCmd(info.cmd) : '不可读'}`);
          console.error('[dev-run] 请人工核对后用 dev:clean 处理，本次拒绝启动。');
          return 1;
        }
        const done = killPid(h.pid);
        console.log(`[dev-run] 已杀 PID ${h.pid}（端口 ${h.port}，生于 ${info.born}）：${done ? 'ok' : '失败'}`);
        if (!done) return 1;
      }
      const again = listWatchedListeners().filter((l) => wantPorts.includes(l.port));
      if (again.length > 0) {
        console.error('[dev-run] 清理后端口仍被占，拒绝启动。请用 dev:clean 核对。');
        return 1;
      }
    }
  }
  console.log(`[dev-run] 端口核对通过（${wantPorts.join('/')} 空闲）。`);
  if (checkOnly) return 0;

  // 2) 直属子进程启动（stdio 继承；unix 独立进程组以便整组杀）。
  // 注意：子进程经 `bun run --filter` 启动，Bun 默认 --elide-lines=10 会吞掉超长
  // 输出（[N lines elided]）；调试需要全量日志，此处显式关掉（0 = 全显示）。
  const specs: Array<{ name: string; argv: string[] }> = [];
  if (only !== 'gateway') specs.push({ name: 'web', argv: ['run', '--elide-lines=0', '--filter', '@study-studio/web', 'dev'] });
  if (only !== 'web') specs.push({ name: 'gateway', argv: ['run', '--elide-lines=0', '--filter', '@study-studio/gateway', 'dev'] });
  const children = new Map<ChildProcess, string>();
  for (const spec of specs) {
    const child = spawn('bun', spec.argv, {
      cwd: ROOT,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      shell: false,
    });
    if (typeof child.pid === 'number') {
      console.log(`[dev-run] ${spec.name} 已启动（PID ${child.pid}）。Ctrl+C 即带走整棵树。`);
    }
    children.set(child, spec.name);
  }
  if (children.size === 0) {
    console.error('[dev-run] 没有可启动的子进程。');
    return 1;
  }

  // 3) 拥有整棵树：任一子退出或收到信号 → 杀全部 → 按首个退出码退出。
  // 监督器靠子进程句柄常驻（不 unref），settle 后才退出。
  let shuttingDown = false;
  let exitCode = 0;
  let resolveSettled: (() => void) | null = null;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const finish = (code: number): void => {
    exitCode = code;
    resolveSettled?.();
  };
  const shutdown = (reason: string, code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev-run] ${reason}，正在带走整棵树…`);
    for (const [child, name] of children) {
      try {
        if (child.exitCode === null && typeof child.pid === 'number') {
          const done = killTree(child.pid);
          console.log(`[dev-run] ${name}（PID ${child.pid}）${done ? '已停' : '停止失败，请用 dev:clean 核对'}`);
        }
      } catch {
        // 退出期错误不掩盖主退出码
      }
    }
    finish(code);
  };
  for (const [child, name] of children) {
    child.on('exit', (code) => {
      if (shuttingDown) return;
      console.log(`[dev-run] ${name} 退出（码 ${code}），带走其余进程…`);
      shutdown(`子进程 ${name} 先退`, typeof code === 'number' ? code : 1);
    });
    child.on('error', (e) => {
      if (shuttingDown) return;
      console.error(`[dev-run] ${name} 启动失败：${String(e).slice(0, 200)}`);
      shutdown(`子进程 ${name} 启动失败`, 1);
    });
  }
  process.on('SIGINT', () => shutdown('收到 SIGINT', 130));
  process.on('SIGTERM', () => shutdown('收到 SIGTERM', 143));
  await settledPromise;
  return exitCode;
}

process.exit(await main());
