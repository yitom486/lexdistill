import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  isDevProcess,
  killPid,
  listWatchedListeners,
  procInfos,
  shortCmd,
} from './dev-ports.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_PORT = 3000;

/**
 * 桌面端开发环境启动器（自动完成端口 3000 预检与孤儿清理，防端口占用报错）。
 */
async function main(): Promise<number> {
  const holders = listWatchedListeners().filter((l) => l.port === WEB_PORT);
  if (holders.length > 0) {
    const infos = procInfos(holders.map((h) => h.pid));
    for (const h of holders) {
      const info = infos.get(h.pid);
      if (info && isDevProcess(info.cmd)) {
        console.log(`[dev-desktop] 发现 3000 端口残留 dev 进程 (PID ${h.pid}，${shortCmd(info.cmd)})，自动清理以避免端口冲突...`);
        killPid(h.pid);
      } else {
        console.error(`[dev-desktop] 端口 3000 被非 dev 进程占用 (PID ${h.pid})，请人工核对后重试。`);
        return 1;
      }
    }

    // 再次核验
    const remaining = listWatchedListeners().filter((l) => l.port === WEB_PORT);
    if (remaining.length > 0) {
      console.error('[dev-desktop] 端口 3000 清理后依然被占用，拒绝启动。');
      return 1;
    }
  }

  console.log('[dev-desktop] 端口 3000 核对通过，拉起 Tauri 桌面开发环境…');
  const child = spawn('bun', ['--filter', '@study-studio/desktop', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
