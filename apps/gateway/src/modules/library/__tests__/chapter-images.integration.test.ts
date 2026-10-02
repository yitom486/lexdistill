import { afterEach, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { fixturePdf, parsedText, submitRequired, pipelineModel } from './textbook-pipeline-fixtures.js';
let repo:DrizzleLearnerRepository|undefined;
afterEach(()=>{repo?.getRawDb().close();repo=undefined;});
it('超过十页的章节直接传解析内容，不渲染或传送原始图片、页码、来源 ID',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo);
 const model=pipelineModel(tool,async({input,submit})=>{
  expect(input.attachments).toBeUndefined();expect(input.message).toContain('章节正文');
  expect(input.message).not.toContain('"page"');expect(input.message).not.toContain('"id"');
  expect((await submit({items:[{text:'可学习的完整正文'}]})).ok).toBe(true); await submitRequired(submit);
 });
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'长章',tocEntries:[{id:'a',title:'完整章节',level:'lesson',startPage:1,endPage:11}],pdf:await fixturePdf(11),adapter:model.adapter,submissionTool:tool,poolSize:1,modelRetries:0,
  inspector:{processPdf:()=>({pageCount:11,markdown:'',pagesNeedingOcr:[1]}),processPdfWithOcr:async()=>{throw new Error('不应 OCR');},renderPdfPages:async()=>{throw new Error('正文不应渲染图片');}},
  chapterParser:{parse:async(_bytes,pages)=>parsedText('章节正文',pages)}});
 expect(result.ok&&result.value.allLessonsReady).toBe(true);
});
