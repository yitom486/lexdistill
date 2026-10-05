/** Lingua Studio runs unattended workers as the desktop user, without UAC setup. */
export function backgroundCodexArgs(args: readonly string[], platform: string = process.platform): string[] {
  if (platform !== 'win32' || !args.includes('app-server')) return [...args];
  // CLI overrides follow supplied options so a user-level elevated default cannot
  // start the administrative sandbox setup helper from this background service.
  // Keep sandbox_mode and command approval policies intact.
  return [...args, '-c', 'windows.sandbox="unelevated"'];
}
