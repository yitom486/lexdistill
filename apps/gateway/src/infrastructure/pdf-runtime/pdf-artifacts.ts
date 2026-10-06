/**
 * PDF 构建构件清单（构建时下载、校验，随 Tauri 安装包交付）。
 *
 * pdf-inspector 与 PDFium 固定版本随安装包交付；应用运行时只读加载。
 * 构建下载失败或摘要缺失时拒绝交付，用户首次使用不联网补装组件。
 *
 * Pin 来源：
 * - npm 包：registry 元数据 integrity（sha512，2026-09-06 实测抓取，1.18.0 于 2026-09-10 复核更新）；
 * - fork 1.18.2-inkdown.1：GitHub Release 实际资产直链 + 本地实测 SHA-256
 *  （2026-09-10 下载 5 个包逐个 certutil 测得；repo yitom486/pdf-inspector，
 *   tag inkdown-napi-v1.18.2-inkdown.1，资产 7 tgz + 2 源码包）；
 * - PDFium：上游 release SHA256SUMS（native-v7988，2026-09-06 实测下载比对一致）；
 */

export const PDF_INSPECTOR_VERSION = '1.18.2-inkdown.1';
const FORK_RELEASE =
  'https://github.com/yitom486/pdf-inspector/releases/download/inkdown-napi-v1.18.2-inkdown.1';

export interface NpmArtifactPin {
  url: string;
  /** registry integrity，形如 'sha512-<base64>'（fork Release 资产改用 sha256，不填此项） */
  integrity?: string;
  /** 实测 SHA-256（hex 小写；与 integrity 二选一，至少其一） */
  sha256?: string;
}

export const PDF_INSPECTOR_MAIN: NpmArtifactPin = {
  url: `${FORK_RELEASE}/firecrawl-pdf-inspector-1.18.2-inkdown.1.tgz`,
  sha256: '93643726b18cd83ba7272bfb975278a21ae2f993bcc1b6856236a5cf9d4be6ca',
};

export type PdfRuntimePlatform = 'win32-x64' | 'linux-x64' | 'darwin-arm64' | 'linux-arm64';

export interface PlatformArtifactPins {
  napiPkg: string;
  napi: NpmArtifactPin;
  /** PDFium 压缩包直链 + 官方 sha256（hex） */
  pdfiumUrl: string;
  pdfiumSha256: string;
  pdfiumLibName: string;
}

const PDFIUM_TAG = 'native-v7988';

export const PLATFORM_ARTIFACTS: Record<PdfRuntimePlatform, PlatformArtifactPins> = {
  'win32-x64': {
    napiPkg: '@firecrawl/pdf-inspector-win32-x64-msvc',
    napi: {
      url: `${FORK_RELEASE}/firecrawl-pdf-inspector-win32-x64-msvc-1.18.2-inkdown.1.tgz`,
      sha256: 'fc640402b1fea92128d5b07e128bf88a381ef57d6878eb4c8c0f2a800b060c19',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-win-x64.tgz`,
    pdfiumSha256: '6f398552d8021a89078f64466557251a204999177287b876be49877eb8750d50',
    pdfiumLibName: 'pdfium.dll',
  },
  'linux-x64': {
    napiPkg: '@firecrawl/pdf-inspector-linux-x64-gnu',
    napi: {
      url: `${FORK_RELEASE}/firecrawl-pdf-inspector-linux-x64-gnu-1.18.2-inkdown.1.tgz`,
      sha256: 'c97c858b4c6d2a818c8c50742134c2caed8b1f0dcedb271e175be98d3c2b65fd',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-linux-x64.tgz`,
    pdfiumSha256: '6248189e07bbc33cdeb31976c539a88614307c8a19f3276dbd018efbe5b4a2a2',
    pdfiumLibName: 'libpdfium.so',
  },
  'darwin-arm64': {
    napiPkg: '@firecrawl/pdf-inspector-darwin-arm64',
    napi: {
      url: `${FORK_RELEASE}/firecrawl-pdf-inspector-darwin-arm64-1.18.2-inkdown.1.tgz`,
      sha256: '6aab10a6d54bad00a1f02186e3ec1fa5ae6bc58b809cc1bff77ebebcfc8ee0f2',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-mac-arm64.tgz`,
    pdfiumSha256: '4168356c2e62ad5e79553e2e9162f5c99949759d90cb83876a50311f0c32b9b3',
    pdfiumLibName: 'libpdfium.dylib',
  },
  'linux-arm64': {
    napiPkg: '@firecrawl/pdf-inspector-linux-arm64-gnu',
    napi: {
      // 2026-09-10 补 pin（此前为空，本机 win32 未覆盖）；该平台启用前仍建议真机复核。
      url: `${FORK_RELEASE}/firecrawl-pdf-inspector-linux-arm64-gnu-1.18.2-inkdown.1.tgz`,
      sha256: 'ec636a98a8ab87a669976da643d26bed97b51d9199a55b2991b838c6dd76bb75',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-linux-arm64.tgz`,
    pdfiumSha256: '',
    pdfiumLibName: 'libpdfium.so',
  },
};

/** 允许下载的域名白名单（SSRF 防护：只认这几处官方源 + 本次 fork Release）。 */
export const ARTIFACT_HOST_ALLOWLIST = [
  'https://registry.npmjs.org/',
  'https://github.com/firecrawl/pdfium-rs/releases/download/',
  'https://github.com/yitom486/pdf-inspector/releases/download/',
] as const;

export function assertArtifactUrlAllowed(url: string): void {
  // data: URL 不经过网络（单测离线校验用），天然无 SSRF 风险
  if (url.startsWith('data:')) return;
  const ok = ARTIFACT_HOST_ALLOWLIST.some((prefix) => url.startsWith(prefix));
  if (!ok) {
    throw new Error(`artifact URL 不在白名单内，拒绝下载：${url}`);
  }
}

/** 当前进程平台 → pin 表键；不支持的平台抛错（不猜）。 */
export function currentRuntimePlatform(
  platform: string = process.platform,
  arch: string = process.arch
): PdfRuntimePlatform {
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  throw new Error(`当前平台暂无预置 PDF 运行时构件：${platform}-${arch}`);
}
