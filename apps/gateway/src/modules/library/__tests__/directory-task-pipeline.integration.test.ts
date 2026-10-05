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
it('一级单元包含导入部分和课次；子标题仅作参考，不需报告覆盖',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');
 const harness=harnessInjection(repo,new Map<string, ChapterScript>([['u',async(scope)=>{await submitRequiredScope(scope);}]]));
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'章节',poolSize:2,...harness.extra,
  tocEntries:[{id:'u',title:'单元',level:'unit',startPage:1},{id:'intro',title:'导入部分',parentId:'u',level:'section',startPage:1},{id:'small',title:'小目录',parentId:'intro',level:'section',startPage:1},{id:'lesson',title:'第一课',parentId:'u',level:'lesson',startPage:2}],
  lessonJobs:[{lessonId:'u',text:'导入内容与课次内容'}]});
 expect(result.ok&&result.value.successfulLessons).toBe(1);
 expect(harness.driver.asks).toHaveLength(1);
 expect(harness.driver.asks[0]).toContain('    - 小目录');
 expect(harness.driver.asks[0]).not.toContain('coverage');
 const slots=await repo.listTextbookLessonSlots('book');expect(slots.ok&&slots.value.map(row=>row.lessonId)).toEqual(['u']);
});
