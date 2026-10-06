import { expect, it } from 'bun:test';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testRuntimeDir } from './pdf-test-runtime.js';

it('编译后的程序在移动后的中文安装目录断网解析并渲染真实 PDF', async () => {
  const root = await fsp.mkdtemp(join(tmpdir(), 'lingua-installed-pdf-'));
  try {
    const installed = join(root, '安装目录 with spaces', 'pdf-runtime');
    await fsp.mkdir(installed, { recursive: true });
    for (const name of ['node_modules', 'pdfium', 'manifest.json']) {
      await fsp.cp(join(testRuntimeDir(), name), join(installed, name), { recursive: true });
    }
    const modulePath = resolve(import.meta.dir, '../../../infrastructure/pdf-runtime/pdf-runtime.ts').replaceAll('\\', '/');
    const entry = join(root, 'probe.ts');
    await fsp.writeFile(entry, `
      import { ensurePdfRuntime } from ${JSON.stringify(modulePath)};
      globalThis.fetch = () => { throw new Error('runtime must not download'); };
      const { inspector } = await ensurePdfRuntime({ needPdfium: true });
      const bytes = await Bun.file(process.argv[2]).bytes();
      const result = inspector.processPdf(bytes);
      const pages = await inspector.renderPdfPages(bytes, [1], { dpi: 72 });
      if (pages.length !== 1 || pages[0].png[0] !== 137) throw new Error('native rendering failed');
      console.log(JSON.stringify({ pdfType: result.pdfType, pages: pages.length }));
    `);
    const outfile = join(root, process.platform === 'win32' ? 'probe.exe' : 'probe');
    const build = await Bun.build({ entrypoints: [entry], compile: { outfile } });
    expect(build.success).toBe(true);
    if (!build.success) throw new Error(build.logs.map(String).join('\n'));
    const manifest = join(installed, 'manifest.json');
    const before = await fsp.stat(manifest);
    const child = Bun.spawn([outfile, resolve(import.meta.dir, 'fixtures/scanned-lesson-dialect.pdf')], {
      env: { ...process.env, STUDY_STUDIO_PDF_RUNTIME_DIR: installed }, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`installed PDF probe failed: ${stderr}`);
    expect(JSON.parse(stdout)).toEqual({ pdfType: 'Scanned', pages: 1 });
    expect((await fsp.stat(manifest)).mtimeMs).toBe(before.mtimeMs);
  } finally {
    // 子进程已退出，Windows 原生库锁已释放；只清理本测试新建的临时目录。
    await fsp.rm(root, { recursive: true, force: true });
  }
}, 60000);
