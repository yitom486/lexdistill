import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');
const APP_NAME = 'LexDistill';

type JsonObject = Record<string, unknown>;

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`命令执行失败：${command} ${args.join(' ')}\n${detail}`);
  }
}

function readJson(path: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`JSON 根节点必须是对象：${relative(ROOT, path)}`);
  }
  return value as JsonObject;
}

function writeJson(path: string, value: JsonObject): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function packageJsonPaths(): string[] {
  const paths = [join(ROOT, 'package.json')];
  for (const workspace of ['apps', 'packages']) {
    const directory = join(ROOT, workspace);
    for (const name of readdirSync(directory)) {
      const path = join(directory, name, 'package.json');
      if (existsSync(path)) paths.push(path);
    }
  }
  return paths;
}

function assertVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`版本号必须是 SemVer，例如 0.1.0：${version}`);
  }
}

function currentVersion(): string {
  const root = readJson(join(ROOT, 'package.json'));
  const version = root.version;
  if (typeof version !== 'string') throw new Error('根 package.json 缺少 version');
  return version;
}

function generatedEntry(version: string): string {
  const previousTag = run('git', ['tag', '--sort=-version:refname'])
    .split(/\r?\n/)
    .find((tag) => tag.length > 0);
  const logRange = previousTag ? `${previousTag}..HEAD` : 'HEAD';
  const commits = run('git', ['log', logRange, '--pretty=format:- %s', '--no-merges']);
  const details = commits || '- 稳定性、构建与发布流程改进。';
  const today = new Date().toISOString().slice(0, 10);
  return `## [${version}] - ${today}\n\n### Changed\n\n${details}\n\n`;
}

function ensureChangelogEntry(version: string): void {
  const contents = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, 'utf8') : '';
  if (contents.includes(`## [${version}]`)) return;
  const marker = '\n## ';
  const index = contents.indexOf(marker);
  const entry = generatedEntry(version);
  const next = index >= 0 ? `${contents.slice(0, index)}\n${entry}${contents.slice(index + 1)}` : `${contents.trimEnd()}\n\n${entry}`;
  writeFileSync(CHANGELOG_PATH, `${next.trimEnd()}\n`, 'utf8');
}

async function syncVersion(version: string): Promise<void> {
  assertVersion(version);
  for (const path of packageJsonPaths()) {
    const json = readJson(path);
    json.version = version;
    writeJson(path, json);
  }

  const tauriConfigPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
  const tauriConfig = readJson(tauriConfigPath);
  tauriConfig.version = version;
  writeJson(tauriConfigPath, tauriConfig);

  const cargoPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
  const cargo = await Bun.file(cargoPath).text();
  if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) throw new Error('Cargo.toml 未找到顶层 package version');
  const cargoNext = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  if (cargo !== cargoNext) await Bun.write(cargoPath, cargoNext);

  const lockPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.lock');
  if (existsSync(lockPath)) {
    const lock = await Bun.file(lockPath).text();
    const lockNext = lock.replace(
      /(name\s*=\s*"lexdistill-desktop"\r?\nversion\s*=\s*")[^"]+("\s*\r?\n)/,
      `$1${version}$2`
    );
    if (lock !== lockNext) await Bun.write(lockPath, lockNext);
  }

  ensureChangelogEntry(version);
  console.log(`版本已同步为 ${version}`);
}

async function changelogNotes(version: string): Promise<string> {
  const contents = await Bun.file(CHANGELOG_PATH).text();
  const heading = `## [${version}]`;
  const start = contents.indexOf(heading);
  if (start < 0) throw new Error(`CHANGELOG.md 缺少 ${heading} 条目`);
  const rest = contents.slice(start);
  const nextHeading = rest.indexOf('\n## ', heading.length);
  return (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
}

async function publish(version: string): Promise<void> {
  await syncVersion(version);
  console.log('正在执行发布前校验：typecheck');
  run(process.execPath, ['run', 'typecheck']);
  console.log('正在执行发布前校验：test');
  run(process.execPath, ['test']);

  const status = run('git', ['status', '--short']);
  if (!status) throw new Error('没有需要发布的变更。');
  if (run('git', ['tag', '--list', `v${version}`])) {
    throw new Error(`标签 v${version} 已存在，避免覆盖已有发布。`);
  }

  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `chore(release): v${version}`]);
  run('git', ['tag', '-a', `v${version}`, '-m', `${APP_NAME} v${version}`]);
  run('git', ['push', 'origin', 'HEAD', '--follow-tags']);
  console.log(`已推送 v${version}。GitHub Actions 将构建并发布多平台安装包。`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  if (command === 'sync') {
    await syncVersion(process.argv[3] ?? Bun.env.RELEASE_VERSION ?? currentVersion());
    return;
  }
  if (command === 'notes') {
    const notes = await changelogNotes(process.argv[3] ?? Bun.env.RELEASE_VERSION ?? currentVersion());
    console.log(notes);
    return;
  }
  if (command === 'publish') {
    await publish(process.argv[3] ?? Bun.env.RELEASE_VERSION ?? currentVersion());
    return;
  }
  console.log('用法：bun run release:sync -- 0.1.0 | bun run release -- 0.1.0');
}

await main();
