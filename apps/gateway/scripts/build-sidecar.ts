/**
 * 编译 Gateway 为 Tauri sidecar 独立二进制。
 * 运行：bun scripts/build-sidecar.ts
 * 产物：apps/desktop/src-tauri/binaries/study-studio-gateway-<target-triple>[.exe]
 * （与 tauri.conf.json `bundle.externalBin` 的 `binaries/study-studio-gateway` 对应；
 * 运行时由桌面壳经 STUDY_STUDIO_DB / GATEWAY_PORT 环境变量指定库路径与端口）。
 */
import { dirname, join } from 'node:path';
import { preparePdfRuntime } from '../src/infrastructure/pdf-runtime/pdf-runtime-provision.js';

const TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

const key = `${process.platform}-${process.arch}`;
const triple = TRIPLES[key];
if (!triple) {
  console.error(`unsupported platform for sidecar build: ${key}`);
  process.exit(1);
}

const ext = process.platform === 'win32' ? '.exe' : '';
const outfile = Bun.fileURLToPath(
  new URL(`../../desktop/src-tauri/binaries/study-studio-gateway-${triple}${ext}`, import.meta.url)
);



await preparePdfRuntime({
  runtimeDir: Bun.fileURLToPath(new URL('../../desktop/src-tauri/resources/pdf-runtime/', import.meta.url)),
});

function toJavaScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * jsdom -> css-tree 使用 createRequire() 动态加载 data/patch.json。
 * Bun 的 compile 模式无法从这个动态 require 推断资源依赖，导致 sidecar
 * 启动时在虚拟 BUN root 中报 Cannot find module '../data/patch.json'。
 * 构建阶段把该只读依赖内联为 JS 模块，运行时不再依赖 node_modules 文件。
 */
const inlineCssTreePatchPlugin = {
  name: 'inline-css-tree-data-patch',
  setup(build: { onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => Promise<unknown>) => void }) {
    build.onLoad(
      { filter: /[\\/]jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]css[\\/]helpers[\\/]computed-style\.js$/ },
      async (args) => {
        const stylesheetPath = join(dirname(args.path), '..', '..', '..', 'browser', 'default-stylesheet.css');
        const stylesheet = await Bun.file(stylesheetPath).text();
        let contents = await Bun.file(args.path).text();
        contents = contents.replace(
          /const defaultStyleSheet = fs\.readFileSync\([\s\S]*?\);/,
          `const defaultStyleSheet = ${toJavaScriptLiteral(stylesheet)};`,
        );
        return { contents, loader: 'js' };
      },
    );

    build.onLoad(
      { filter: /[\\/]css-tree[\\/](?:lib[\\/]data-patch\.js|cjs[\\/]data-patch\.cjs)$/ },
      async (args) => {
        const patchPath = join(dirname(args.path), '..', 'data', 'patch.json');
        const patch = await Bun.file(patchPath).json();
        const isCommonJs = /[\\/]cjs[\\/]/.test(args.path);
        return {
          contents: isCommonJs
            ? `module.exports = ${toJavaScriptLiteral(patch)};`
            : `export default ${toJavaScriptLiteral(patch)};`,
          loader: 'js',
        };
      },
    );

    build.onLoad(
      { filter: /[\\/]css-tree[\\/]lib[\\/]data\.js$/ },
      async (args) => {
        let contents = await Bun.file(args.path).text();
        const cssTreeNodeModules = join(dirname(args.path), '..', '..');
        const mdnDataRoot = join(cssTreeNodeModules, 'mdn-data', 'css');
        const dataFiles = [
          ['at-rules', 'mdnAtrules'],
          ['properties', 'mdnProperties'],
          ['syntaxes', 'mdnSyntaxes'],
        ] as const;
        for (const [fileName, variableName] of dataFiles) {
          const json = await Bun.file(join(mdnDataRoot, `${fileName}.json`)).json();
          contents = contents.replace(
            new RegExp(`const ${variableName} = require\\('mdn-data/css/${fileName}\\.json'\\);`),
            () => `const ${variableName} = ${toJavaScriptLiteral(json)};`,
          );
        }
        return { contents, loader: 'js' };
      },
    );

    build.onLoad(
      { filter: /[\\/]css-tree[\\/]lib[\\/]version\.js$/ },
      async (args) => {
        const packageJson = await Bun.file(join(dirname(args.path), '..', 'package.json')).json();
        const version =
          typeof packageJson === 'object' &&
          packageJson !== null &&
          'version' in packageJson &&
          typeof packageJson.version === 'string'
            ? packageJson.version
            : '0.0.0';
        return { contents: `export const version = ${toJavaScriptLiteral(version)};`, loader: 'js' };
      },
    );
  },
};

const result = await Bun.build({
  entrypoints: [Bun.fileURLToPath(new URL('../src/sidecar.ts', import.meta.url))],
  plugins: [inlineCssTreePatchPlugin],
  compile: { outfile },
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`study-studio-gateway sidecar built: ${outfile}`);
