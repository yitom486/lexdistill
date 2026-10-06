import { homedir } from 'node:os';
import path from 'node:path';

/**
 * 应用数据目录解析（基础设施，无领域依赖）。
 * STUDY_STUDIO_RUNTIME_DIR 覆盖；缺省用户主目录 ~/.study-studio。
 */
export function defaultAppDataDir(): string {
  return path.join(homedir(), '.study-studio');
}

/** 用户可写数据目录（媒体、Agent 临时任务），独立于安装包中的只读 PDF 组件。 */
export function defaultRuntimeDir(): string {
  const override = process.env.STUDY_STUDIO_RUNTIME_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(defaultAppDataDir(), 'runtime');
}

/** 用户媒体库目录（词典/Anki 图片音频落盘；SQLite 只存路径与哈希）。 */
export function defaultMediaDir(runtimeDir?: string): string {
  return path.join(runtimeDir ?? defaultRuntimeDir(), 'media');
}
