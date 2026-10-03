import { afterEach, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { fixturePdf, fixturePng, pipelineModel, deferred } from './textbook-pipeline-fixtures.js';
import { TextbookPipelineSettingsSchema } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { renderLessonImages } from '../application/pdf-import/lesson-page-images.js';
let repo:DrizzleLearnerRepository|undefined;
afterEach(()=>{repo?.getRawDb().close();repo=undefined;});
it('超过十页的扫描章节完整传图片，子标题不拆课，工具内容暂存后一次保存',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo);
 const batches: number[][] = [];
 const model=pipelineModel(tool,async({input,submit})=>{
  expect(input.attachments).toHaveLength(11);expect(input.message).toContain('本课共 11 张页面图片');
  expect(input.message).toContain('  - 对话');
  expect(input.attachments?.every(image => image.png === fixturePng)).toBe(true);
  expect(input.message).not.toContain('"page"');expect(input.message).not.toContain('"id"');
  expect((await submit({items:[{text:'可学习的完整正文'}]})).ok).toBe(true);
  const staged = await repo!.getTextbookAssetStats('book'); expect(staged.ok && staged.value.lines).toBe(0);
  expect((await submit({items:[{title:'问候',explanation:'初次见面用はじめまして。'}]},'grammar')).ok).toBe(true);
 });
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'长章',tocEntries:[{id:'a',title:'完整章节',level:'lesson',startPage:1,endPage:11},{id:'child',title:'对话',parentId:'a',level:'section',startPage:2}],pdf:await fixturePdf(11),adapter:model.adapter,submissionTool:tool,poolSize:1,modelRetries:0,
  inspector:scanned(async(_,pages,options)=>{expect(options?.dpi).toBe(200);batches.push([...pages]);return pages.map(pageImage);}),
  chapterParser:{parse:async()=>{throw new Error('不应 MinerU');}}});
 expect(batches).toEqual([[1,2,3,4,5,6,7,8],[9,10,11]]);
 expect(result.ok&&result.value.allLessonsReady).toBe(true);
 const saved=await repo.getTextbookAssetStats('book');expect(saved.ok&&saved.value).toMatchObject({lines:1,grammar:1,lessons:1});
 expect(model.closed).toHaveLength(1);
});

const pageImage = (pageNumber: number) => ({ pageNumber, png: fixturePng, width: 1, height: 1 });
const scanned = (render: NonNullable<PdfInspectorLike['renderPdfPages']>): PdfInspectorLike => ({
 processPdf: () => ({ markdown: '', pagesNeedingOcr: [1] }),
 processPdfWithOcr: async () => { throw new Error('读图路径不应调用 OCR'); }, renderPdfPages: render,
});

it('默认六路并发，每课独立线程和材料，七课全部保存并关闭会话',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo),release=deferred();let active=0,peak=0;
 const model=pipelineModel(tool,async({input,submit})=>{
  active++;peak=Math.max(peak,active);if(active===6)release.resolve();await release.promise;
  const chapter=/^章节: (.+)$/m.exec(input.message)![1]!;
  expect(input.attachments).toHaveLength(1);
  for(let i=0;i<7;i++)if(chapter!==`课程${i}`)expect(input.message).not.toContain(`课程${i}`);
  expect((await submit({items:[{text:chapter}]})).ok).toBe(true);active--;
 });
 expect(TextbookPipelineSettingsSchema.parse({})).toMatchObject({poolSize:6,parserBackend:'model-vision'});
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'并发书',
  tocEntries:Array.from({length:7},(_,i)=>({id:`c${i}`,title:`课程${i}`,level:'lesson' as const,startPage:i+1})),
  pdf:await fixturePdf(7),adapter:model.adapter,submissionTool:tool,modelRetries:0,inspector:scanned(async(_,pages)=>pages.map(pageImage))});
 expect(result.ok&&result.value.successfulLessons).toBe(7);expect(peak).toBe(6);
 expect(model.created).toHaveLength(7);expect(new Set(model.inputs.map(input=>input.sessionId)).size).toBe(7);expect(model.closed).toHaveLength(7);
 const saved=await repo.getTextbookAssetStats('book');expect(saved.ok&&saved.value).toMatchObject({readyLessons:7,lines:7});
});

it('同课未提交内容后重试保留线程、图片和修正信息',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo);let turns=0;
 const model=pipelineModel(tool,async({input,submit})=>{
  expect(input.attachments).toHaveLength(1);if(++turns===1)return;
  expect(input.message).toContain('上次未完成的原因');expect((await submit({items:[{text:'修正内容'}]})).ok).toBe(true);
 });
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'重试',tocEntries:[{id:'a',title:'本课',level:'lesson',startPage:1}],
  pdf:await fixturePdf(1),adapter:model.adapter,submissionTool:tool,inspector:scanned(async(_,pages)=>pages.map(pageImage)),poolSize:1});
 expect(result.ok&&result.value.successfulLessons).toBe(1);expect(model.inputs).toHaveLength(2);expect(model.created).toHaveLength(1);
});

it('缺页、错序、缺少渲染器或不支持图片的通道拒绝发送，其他课继续',async()=>{
 for(const mode of ['missing','wrong-order','no-renderer','unsupported'] as const){
  const current=new DrizzleLearnerRepository(':memory:');try{
   const tool=new TextbookContentTools(current),model=pipelineModel(tool);
   if(mode==='unsupported')model.adapter.supportsImageInput=()=>false;
   const inspector=scanned(async(_,pages)=>pages[0]===1&&mode!=='unsupported'?mode==='missing'?[]:[pageImage(2)]:pages.map(pageImage));
   if(mode==='no-renderer')delete inspector.renderPdfPages;
   const result=await current.executeTextbookPipeline({userId:'owner',documentId:'book',title:'失败隔离',
    tocEntries:[{id:'a',title:'失败课',level:'lesson',startPage:1},{id:'b',title:'第二课',level:'lesson',startPage:2}],
    pdf:await fixturePdf(2),adapter:model.adapter,submissionTool:tool,poolSize:1,parseRetries:0,modelRetries:0,inspector});
   const failed=mode==='unsupported'||mode==='no-renderer';
   expect(result.ok&&result.value).toMatchObject({failedLessons:failed?2:1,successfulLessons:failed?0:1});
   expect(model.inputs).toHaveLength(failed?0:1);expect(model.closed).toHaveLength(model.created.length);
  }finally{current.getRawDb().close();}
 }
});

it('图片取消或超时结束等待，不发送或保存原生渲染的迟到结果',async()=>{
 for(const mode of ['cancel','timeout'] as const){
  const current=new DrizzleLearnerRepository(':memory:');const released=deferred();try{
   const tool=new TextbookContentTools(current),model=pipelineModel(tool),started=deferred(),controller=new AbortController();
   const running=current.executeTextbookPipeline({userId:'owner',documentId:'book',title:'等待',tocEntries:[{id:'a',title:'本课',level:'lesson',startPage:1}],
    pdf:await fixturePdf(1),adapter:model.adapter,submissionTool:tool,signal:controller.signal,parseTimeoutMs:100,parseRetries:0,modelRetries:0,
    inspector:scanned(async()=>{started.resolve();await released.promise;return [pageImage(1)];})});
   await started.promise;if(mode==='cancel')controller.abort();const result=await running;
   if(mode==='cancel')expect(!result.ok&&result.error.code).toBe('E_CANCELLED');else expect(result.ok&&result.value.failedLessons).toBe(1);
   released.resolve();await Promise.resolve();expect(model.inputs).toHaveLength(0);
   const saved=await current.getTextbookAssetStats('book');expect(saved.ok&&saved.value.readyLessons).toBe(0);
  }finally{released.resolve();current.getRawDb().close();}
 }
});

it('图片重试只补失败批次，超容量不会截断或转云端',async()=>{
 const calls:number[][]=[],cache=new Map<number,import('../../../infrastructure/pdf-runtime/pdf-runtime.js').RenderedPagePng[]>();let failed=false;
 const inspector=scanned(async(_,pages)=>{calls.push([...pages]);if(pages[0]===9&&!failed){failed=true;throw new Error('临时渲染失败');}return pages.map(pageImage);});
 const pages=Array.from({length:9},(_,i)=>i+1),signal=new AbortController().signal;
 await expect(renderLessonImages(new Uint8Array(),pages,inspector,signal,1000,cache)).rejects.toThrow();
 expect(await renderLessonImages(new Uint8Array(),pages,inspector,signal,1000,cache)).toHaveLength(9);
 expect(calls).toEqual([[1,2,3,4,5,6,7,8],[9],[9]]);
 const png=new Uint8Array(32*1024*1024+1);png.set(fixturePng);
 await expect(renderLessonImages(new Uint8Array(),[1],scanned(async()=>[{...pageImage(1),png}]),signal,1000,new Map())).rejects.toMatchObject({code:'E_CHAPTER_IMAGES_TOO_LARGE'});
});
