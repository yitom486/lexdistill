import { spawnSync } from 'node:child_process';

/**
 * dev 端口/进程共享库（§7 配套；被 dev-clean / dev-run 复用）。
 * 只做查询与判定，不杀进程（杀只在 dev-clean --kill / dev-run --force 的显式路径）。
 */

export const PORT_RANGES: Array<[number, number]> = [
  [3000, 3010],
  [8080, 8090],
];

/** dev 进程判定（可杀谓词的一部分；见各调用方的显式确认流程）。 */
const KILL_ALLOW = /(bun|node)(\.exe)?/i;
const DEV_HINT = /(vite|gateway|src[\\/]index\.ts|dev:web|dev-clean|\btest\b)/i;

/** 命令行命中 dev 特征（bun/node 跑 vite|gateway|index.ts|test|dev）。 */
export function isDevProcess(cmd: string): boolean {
  return DEV_HINT.test(cmd) && KILL_ALLOW.test(cmd);
}

export interface Listener {
  port: number;
  pid: number;
}

export interface ProcInfo {
  pid: number;
  ppid: number;
  born: string;
  cmd: string;
  parentAlive: boolean;
}

export function inRanges(port: number): boolean {
  return PORT_RANGES.some(([from, to]) => port >= from && port <= to);
}

export function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 15000 });
    if (r.error) return { ok: false, out: String(r.error) };
    return { ok: r.status === 0, out: String(r.stdout ?? '') };
  } catch (e) {
    return { ok: false, out: String(e) };
  }
}

export function parseJsonArray<T>(text: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as T[];
    if (parsed && typeof parsed === 'object') return [parsed as T];
  } catch {
    // 非 JSON：调用方兜底
  }
  return [];
}

function listWindows(): Listener[] {
  const ps = 'Get-NetTCPConnection -State Listen | Where-Object { ($_.LocalPort -ge 3000 -and $_.LocalPort -le 3010) -or ($_.LocalPort -ge 8080 -and $_.LocalPort -le 8090) } | Select-Object LocalPort,OwningProcess';
  const r = sh('powershell.exe', ['-NoProfile', '-Command', `ConvertTo-Json -Compress -InputObject @(${ps})`]);
  if (!r.ok) return [];
  const out: Listener[] = [];
  for (const row of parseJsonArray<{ LocalPort?: unknown; OwningProcess?: unknown }>(r.out)) {
    const port = typeof row.LocalPort === 'number' ? row.LocalPort : -1;
    const pid = typeof row.OwningProcess === 'number' ? row.OwningProcess : -1;
    if (inRanges(port) && pid > 0) out.push({ port, pid });
  }
  return out;
}

function procInfoWindows(pids: number[]): Map<number, ProcInfo> {
  const map = new Map<number, ProcInfo>();
  if (pids.length === 0) return map;
  const filter = pids.map((p) => `ProcessId = ${p}`).join(' or ');
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine`;
  const r = sh('powershell.exe', ['-NoProfile', '-Command', `ConvertTo-Json -Compress -InputObject @(${ps}) -Depth 3`]);
  if (!r.ok) return map;
  const wanted = new Set(pids);
  for (const row of parseJsonArray<Record<string, unknown>>(r.out)) {
    const pid = typeof row.ProcessId === 'number' ? row.ProcessId : -1;
    if (!wanted.has(pid)) continue;
    map.set(pid, {
      pid,
      ppid: typeof row.ParentProcessId === 'number' ? row.ParentProcessId : -1,
      born: typeof row.CreationDate === 'string' ? row.CreationDate : '?',
      cmd: typeof row.CommandLine === 'string' ? row.CommandLine : '',
      parentAlive: false,
    });
  }
  markParentsAlive(map, (batch) => {
    const pfilter = batch.map((p) => `ProcessId = ${p}`).join(' or ');
    const pr = sh('powershell.exe', ['-NoProfile', '-Command', `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "${pfilter}" | Select-Object ProcessId)`]);
    const alive = new Set<number>();
    for (const row of parseJsonArray<{ ProcessId?: unknown }>(pr.out)) {
      if (typeof row.ProcessId === 'number') alive.add(row.ProcessId);
    }
    return alive;
  });
  return map;
}

function listUnix(): Listener[] {
  const r = sh('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n']);
  const out: Listener[] = [];
  if (!r.ok) return out;
  for (const line of r.out.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    const addr = parts[8] ?? '';
    const pid = Number(parts[1]);
    const m = /:(\d+)$/.exec(addr);
    if (!m) continue;
    const port = Number(m[1]);
    if (inRanges(port) && Number.isSafeInteger(pid) && pid > 0) out.push({ port, pid });
  }
  return out;
}

function procInfoUnix(pids: number[]): Map<number, ProcInfo> {
  const map = new Map<number, ProcInfo>();
  if (pids.length === 0) return map;
  const r = sh('ps', ['-o', 'pid=,ppid=,lstart=,args=', '-p', pids.join(',')]);
  if (!r.ok) return map;
  for (const line of r.out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    map.set(pid, { pid, ppid, born: (m[3] ?? '').trim(), cmd: (m[4] ?? '').trim(), parentAlive: false });
  }
  markParentsAlive(map, (batch) => {
    const pr = sh('ps', ['-o', 'pid=', '-p', batch.join(',')]);
    const alive = new Set<number>();
    if (pr.ok) {
      for (const line of pr.out.split('\n')) {
        const n = Number(line.trim());
        if (Number.isSafeInteger(n)) alive.add(n);
      }
    }
    return alive;
  });
  return map;
}

function markParentsAlive(map: Map<number, ProcInfo>, probe: (ppids: number[]) => Set<number>): void {
  const ppids = [...new Set([...map.values()].map((p) => p.ppid))].filter((p) => p > 0);
  if (ppids.length === 0) return;
  const alive = probe(ppids);
  for (const info of map.values()) {
    info.parentAlive = alive.has(info.ppid);
  }
}

/** 列出目标端口段的监听者（只读）。 */
export function listWatchedListeners(): Listener[] {
  return process.platform === 'win32' ? listWindows() : listUnix();
}

/** 批量取进程信息（含父存活；只读）。 */
export function procInfos(pids: number[]): Map<number, ProcInfo> {
  const unique = [...new Set(pids)].filter((p) => p > 0);
  return process.platform === 'win32' ? procInfoWindows(unique) : procInfoUnix(unique);
}

/** 按 PID 杀进程（clean/run 的显式路径调用；win 用 /F，unix 先 TERM 后 KILL）。 */
export function killPid(pid: number): boolean {
  if (process.platform === 'win32') {
    // Windows 控制台进程优雅语义不可靠，清理路径用 /F（调用方已显式确认）。
    return sh('taskkill', ['/PID', String(pid), '/F']).ok;
  }
  if (sh('kill', [String(pid)]).ok) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!sh('kill', ['-0', String(pid)]).ok) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  return sh('kill', ['-9', String(pid)]).ok;
}

/** 按根 PID 杀整棵树（supervisor 退出路径；win 用 /T 带走子孙，unix 杀进程组）。 */
export function killTree(rootPid: number): boolean {
  if (process.platform === 'win32') {
    return sh('taskkill', ['/PID', String(rootPid), '/T', '/F']).ok;
  }
  if (sh('kill', ['-TERM', `-${rootPid}`]).ok) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!sh('kill', ['-0', `-${rootPid}`]).ok) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  return sh('kill', ['-KILL', `-${rootPid}`]).ok;
}

export function shortCmd(cmd: string): string {
  const one = cmd.replace(/\s+/g, ' ').trim();
  return one.length > 150 ? `${one.slice(0, 150)}…` : one;
}
