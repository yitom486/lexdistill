import { afterEach, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel } from './textbook-pipeline-fixtures.js';
let repo:DrizzleLearnerRepository|undefined;afterEach(()=>{repo?.getRawDb().close();repo=undefined;});
it('章节清单保留导入部分与课次；模型只收到当前章节和内容，不需报告小目录覆盖',async()=>{
 repo=new DrizzleLearnerRepository(':memory:');const tool=new TextbookContentTools(repo),model=pipelineModel(tool);
 const result=await repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'章节',poolSize:2,adapter:model.adapter,submissionTool:tool,modelRetries:0,
  tocEntries:[{id:'u',title:'单元',level:'unit',startPage:1},{id:'intro',title:'导入部分',parentId:'u',level:'section',startPage:1},{id:'small',title:'小目录',parentId:'intro',level:'section',startPage:1},{id:'lesson',title:'第一课',parentId:'u',level:'lesson',startPage:2}],
  lessonJobs:[{lessonId:'intro',text:'导入内容'},{lessonId:'lesson',text:'课次内容'}]});
 expect(result.ok&&result.value.successfulLessons).toBe(2);expect(model.created).toHaveLength(2);
 expect(model.inputs.every(turn=>!turn.input.message.includes('小目录')&&!turn.input.message.includes('coverage'))).toBe(true);
 const slots=await repo.listTextbookLessonSlots('book');expect(slots.ok&&slots.value.map(row=>row.lessonId)).toEqual(['intro','lesson']);
});
