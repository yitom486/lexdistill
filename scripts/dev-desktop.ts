import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  isDevProcess,
  killPid,
  listWatchedListeners,
  procInfos,
  sh,
  shortCmd,
} from './dev-ports.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_PORT = 3000;

function cleanupStaleDesktopProcesses(): void {
  try {
    if (process.platform === 'win32') {
      const r = sh('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-Process -Name "lexdistill-desktop", "lexdistill-desktop" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id',
      ]);
      if (r.ok && r.out.trim()) {
        const pids = r.out.trim().split(/\s+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
        for (const pid of pids) {
          console.log(`[dev-desktop] 发现历史残留桌面进程 (PID ${pid})，自动清理以避免 WebView2 单实例冲突...`);
          killPid(pid);
        }
      }
    }
  } catch {
    // ignore
  }
}

/**
 * 寻找第一个可用的前端 Web 端口（支持在 3000-3010 范围内自动感知与顺延对齐）。
 */
function resolveAvailableWebPort(): number | null {
  const WEB_PORT_BASE = 3000;
  const WEB_PORT_MAX = 3010;
  const listeners = listWatchedListeners();
  const infos = procInfos(listeners.map((l) => l.pid));

  for (let port = WEB_PORT_BASE; port <= WEB_PORT_MAX; port++) {
    const holders = listeners.filter((l) => l.port === port);
    if (holders.length === 0) {
      return port;
    }

    // 检查占用者是否为本项目的残留 dev 进程
    let allKilled = true;
    for (const h of holders) {
      const info = infos.get(h.pid);
      if (info && isDevProcess(info.cmd)) {
        console.log(`[dev-desktop] 发现端口 ${port} 残留 dev 进程 (PID ${h.pid}，${shortCmd(info.cmd)})，自动清理以复用端口...`);
        killPid(h.pid);
      } else {
        allKilled = false;
        console.log(`[dev-desktop] 端口 ${port} 被非 dev 进程占用 (PID ${h.pid}${info ? ` ${shortCmd(info.cmd)}` : ''})，顺延探测下一个端口...`);
        break;
      }
    }

    if (allKilled) {
      // 再次核验该端口是否已完全释放
      const remaining = listWatchedListeners().filter((l) => l.port === port);
      if (remaining.length === 0) {
        return port;
      }
    }
  }

  return null;
}

/**
 * 桌面端开发环境启动器（自动完成端口协调顺延、devUrl 同步与孤儿清理）。
 */
async function main(): Promise<number> {
  cleanupStaleDesktopProcesses();

  const chosenPort = resolveAvailableWebPort();
  if (chosenPort === null) {
    console.error('[dev-desktop] 端口 3000-3010 均被占用，无法找到可用端口，请人工核对后重试。');
    return 1;
  }

  const isDefaultPort = chosenPort === WEB_PORT;
  if (isDefaultPort) {
    console.log(`[dev-desktop] 端口 ${chosenPort} 核对通过，拉起 Tauri 桌面开发环境…`);
  } else {
    console.log(`[dev-desktop] 端口 ${WEB_PORT} 忙碌，自动顺延对齐至端口 ${chosenPort}（Tauri devUrl 与 Vite 自动同步）…`);
  }

  const tempConfigFile = join(ROOT, 'apps', 'desktop', '.dev-port-override.json');
  const cleanupTempConfig = () => {
    try {
      if (existsSync(tempConfigFile)) {
        unlinkSync(tempConfigFile);
      }
    } catch {
      // ignore
    }
  };

  if (!isDefaultPort) {
    writeFileSync(
      tempConfigFile,
      JSON.stringify(
        {
          build: {
            devUrl: `http://localhost:${chosenPort}`,
          },
        },
        null,
        2
      )
    );
  }

  const tauriArgs = ['--filter', '@lexdistill/desktop', 'dev'];
  if (!isDefaultPort) {
    tauriArgs.push('--', '-c', '.dev-port-override.json');
  }

  const child = spawn('bun', tauriArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_PORT: String(chosenPort),
      PORT: String(chosenPort),
    },
  });

  process.on('SIGINT', () => {
    cleanupTempConfig();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupTempConfig();
    process.exit(143);
  });
  process.on('exit', () => {
    cleanupTempConfig();
  });

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      cleanupTempConfig();
      resolve(code ?? 0);
    });
  });
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
