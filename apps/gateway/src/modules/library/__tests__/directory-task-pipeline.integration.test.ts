import { afterEach, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel } from './textbook-pipeline-fixtures.js';
let repo:DrizzleLearnerRepository|undefined;afterEach(()=>{repo?.getRawDb().close();repo=undefined;});
it('一级单元包含导入部分和课次；子标题仅作参考，不需报告覆盖',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo),model=pipelineModel(tool);
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'章节',poolSize:2,adapter:model.adapter,submissionTool:tool,modelRetries:0,
  tocEntries:[{id:'u',title:'单元',level:'unit',startPage:1},{id:'intro',title:'导入部分',parentId:'u',level:'section',startPage:1},{id:'small',title:'小目录',parentId:'intro',level:'section',startPage:1},{id:'lesson',title:'第一课',parentId:'u',level:'lesson',startPage:2}],
  lessonJobs:[{lessonId:'u',text:'导入内容与课次内容'}]});
 expect(result.ok&&result.value.successfulLessons).toBe(1);
 expect(model.inputs).toHaveLength(1);
 expect(model.inputs[0]!.input.message).toContain('    - 小目录');
 expect(model.inputs[0]!.input.message).not.toContain('coverage');
 const slots=await repo.listTextbookLessonSlots('book');expect(slots.ok&&slots.value.map(row=>row.lessonId)).toEqual(['u']);
});
