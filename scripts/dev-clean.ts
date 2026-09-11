import { isDevProcess, killPid, listWatchedListeners, procInfos, shortCmd } from './dev-ports.js';

/**
 * dev 僵尸清理（§7.2 一键清理脚本；只读核对默认，杀进程必须显式给 PID）。
 *
 *   bun run dev:clean                 # 只列出 3000-3010 / 8080-8090 的监听者（默认，不杀）
 *   bun run dev:clean -- --kill <pid> # 仅杀名单内 PID，且命令行必须命中 dev 特征
 *
 * 判定口径（与 AGENTS.md §7.1 一致）：
 * - 父进程已死 → ORPHAN，可杀；
 * - 命令行命中 dev 特征（bun/node + vite|gateway|index.ts|test|dev）→ 可杀；
 * - 其他一律拒绝（禁止盲 kill，脚本自己也不盲杀）。
 * Windows 关终端不投递信号，孤儿只能靠本脚本定期核对，没有银弹。
 */

function main(): number {
  const args = process.argv.slice(2);
  const listeners = listWatchedListeners();
  const pids = [...new Set(listeners.map((l) => l.pid))].sort((a, b) => a - b);
  const infos = procInfos(pids);

  const killIndex = args.indexOf('--kill');
  const killTargets = killIndex >= 0 ? args.slice(killIndex + 1).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : [];

  console.log('[dev-clean] 监听扫描（3000-3010 / 8080-8090）：');
  if (listeners.length === 0) {
    console.log('  （空：目标端口无监听，可直接启动）');
  }
  const byPid = new Map<number, number[]>();
  for (const l of listeners) {
    const list = byPid.get(l.pid) ?? [];
    list.push(l.port);
    byPid.set(l.pid, list);
  }
  for (const pid of [...byPid.keys()].sort((a, b) => a - b)) {
    const info = infos.get(pid);
    const ports = (byPid.get(pid) ?? []).join(',');
    if (!info) {
      console.log(`  端口 ${ports} ← PID ${pid}（进程信息不可读，跳过判定）`);
      continue;
    }
    const orphan = info.parentAlive ? '' : ' ORPHAN（父已死）';
    const devish = isDevProcess(info.cmd) ? ' dev 相关' : ' 未知来源';
    console.log(`  端口 ${ports} ← PID ${pid}${orphan}${devish}`);
    console.log(`    生于 ${info.born} ｜ 父 ${info.ppid}${info.parentAlive ? '(存活)' : '(已死)'}`);
    console.log(`    ${shortCmd(info.cmd)}`);
  }

  if (killTargets.length === 0) {
    if (killIndex >= 0) {
      console.error('[dev-clean] --kill 后面没有给 PID，不执行。');
      return 1;
    }
    console.log('[dev-clean] 只读核对完成，未杀任何进程。如需清理：bun run dev:clean -- --kill <pid> [pid...]');
    return 0;
  }
  let failed = 0;
  for (const pid of killTargets) {
    const info = infos.get(pid);
    if (!info) {
      console.error(`[dev-clean] PID ${pid} 不在扫描表中或不可读，拒绝（禁止盲 kill）。`);
      failed++;
      continue;
    }
    if (!isDevProcess(info.cmd)) {
      console.error(`[dev-clean] PID ${pid} 命令行不命中 dev 特征，拒绝：${shortCmd(info.cmd)}`);
      failed++;
      continue;
    }
    const done = killPid(pid);
    console.log(`[dev-clean] PID ${pid}（端口 ${(byPid.get(pid) ?? []).join(',')}）${done ? '已杀' : '杀失败'}`);
    if (!done) failed++;
  }
  return failed === 0 ? 0 : 1;
}

process.exit(main());
