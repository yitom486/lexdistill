import { afterEach, describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { BusinessError, err } from '@study-studio/shared';
import { pipelineModel, deferred } from './textbook-pipeline-fixtures.js';

const repos: DrizzleLearnerRepository[]=[];
afterEach(()=>{for(const repo of repos.splice(0))repo.getRawDb().close();});
function setup(){const repo=new DrizzleLearnerRepository(':memory:');repos.push(repo);const tool=new TextbookContentTools(repo);return {repo,tool};}
function input(env:ReturnType<typeof setup>){return {userId:'owner',documentId:'book',title:'纠错',traceId:'trace',tocEntries:[{id:'a',title:'第一课',level:'lesson' as const,startPage:1}],lessonJobs:[{lessonId:'a',text:'教材'}],submissionTool:env.tool,poolSize:1,modelRetries:0};}
describe('简单工具纠错与运行故障隔离',()=>{
 it('字段反馈包含实际字段，修正调用后保存；没有修正则章节不能 ready',async()=>{
  for(const repair of [false,true]){
   const env=setup(),model=pipelineModel(env.tool,async({submit})=>{
    const bad=await submit({items:[{title:'知识点',explanation:42}]},'grammar');expect(bad.ok).toBe(false);
    if(!bad.ok)expect(bad.error.internalDetails).toMatchObject({issues:[{path:'items.0.explanation'}]});
    if(repair)expect((await submit({items:[{title:'知识点',explanation:'正确讲解'}]},'grammar')).ok).toBe(true);
   });
   const result=await env.repo.executeTextbookPipeline({...input(env),adapter:model.adapter});
   expect(result.ok&&result.value.successfulLessons).toBe(repair?1:0);
   const stats=await env.repo.getTextbookAssetStats('book');expect(stats.ok&&stats.value.readyLessons).toBe(repair?1:0);
  }
 });
 it('数据库暂忙只重试内容保存，不重新调用模型，多个失败批次都保留',async()=>{
  const env=setup(),write=env.repo.writeTextbookContent.bind(env.repo);let writes=0;
  env.repo.writeTextbookContent=async(...args)=>++writes<=2?err(new BusinessError('E_DB_BUSY','数据库暂忙','DATABASE',true)):write(...args);
  const model=pipelineModel(env.tool,async({submit})=>{
   expect((await submit({items:[{text:'第一批'}]})).ok).toBe(false);
   expect((await submit({items:[{text:'第二批'}]})).ok).toBe(false);
  });
  const result=await env.repo.executeTextbookPipeline({...input(env),adapter:model.adapter,storageRetries:2});
  expect(result.ok&&result.value.allLessonsReady).toBe(true);expect(model.inputs).toHaveLength(1);expect(writes).toBe(4);
  expect(env.repo.getRawDb().query('SELECT text FROM textbook_articles ORDER BY ord').all()).toEqual([{text:'第一批'},{text:'第二批'}]);
 });
 it('首响应超时结束本章且拒绝迟到调用，下一章会话恢复后继续',async()=>{
  const env=setup(),release=deferred();let accepted:boolean|undefined;
  const model=pipelineModel(env.tool,async({submit,input})=>{
   if(input.message.includes('第一课')){await release.promise;accepted=(await submit({items:[{text:'迟到正文'}]})).ok;}
   else expect((await submit({items:[{text:'第二课正文'}]})).ok).toBe(true);
  });
  const running=env.repo.executeTextbookPipeline({...input(env),adapter:model.adapter,firstResponseTimeoutMs:40,stallTimeoutMs:1000,
   tocEntries:[...input(env).tocEntries,{id:'b',title:'第二课',level:'lesson',startPage:2}],lessonJobs:[...input(env).lessonJobs,{lessonId:'b',text:'二'}]});
  try{const result=await running;expect(result.ok&&result.value.failedLessons).toBe(1);expect(result.ok&&result.value.successfulLessons).toBe(1);}
  finally{release.resolve();}
  await new Promise(resolve=>setTimeout(resolve,15));expect(accepted).toBe(false);
  expect(env.repo.getRawDb().query('SELECT chapter_id FROM textbook_articles').all()).toEqual([{chapter_id:'b'}]);
 });
 it('非法选项答案与重复匹配左项不入库；多选、排序和匹配正确答案可以保存',async()=>{
  const env=setup(),model=pipelineModel(env.tool,async({submit})=>{
   expect((await submit({items:[{type:'CHOICE',difficultyTier:1,difficultyReason:'单一选项',prompt:'选择',options:['一','二'],answer:'三'}]},'exercises')).ok).toBe(false);
   expect((await submit({items:[{type:'MATCHING',difficultyTier:1,difficultyReason:'词义匹配',prompt:'配对',left:['一','二'],right:['甲','乙'],answer:[{left:'一',right:'甲'},{left:'一',right:'乙'}]}]},'exercises')).ok).toBe(false);
   for(const exercise of [
    {type:'MULTI_CHOICE',prompt:'多选',options:['一','二','三'],answer:['一','二']},
    {type:'ORDERING',prompt:'排序',options:['一','二'],answer:['二','一']},
    {type:'MATCHING',difficultyTier:1,difficultyReason:'词义匹配',prompt:'匹配',left:['一','二'],right:['甲','乙'],answer:[{left:'一',right:'甲'},{left:'二',right:'乙'}]},
   ])expect((await submit({items:[{...exercise,difficultyTier:2,difficultyReason:'受控题型测试'}]},'exercises')).ok).toBe(true);
  });
  const result=await env.repo.executeTextbookPipeline({...input(env),adapter:model.adapter});expect(result.ok&&result.value.allLessonsReady).toBe(true);
  expect(env.repo.getRawDb().query('SELECT type FROM textbook_exercise_items ORDER BY ord').all()).toEqual([{type:'MULTI_CHOICE'},{type:'ORDERING'},{type:'MATCHING'}]);
 });
 it('修正预算用尽后中断当前轮次，失败一章不会终止整书',async()=>{
  const env=setup(),model=pipelineModel(env.tool,async({submit,input})=>{
   if(input.message.includes('第一课')){for(let i=0;i<3;i++)await submit({items:[{text:''}]});}
   else await submit({items:[{text:'第二课'}]});
  });
  const result=await env.repo.executeTextbookPipeline({...input(env),adapter:model.adapter,toolRepairRetries:1,tocEntries:[...input(env).tocEntries,{id:'b',title:'第二课',level:'lesson',startPage:2}],lessonJobs:[...input(env).lessonJobs,{lessonId:'b',text:'二'}]});
  expect(result.ok&&result.value.failedLessons).toBe(1);expect(result.ok&&result.value.successfulLessons).toBe(1);
 });
});
