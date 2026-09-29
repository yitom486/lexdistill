import { describe, expect, it } from 'bun:test';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();
const runtime = await ensurePdfTestRuntime();
const fixtureUrl = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);

describe('目录页原生 PNG 渲染', () => {
  it('当前 pin 的 pdf-inspector 可将选中物理页渲染为完整 PNG', async () => {
    const bytes = new Uint8Array(await Bun.file(fixtureUrl).arrayBuffer());
    const render = runtime.inspector.renderPdfPages;
    expect(render).toBeDefined();
    if (!render) throw new Error('当前 pin 的 pdf-inspector 缺少 renderPdfPages');
    const pages = await render(bytes, [1, 2]);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    for (const page of pages) {
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      expect(Array.from(page.png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
});
