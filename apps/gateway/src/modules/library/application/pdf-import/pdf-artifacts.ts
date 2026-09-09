/**
 * PDF 导入运行时构件清单（按需下载，不进安装包）。
 *
 * 约束（用户决策 2026-09-06）：pdf-inspector 绑定、PDFium、ONNX Runtime、OCR 模型
 * 一律不打包进 Tauri 安装包 / 网关 sidecar，首次使用时由网关下载到用户数据目录
 * （STUDY_STUDIO_RUNTIME_DIR，默认用户主目录下 .study-studio/runtime），并校验完整性。
 *
 * Pin 来源：
 * - npm 包：registry 元数据 integrity（sha512，2026-09-06 实测抓取，1.18.0 于 2026-09-10 复核更新）；
 * - PDFium：上游 release SHA256SUMS（native-v7988，2026-09-06 实测下载比对一致）；
 * - ONNX Runtime：上游未给单文件摘要，仅做版本 + 域名白名单 + 体积 sanity 校验；
 * - OCR 模型：由 pdf-inspector 首次路由时自行下载并 SHA-256 校验（见其 ocr-runtime 文档）。
 */

export const PDF_INSPECTOR_VERSION = '1.18.0';
const NPM = 'https://registry.npmjs.org';

export interface NpmArtifactPin {
  url: string;
  /** registry integrity，形如 'sha512-<base64>' */
  integrity: string;
}

export const PDF_INSPECTOR_MAIN: NpmArtifactPin = {
  url: `${NPM}/@firecrawl/pdf-inspector/-/pdf-inspector-1.18.0.tgz`,
  integrity:
    'sha512-xcI7rrnTP0xxQTQ/4+aJx9ztjciRGEhB4LGjvxpy8Q6fLblf5p4EACfGMhKldZAP2YVkLWNXlFpBbX5tiB2f8w==',
};

export type PdfRuntimePlatform = 'win32-x64' | 'linux-x64' | 'darwin-arm64' | 'linux-arm64';

export interface PlatformArtifactPins {
  napiPkg: string;
  napi: NpmArtifactPin;
  /** PDFium 压缩包直链 + 官方 sha256（hex） */
  pdfiumUrl: string;
  pdfiumSha256: string;
  /** ONNX Runtime 压缩包直链（上游无单文件摘要，仅白名单 + 体积校验） */
  ortUrl: string;
  pdfiumLibName: string;
  ortLibName: string;
}

const PDFIUM_TAG = 'native-v7988';
const ORT_VERSION = '1.27.0';

export const PLATFORM_ARTIFACTS: Record<PdfRuntimePlatform, PlatformArtifactPins> = {
  'win32-x64': {
    napiPkg: '@firecrawl/pdf-inspector-win32-x64-msvc',
    napi: {
      url: `${NPM}/@firecrawl/pdf-inspector-win32-x64-msvc/-/pdf-inspector-win32-x64-msvc-1.18.0.tgz`,
      integrity:
        'sha512-5qCcPYVsBkg+xUUDsqiRvE1bVD041tqyj8WieqdD/f5G4hovMJyZdk1NEp100SMUyVDMowGfTgCkcNAsw2lCfg==',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-win-x64.tgz`,
    pdfiumSha256: '6f398552d8021a89078f64466557251a204999177287b876be49877eb8750d50',
    ortUrl: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-win-x64-${ORT_VERSION}.zip`,
    pdfiumLibName: 'pdfium.dll',
    ortLibName: 'onnxruntime.dll',
  },
  'linux-x64': {
    napiPkg: '@firecrawl/pdf-inspector-linux-x64-gnu',
    napi: {
      url: `${NPM}/@firecrawl/pdf-inspector-linux-x64-gnu/-/pdf-inspector-linux-x64-gnu-1.18.0.tgz`,
      integrity:
        'sha512-p3vqt7dzdtimGNBl2Zg8dxEOBxQJKyTXQ62cBFM0/0UJvE3TrH78UtagjCYMfdAdkSr0hW1gYAUhSsizxelJ3g==',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-linux-x64.tgz`,
    pdfiumSha256: '6248189e07bbc33cdeb31976c539a88614307c8a19f3276dbd018efbe5b4a2a2',
    ortUrl: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-x64-${ORT_VERSION}.tgz`,
    pdfiumLibName: 'libpdfium.so',
    ortLibName: 'libonnxruntime.so',
  },
  'darwin-arm64': {
    napiPkg: '@firecrawl/pdf-inspector-darwin-arm64',
    napi: {
      url: `${NPM}/@firecrawl/pdf-inspector-darwin-arm64/-/pdf-inspector-darwin-arm64-1.18.0.tgz`,
      integrity:
        'sha512-TlmPHAGc8+WTKwOXTK1+Vk4iW2svMeavwRBKL7k3eh/B1kktqtoEOfZor+hih8JrH74B8EtHkuAG6Q/8VuBIYQ==',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-mac-arm64.tgz`,
    pdfiumSha256: '4168356c2e62ad5e79553e2e9162f5c99949759d90cb83876a50311f0c32b9b3',
    ortUrl: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-osx-arm64-${ORT_VERSION}.tgz`,
    pdfiumLibName: 'libpdfium.dylib',
    ortLibName: 'libonnxruntime.dylib',
  },
  'linux-arm64': {
    napiPkg: '@firecrawl/pdf-inspector-linux-arm64-gnu',
    napi: {
      // 2026-09-10 补 pin（此前为空，本机 win32 未覆盖）；该平台启用前仍建议真机复核。
      url: `${NPM}/@firecrawl/pdf-inspector-linux-arm64-gnu/-/pdf-inspector-linux-arm64-gnu-1.18.0.tgz`,
      integrity: 'sha512-y8edzzCWSDh/bDTNzEvQjdIAA4nzHbRHi9IxQZDfjPcU7Sx/YaeAHJY6TZIyigPaNSfDMIt80J6RcTKcPwPHBA==',
    },
    pdfiumUrl: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_TAG}/firecrawl-pdfium-linux-arm64.tgz`,
    pdfiumSha256: '',
    ortUrl: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-aarch64-${ORT_VERSION}.tgz`,
    pdfiumLibName: 'libpdfium.so',
    ortLibName: 'libonnxruntime.so.1.27.0',
  },
};

/** 允许下载的域名白名单（SSRF 防护：只认这三处官方源）。 */
export const ARTIFACT_HOST_ALLOWLIST = [
  'https://registry.npmjs.org/',
  'https://github.com/firecrawl/pdfium-rs/releases/download/',
  'https://github.com/microsoft/onnxruntime/releases/download/',
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
