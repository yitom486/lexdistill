import { logger } from '@lexdistill/shared';
import { detectTauri } from './capabilities.js';

export interface AvailableAppUpdate {
  version: string;
  notes: string;
  install: () => Promise<void>;
}

/**
 * Check GitHub Releases through the Tauri updater plugin.
 *
 * The dynamic import keeps the browser build usable: a normal web session has
 * no Tauri updater IPC and simply skips this path.
 */
export async function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  if (!detectTauri()) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check({ timeout: 8_000 });
  if (!update) return null;

  return {
    version: update.version,
    notes: update.body ?? '',
    install: async () => {
      await update.downloadAndInstall();
      // Windows exits through the installer; macOS/Linux need an explicit relaunch.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** Startup checks are best-effort and must never interrupt an offline study session. */
export function logUpdaterFailure(error: unknown): void {
  logger.debug('[app-updater] update check/install skipped', error);
}
