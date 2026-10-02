import { expect, it } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { createMineruParser } from '../../../infrastructure/mineru/parser.js';
import { MineruHttpClient } from '../../../infrastructure/mineru/http-client.js';
import { TextbookPipelineSettingsSchema } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { fixturePdf, fixturePng, pipelineModel } from './textbook-pipeline-fixtures.js';
import { modelZip } from './mineru-http-fixtures.js';

it('云端真实 HTTP 上传章节 PDF、轮询和下载重试，既有任务复用后工具提交到真实 SQLite', async () => {
  let created = 0, uploaded = 0, downloads = 0, polls = 0;
  const notes: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/v4/file-urls/batch') {
      expect(request.headers.get('Authorization')).toBe('Bearer test-cloud-key');
      expect(await request.json()).toMatchObject({ model_version: 'vlm', enable_table: true, language: 'ch' });
      created++; return Response.json({ code: 0, data: { batch_id: 'test-batch', file_urls: [new URL('/upload', request.url).href] } });
    }
    if (path === '/upload') {
      expect(request.headers.get('Authorization')).toBeNull();
      expect(request.headers.get('Content-Type')).toBeNull();
      expect((await PDFDocument.load(await request.arrayBuffer())).getPageCount()).toBe(2);
      uploaded++; return new Response(null, { status: 200 });
    }
    if (path.includes('/extract-results/')) {
      polls++;
      return Response.json({ code: 0, data: { extract_result: [{ state: polls === 1 ? 'waiting-file' : 'done', ...(polls > 1 ? { full_zip_url: new URL('/result', request.url).href } : {}) }] } });
    }
    if (path === '/result') {
      if (++downloads === 1) return new Response('temporary', { status: 503 });
      return new Response(new Uint8Array(modelZip([[{ type: 'table', content: '<table><tr><td>页甲</td></tr></table>' }], [{ type: 'text', content: '页乙' }]])).buffer);
    }
    return new Response(null, { status: 404 });
  } });
  const repo = new DrizzleLearnerRepository(':memory:');
  try {
    const settings = TextbookPipelineSettingsSchema.parse({ parserBackend: 'mineru-cloud', parsePollIntervalMs: 10, parseRetries: 1, poolSize: 1 });
    const parser = createMineruParser(settings, { cloudBaseUrl: server.url.href, cloudToken: 'test-cloud-key' });
    const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
    const result = await repo.executeTextbookPipeline({ ...settings, userId: 'http-owner', documentId: 'http-book', title: 'HTTP 集成验证',
      tocEntries: [{ id: 'part', title: '章节', level: 'lesson', startPage: 2, endPage: 3 }], pdf: await fixturePdf(4),
      inspector: { processPdf: () => ({ markdown: '', pagesNeedingOcr: [2, 3] }), processPdfWithOcr: async () => { throw new Error('旧 OCR 不得被调用'); }, renderPdfPages: async (_pdf, pages) => pages.map(pageNumber => ({ pageNumber, png: fixturePng, width: 1, height: 1 })) },
      chapterParser: { parse: (pdf, pages, signal, note) => parser.parse(pdf, pages, signal, (name, detail) => { notes.push(name); note(name, detail); }) },
      adapter: model.adapter, submissionTool: tool });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect([created, uploaded, polls, downloads]).toEqual([1, 1, 2, 2]);
    expect(notes).toContain('parse_resumed');
    expect(model.inputs[0]?.input.message).toContain('页甲'); expect(model.inputs[0]?.input.message).not.toContain('p2b0');
    expect((await repo.getTextbookAssetStats('http-book')).ok).toBe(true);
  } finally { repo.getRawDb().close(); await server.stop(true); }
});

it('云端限流、无效 Token、损坏解析包与页数漂移不进入模型、不污染章节内容', async () => {
  let mode: 'rate' | 'token' | 'zip' | 'pages' = 'rate';
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/v4/file-urls/batch') {
      if (mode === 'rate') return new Response(null, { status: 429 });
      if (mode === 'token') return Response.json({ code: 'A0202' });
      return Response.json({ code: 0, data: { batch_id: mode, file_urls: [new URL('/upload', request.url).href] } });
    }
    if (path === '/upload') return new Response();
    if (path === '/result') return mode === 'zip' ? new Response('broken zip') : new Response(new Uint8Array(modelZip([])).buffer);
    return Response.json({ code: 0, data: { extract_result: [{ state: 'done', full_zip_url: new URL('/result', request.url).href }] } });
  } });
  const repo = new DrizzleLearnerRepository(':memory:');
  try {
    const pdf = await fixturePdf(1), settings = TextbookPipelineSettingsSchema.parse({ parserBackend: 'mineru-cloud', parseRetries: 0, poolSize: 1 });
    for (const fault of ['rate', 'token', 'zip', 'pages'] as const) {
      mode = fault;
      const parser = createMineruParser(settings, { cloudBaseUrl: server.url.href, cloudToken: 'test-key' });
      const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
      const result = await repo.executeTextbookPipeline({ ...settings, userId: 'fault-owner', documentId: 'fault-' + fault, title: '解析故障验证', pdf,
        tocEntries: [{ id: 'part', title: '章节', level: 'lesson', startPage: 1, endPage: 1 }], chapterParser: parser,
        inspector: { processPdf: () => ({ markdown: '', pagesNeedingOcr: [1] }), processPdfWithOcr: async () => { throw new Error('不得降级为旧 OCR'); } },
        adapter: model.adapter, submissionTool: tool });
      expect(result.ok && result.value.failedLessons).toBe(1); expect(model.inputs).toHaveLength(0);
      const stats = await repo.getTextbookAssetStats('fault-' + fault);
      expect(stats.ok && stats.value.readyLessons).toBe(0); expect(stats.ok && stats.value.lines).toBe(0);
    }
  } finally { repo.getRawDb().close(); await server.stop(true); }
});

it('本地 V1 上传、完成确认、Standard 任务和重定向文件返回原书物理页，不调用云端', async () => {
  let submitted = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('Authorization')).toBe('Bearer test-local-key');
    const path = new URL(request.url).pathname;
    if (path === '/v1/health') return Response.json({ features: { output_formats: ['structured_content'] } });
    if (path === '/v1/uploads') return Response.json({ id: 'upload', status: 'pending', upload_url: '/bytes', upload_method: 'PUT' });
    if (path === '/bytes') { expect((await PDFDocument.load(await request.arrayBuffer())).getPageCount()).toBe(1); return new Response(); }
    if (path === '/v1/uploads/upload/complete') return Response.json({ status: 'completed', file: { id: 'input' } });
    if (path === '/v1/parse/jobs') { expect(await request.json()).toEqual({ files: [{ source: { type: 'file_id', file_id: 'input' } }], tier: 'standard', output_formats: ['structured_content'] }); submitted++; return Response.json({ job_id: 'job', status: 'queued' }); }
    if (path === '/v1/parse/jobs/job') return Response.json({ job_id: 'job', status: 'completed', files: [{ status: 'completed', output_files: { structured_content: { file_id: 'output' } } }] });
    if (path === '/v1/files/output/content') return new Response(null, { status: 302, headers: { Location: '/artifact' } });
    if (path === '/artifact') return Response.json({ pages: [{ page_idx: 0, blocks: [{ type: 'text', content: '本地章节' }] }] });
    return new Response(null, { status: 404 });
  } });
  try {
    const parser = createMineruParser(TextbookPipelineSettingsSchema.parse({ parserBackend: 'mineru-local', mineruLocalUrl: server.url.href, parsePollIntervalMs: 10 }), { localToken: 'test-local-key' });
    const source = await parser.parse(await fixturePdf(1), [12], new AbortController().signal, () => {});
    expect(source).toEqual({ parser: 'mineru-local', blocks: [{ id: 'p12b0', page: 12, kind: 'TEXT', text: '本地章节' }] });
    expect(submitted).toBe(1);
  } finally { await server.stop(true); }
});

it('拒绝异常回执和权限失败，轮询有明确超时且继续同一任务，取消不会继续提交', async () => {
  let mode: 'unauthorized' | 'invalid' | 'pending' = 'unauthorized', created = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (mode === 'unauthorized') return new Response(null, { status: 401 });
    if (mode === 'invalid') return Response.json({ code: 0, data: { batch_id: null } });
    if (path === '/api/v4/file-urls/batch') { created++; return Response.json({ code: 0, data: { batch_id: 'waiting', file_urls: [new URL('/upload', request.url).href] } }); }
    if (path === '/upload') return new Response();
    return Response.json({ code: 0, data: { extract_result: [{ state: 'pending' }] } });
  } });
  try {
    const parser = createMineruParser(TextbookPipelineSettingsSchema.parse({ parserBackend: 'mineru-cloud', parseTimeoutMs: 100, parsePollIntervalMs: 10 }), { cloudBaseUrl: server.url.href, cloudToken: 'test-key' });
    const pdf = await fixturePdf(1), signal = new AbortController().signal, note = () => {};
    await expect(parser.parse(pdf, [5], signal, note)).rejects.toMatchObject({ code: 'E_MINERU_HTTP', retryable: false });
    mode = 'invalid'; await expect(parser.parse(pdf, [5], signal, note)).rejects.toMatchObject({ code: 'E_MINERU_RESPONSE_INVALID' });
    mode = 'pending'; await expect(parser.parse(pdf, [5], signal, note)).rejects.toMatchObject({ code: 'E_MINERU_TIMEOUT', retryable: true });
    await expect(parser.parse(pdf, [5], signal, note)).rejects.toMatchObject({ code: 'E_MINERU_TIMEOUT' });
    expect(created).toBe(1);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(parser.parse(pdf, [5], cancelled.signal, note)).rejects.toMatchObject({ code: 'E_CANCELLED' });
    expect(created).toBe(1);
    const client = new MineruHttpClient(server.url.href, 'test-key', signal);
    expect(client.auth('https://example.com/file')).toEqual({});
    expect(() => client.allowed('https://example.com/file')).toThrow();
  } finally { await server.stop(true); }
});
