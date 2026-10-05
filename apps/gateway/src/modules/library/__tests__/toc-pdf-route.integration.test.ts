import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { AgentAdapter, AgentInput, AgentSession, CreateSessionOptions } from '@study-studio/agent-runtime';
import { BusinessError, err, ok } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { fixturePdf } from './textbook-pipeline-fixtures.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';

let tocRpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `toc-${++tocRpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    await submitScope(scope, kind, requiredContent[kind]);
  }
}
async function scopeArticleDefault(scope: McpChapterScope) {
  await submitScope(scope, 'articles', { items: [{ text: '单元正文' }] });
}
import { pinProcessToTestRuntime, testRuntimeDir } from './pdf-test-runtime.js';
import { SaveTextbookOutlineResultSchema } from '@study-studio/document-model';

pinProcessToTestRuntime();
const repos: DrizzleLearnerRepository[] = [];
const sources: string[] = [];
afterEach(async () => { for (const repo of repos.splice(0)) repo.getRawDb().close(); for(const path of sources.splice(0)) await unlink(path); });
const entries = [{title:'入门单元',level:'unit',startPage:1},{title:'发音',level:'section',parentIndex:0,startPage:1},{title:'第一课',level:'lesson',parentIndex:0,startPage:2}];
function harness(proposal: unknown = {entries, tocEndPage:2, pageOffset:2}, supportsFiles = true) {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  const tool = new LibraryProposeTocTool(), toolRegistry = new ToolRegistry(); toolRegistry.register(tool);
  let input: AgentInput | undefined, options: CreateSessionOptions | undefined, filePath = '', pageCount = 0, closed = 0, closedWhileFileExisted = false;
  const adapter: AgentAdapter = {
    id:'mock-file-reader',name:'Controlled PDF directory reader',supportsLocalFileInput:()=>supportsFiles,
    createSession: async opts => {
      options=opts;
      const session: AgentSession = {sessionId:opts.sessionId,
        async *send(turn) {
          input=turn; filePath=/^当前文件：(.*)$/m.exec(turn.message)?.[1] ?? '';
          pageCount=(await PDFDocument.load(await Bun.file(filePath).bytes())).getPageCount();
          if (proposal !== null) {
            const result=await tool.execute(proposal as never,{sessionId:opts.sessionId,userId:opts.userId,callId:'proposal'});
            yield {type:'TOOL_CALL_COMPLETED',callId:'proposal',result};
            if(!result.ok){yield {type:'ERROR',error:result.error};return;}
          }
          yield {type:'COMPLETED'};
        },
        close:async()=>{closed++;closedWhileFileExisted=existsSync(filePath);return ok(undefined);},
        interrupt:async()=>ok(undefined),submitToolResult:async()=>ok(undefined),submitApproval:async()=>ok(undefined),steer:async()=>ok(undefined),
      }; return ok(session);
    },resumeSession:async()=>err(new BusinessError('E_NOT_FOUND','无历史会话','AGENT_RUNTIME')),
  };
  // The HTTP route only consumes these real domain dependencies; no provider or network mock is installed globally.
  const deps={repo,server:{agentAdapter:adapter,toolRegistry}} as GatewayDeps;
  const app=createPdfImportRoutes(deps);
  async function post(count:number,start?:number,end?:number) {
    const body=new FormData();body.set('file',new File([new Uint8Array(await fixturePdf(count))],'directory.pdf',{type:'application/pdf'}));
    if(start!==undefined)body.set('startPage',String(start));if(end!==undefined)body.set('endPage',String(end));
    body.set('model','test-small-model');body.set('effort','low');
    return app.request('/api/documents/owner/extract-toc-llm',{method:'POST',body,headers:{'X-Textbook-Trace':'file-directory'}});
  }
  return {repo,tool,app,post,get input(){return input;},get options(){return options;},get filePath(){return filePath;},get pageCount(){return pageCount;},get closed(){return closed;},get closedWhileFileExisted(){return closedWhileFileExisted;}};
}
describe('目录裁剪 PDF HTTP 闭环',()=>{
  it('未指定范围裁剪前 30 页；只开放目录工具；不发图片附件；结束后删除文件',async()=>{
    const h=harness(),response=await h.post(35);expect(response.status).toBe(200);
    const value=await response.json();expect(value.tocEndPage).toBe(2);expect(value.pageOffset).toBe(2);expect(value.entries[1].parentId).toBe('toc-1');
    expect(h.pageCount).toBe(30);expect(h.input?.attachments).toBeUndefined();expect(h.input?.turnOptions?.effort).toBe('low');
    expect(h.options?.tools?.map(item=>item.name)).toEqual(['library.propose_toc']);expect(h.options?.model).toBe('test-small-model');expect(h.options?.sandboxMode).toBe('workspace-write');
    expect(h.closed).toBe(1);expect(h.closedWhileFileExisted).toBe(true);expect(existsSync(h.filePath)).toBe(false);
  },30000);
  it('不足 30 页取实际页数；显式目录范围取指定页而非默认窗',async()=>{
    const short=harness();expect((await short.post(4)).status).toBe(200);expect(short.pageCount).toBe(4);
    const selected=harness({entries,tocEndPage:33});expect((await selected.post(40,31,33)).status).toBe(200);expect(selected.pageCount).toBe(3);expect(selected.input?.message).toContain('物理页 31、32、33');
  },30000);
  it('父子层级经草稿、目录保存、章节暂存贯通到 SQLite',async()=>{
    const h=harness(),response=await h.post(5),proposal=await response.json();
    const filePath=join(testRuntimeDir(),`toc-source-${crypto.randomUUID()}.pdf`); sources.push(filePath); await writeFile(filePath,await fixturePdf(5));
    const saved=await h.app.request('/api/documents/owner/textbook-outline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath,title:'层级教材',language:'ja',tocEntries:proposal.entries.map((entry:{startPage:number})=>({...entry,startPage:entry.startPage+2}))})});
    expect(saved.status).toBe(200);const outline=SaveTextbookOutlineResultSchema.parse(await saved.json());expect(outline.entries[1]?.parentId).toBe(outline.entries[0]?.id);
    const harnessScripts = new Map<string, ChapterScript>([[outline.entries[0]!.id, async (scope) => {
      await scopeArticleDefault(scope);
      await submitRequiredScope(scope);
    }]]);
    const contentHarness = harnessInjection(h.repo, harnessScripts);
    const completed = await h.repo.executeTextbookPipeline({ userId: 'owner', documentId: outline.documentId, title: outline.title, tocEntries: outline.entries, lessonJobs: [{ lessonId: outline.entries[0]!.id, text: '当前单元内容' }], poolSize: 1, ...contentHarness.extra });
    expect(completed.ok && completed.value.allLessonsReady).toBe(true);
    expect(contentHarness.driver.asks[0]).toContain('  - 发音');
  },30000);
  it('目录缺失、非法层级、倒退页码不保存；无文件能力返回友好错误',async()=>{
    for(const proposal of [null,{entries},{tocEndPage:2,entries:[{title:'坏目录',level:'unknown',startPage:1}]},{tocEndPage:2,entries:[{title:'第二课',level:'lesson',startPage:2},{title:'第一课',level:'lesson',startPage:1}]}]) {
      const h=harness(proposal);expect((await h.post(4)).status).toBeGreaterThanOrEqual(400);expect(h.closed).toBe(1);expect(existsSync(h.filePath)).toBe(false);
      const list=await h.repo.listDocuments('owner');expect(list.ok && list.value).toEqual([]);
    }
    const unsupported=harness(undefined,false);expect((await unsupported.post(4)).status).toBeGreaterThanOrEqual(400);expect(unsupported.options).toBeUndefined();
  },30000);
  it('实际目录末页必须在提供范围内；越界裁剪不启动模型',async()=>{
    const h=harness({entries,tocEndPage:30});expect((await h.post(4)).status).toBeGreaterThanOrEqual(400);
    const invalid=harness();expect((await invalid.post(4,5,6)).status).toBeGreaterThanOrEqual(400);expect(invalid.options).toBeUndefined();
  },30000);
  it('残缺、倒退、小数或异常巨大页码均拒绝，不默默使用前 30 页',async()=>{
    for(const range of [[1,undefined],[undefined,2],[2,1],[1.5,2],[0,2],[1,Number.MAX_SAFE_INTEGER]] as const) {
      const h=harness(); expect((await h.post(4,...range)).status).toBe(400); expect(h.options).toBeUndefined();
    }
  });
});
