import { afterEach, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
let repo:DrizzleLearnerRepository|undefined;afterEach(()=>{repo?.getRawDb().close();repo=undefined;});

let rpcSeq = 0;
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    const result = await scope.submission.execute(kind, requiredContent[kind], `dir-${++rpcSeq}`);
    if (!result.ok) throw result.error;
  }
}
it('单元下有 session 时按 session 切分，课内小目录归入所属 session；单元无 session 时切分自身',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');
 const harness=harnessInjection(repo,new Map<string, ChapterScript>([
   ['intro',async(scope)=>{await submitRequiredScope(scope);}],
   ['lesson',async(scope)=>{await submitRequiredScope(scope);}]
 ]));
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'章节',poolSize:2,...harness.extra,
  tocEntries:[{id:'u',title:'单元',level:'unit',startPage:1},{id:'intro',title:'导入部分',parentId:'u',level:'section',startPage:1},{id:'small',title:'小目录',parentId:'intro',level:'section',startPage:1},{id:'lesson',title:'第一课',parentId:'u',level:'lesson',startPage:2}],
  lessonJobs:[{lessonId:'intro',text:'导入部分内容'},{lessonId:'lesson',text:'第一课内容'}]});
 expect(result.ok&&result.value.successfulLessons).toBe(2);
 expect(harness.driver.asks).toHaveLength(2);
 expect(harness.driver.asks[0]).toContain('  - 小目录');
 const slots=await repo.listTextbookLessonSlots('book');expect(slots.ok&&slots.value.map(row=>row.lessonId)).toEqual(['intro','lesson']);

 // 单元下无 session 时：自身作为独立切分面
 const repo2=new DrizzleLearnerRepository(':memory:');
 const harness2=harnessInjection(repo2,new Map<string, ChapterScript>([['u_empty',async(scope)=>{await submitRequiredScope(scope);}]]));
 const res2=await repo2.executeTextbookPipeline({userId:'owner',documentId:'book2',title:'无细课单元',poolSize:1,...harness2.extra,
  tocEntries:[{id:'u_empty',title:'独立单元',level:'unit',startPage:1}],
  lessonJobs:[{lessonId:'u_empty',text:'整个单元内容'}]});
 expect(res2.ok&&res2.value.successfulLessons).toBe(1);
 const slots2=await repo2.listTextbookLessonSlots('book2');expect(slots2.ok&&slots2.value.map(row=>row.lessonId)).toEqual(['u_empty']);
});
