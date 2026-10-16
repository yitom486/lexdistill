import { afterEach, describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { BusinessError, err } from '@lexdistill/shared';
import { harnessInjection, stubPoolDriver, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';

const repos: DrizzleLearnerRepository[]=[];
afterEach(()=>{for(const repo of repos.splice(0))repo.getRawDb().close();});
function setup(){const repo=new DrizzleLearnerRepository(':memory:');repos.push(repo);return {repo};}
function input(){return {userId:'owner',documentId:'book',title:'纠错',traceId:'trace',tocEntries:[{id:'a',title:'第一课',level:'lesson' as const,startPage:1}],lessonJobs:[{lessonId:'a',text:'教材'}],poolSize:1,modelRetries:0};}
let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles' | 'sentences' | 'material', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `test-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    await submitScope(scope, kind, requiredContent[kind]);
  }
}
describe('简单工具纠错与运行故障隔离',()=>{
 it('字段反馈包含实际字段，修正调用后保存；没有修正则章节不能 ready',async()=>{
  for(const repair of [false,true]){
   const env=setup();
   const harness=harnessInjection(env.repo,new Map<string, ChapterScript>([['a',async(scope)=>{
    const bad=await scope.submission.execute('grammar',{items:[{title:'知识点',explanation:42}]},'rpc-bad');
    expect(bad.ok).toBe(false);
    if(!bad.ok)expect(bad.error.internalDetails).toMatchObject({issues:[{path:'items.0.explanation'}]});
    if(repair){expect((await scope.submission.execute('grammar',{items:[{title:'知识点',explanation:'正确讲解'}]},'rpc-fix')).ok).toBe(true);await submitRequiredScope(scope);}
   }]]));
   const result=await env.repo.executeTextbookPipeline({...input(),...harness.extra});
   expect(result.ok&&result.value.successfulLessons).toBe(repair?1:0);
   const stats=await env.repo.getTextbookAssetStats('book');expect(stats.ok&&stats.value.readyLessons).toBe(repair?1:0);
  }
 });
 it('数据库暂忙只重试内容保存，不重新调用模型，多个失败批次都保留',async()=>{
  const env=setup(),write=env.repo.commitTextbookLesson.bind(env.repo);let writes=0;
  env.repo.commitTextbookLesson=async(...args)=>++writes<=2?err(new BusinessError('E_DB_BUSY','数据库暂忙','DATABASE',true)):write(...args);
  const harness=harnessInjection(env.repo,new Map<string, ChapterScript>([['a',async(scope)=>{
   expect((await scope.submission.execute('articles',{items:[{text:'第一批'}]},'rpc-1')).ok).toBe(true);
   expect((await scope.submission.execute('articles',{items:[{text:'第二批'}]},'rpc-2')).ok).toBe(true);await submitRequiredScope(scope);
  }]]));
  const result=await env.repo.executeTextbookPipeline({...input(),...harness.extra,storageRetries:2});
  expect(result.ok&&result.value.allLessonsReady).toBe(true);expect(writes).toBe(3);expect(harness.driver.asks).toHaveLength(1);
  expect(env.repo.getRawDb().query('SELECT text FROM textbook_articles ORDER BY ord').all()).toEqual([{text:'第一批'},{text:'第二批'}]);
 });
 it('首响应超时结束本章且拒绝迟到调用，下一章会话恢复后继续',async()=>{
  const env=setup();let accepted:boolean|undefined;let scopes: McpChapterScope[] = [];
  let calls = 0;
  const driver = stubPoolDriver({
    ask: async () => {
      calls++;
      if (calls === 1) await new Promise<void>(() => undefined);
      return { text: 'done', stopReason: 'completed' };
    },
  });
  const harness=harnessInjection(env.repo,new Map<string, ChapterScript>([
    ['a',async(scope)=>{ scopes.push(scope); }],
    ['b',async(scope)=>{ await scope.submission.execute('articles',{items:[{text:'第二课正文'}]},'rpc-b'); await submitRequiredScope(scope); }],
  ]), driver);
  const running=env.repo.executeTextbookPipeline({...input(),firstResponseTimeoutMs:40,stallTimeoutMs:1000,
   tocEntries:[...input().tocEntries,{id:'b',title:'第二课',level:'lesson',startPage:2}],lessonJobs:[...input().lessonJobs,{lessonId:'b',text:'二'}],...harness.extra});
  const result=await running;
  expect(result.ok&&result.value.failedLessons).toBe(1);expect(result.ok&&result.value.successfulLessons).toBe(1);
  const late = await scopes[0]!.submission.execute('articles', { items: [{ text: '迟到正文' }] }, 'rpc-late');
  accepted = late.ok;
  expect(accepted).toBe(false);
  expect(env.repo.getRawDb().query('SELECT chapter_id FROM textbook_articles').all()).toEqual([{chapter_id:'b'}]);
 });
 it('非法选项答案与重复匹配左项不入库；多选、排序和匹配正确答案可以保存',async()=>{
  const env=setup();
  const harness=harnessInjection(env.repo,new Map<string, ChapterScript>([['a',async(scope)=>{
   expect((await scope.submission.execute('exercises',{items:[{type:'CHOICE',difficultyTier:1,difficultyReason:'单一选项',prompt:'选择',options:['一','二'],answer:'三'}]},'rpc-e1')).ok).toBe(false);
   expect((await scope.submission.execute('exercises',{items:[{type:'MATCHING',difficultyTier:1,difficultyReason:'词义匹配',prompt:'配对',left:['一','二'],right:['甲','乙'],answer:[{left:'一',right:'甲'},{left:'一',right:'乙'}]}]},'rpc-e2')).ok).toBe(false);
   for(const [index, exercise] of [
    {type:'MULTI_CHOICE',prompt:'多选',options:['一','二','三'],answer:['一','二']},
    {type:'ORDERING',prompt:'排序',options:['一','二'],answer:['二','一']},
    {type:'MATCHING',difficultyTier:1,difficultyReason:'词义匹配',prompt:'匹配',left:['一','二'],right:['甲','乙'],answer:[{left:'一',right:'甲'},{left:'二',right:'乙'}]},
   ].entries())expect((await scope.submission.execute('exercises',{items:[{...exercise,difficultyTier:2,difficultyReason:'受控题型测试'}]},`rpc-e3-${index}`)).ok).toBe(true);
   await submitScope(scope, 'grammar', requiredContent.grammar);
   await submitScope(scope, 'vocabulary', requiredContent.vocabulary);
  }]]));
  const result=await env.repo.executeTextbookPipeline({...input(),...harness.extra});expect(result.ok&&result.value.allLessonsReady).toBe(true);
  expect(env.repo.getRawDb().query('SELECT type FROM textbook_exercise_items ORDER BY ord').all()).toEqual([{type:'MULTI_CHOICE'},{type:'ORDERING'},{type:'MATCHING'}]);
 });
 it('修正预算用尽后中断当前轮次，失败一章不会终止整书',async()=>{
  const env=setup();
  const harness=harnessInjection(env.repo,new Map<string, ChapterScript>([
   ['a',async(scope)=>{for(let i=0;i<3;i++)await scope.submission.execute('articles',{items:[{text:''}]},`rpc-a${i}`);}],
   ['b',async(scope)=>{await scope.submission.execute('articles',{items:[{text:'第二课'}]},'rpc-b');await submitRequiredScope(scope);}],
  ]));
  const result=await env.repo.executeTextbookPipeline({...input(),toolRepairRetries:1,tocEntries:[...input().tocEntries,{id:'b',title:'第二课',level:'lesson',startPage:2}],lessonJobs:[...input().lessonJobs,{lessonId:'b',text:'二'}],...harness.extra});
  expect(result.ok&&result.value.failedLessons).toBe(1);expect(result.ok&&result.value.successfulLessons).toBe(1);
 });
});
