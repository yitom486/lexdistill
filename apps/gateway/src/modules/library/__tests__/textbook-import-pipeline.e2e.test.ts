import { afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { fixturePdf, parsedText, pipelineModel, deferred } from './textbook-pipeline-fixtures.js';
import { TextbookASTSchema } from '@study-studio/document-model';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
function setup() {
 const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
 return { repo, db: drizzle(repo.getRawDb(),{schema}), tool: new TextbookContentTools(repo) };
}
const word = { word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5', examples: [{ text: '学校へ行きます。', translation: '去学校。' }] };
const toc = [{ id: 'a', title: '第一课', level: 'lesson' as const, startPage: 1, endPage: 1 },{id:'b', title:'第二课',level:'lesson' as const,startPage:2,endPage:2}];
describe('教材简单内容工具 → 实际 SQLite → 查询回执', () => {
 it('五类内容和整理材料各自保存；系统生成身份，全球词汇一次新增、重复复用且等级不覆盖', async () => {
  const env=setup(); let turn=0;
  const model=pipelineModel(env.tool,async({submit,input})=>{
   expect(input.attachments).toBeUndefined(); expect(input.message).not.toContain('tocId'); expect(input.message).not.toContain('sourceRefs'); expect(input.message).not.toContain('本章目录');
   expect(input.message).toContain('library_write_vocabulary'); expect(input.message).not.toContain('properties');
   turn++;
   const vocab=await submit({items:[{...word,level:turn===1?'N5':'N1',meaning:turn===1?'学校':'第二课语境'}]},'vocabulary');
   expect(vocab.ok && vocab.value).toEqual({kind:'vocabulary',saved:1,vocabularyAdded:turn===1?1:0});
   expect((await submit({items:[{title:'助词へ',explanation:'表示方向',examples:[{text:'学校へ行く。'}],aiExplanation:'目的地也可以用に。'}]},'grammar')).ok).toBe(true);
   expect((await submit({items:[{title:'上学',text:'学校へ行きます。\n先生に会います。',translation:'去学校，见老师。'}]},'articles')).ok).toBe(true);
   expect((await submit({items:[{text:'学校はどこですか。',translation:'学校在哪里？'}]},'sentences')).ok).toBe(true);
   expect((await submit({items:[{type:'CHOICE',difficultyTier:1,difficultyReason:'单一助词识别',prompt:'表示方向的助词？',options:['へ','を'],answer:'へ',explanation:'へ表示方向。'}]},'exercises')).ok).toBe(true);
   expect((await submit({text:'本课整理材料'},'material')).ok).toBe(true);
   const material=await submit({},'read_material'); expect(material.ok && material.value).toEqual({text:'本课整理材料'});
  });
  const result=await env.repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'教材',language:'ja',tocEntries:toc,lessonJobs:[{lessonId:'a',text:'一'},{lessonId:'b',text:'二'}],adapter:model.adapter,submissionTool:env.tool,poolSize:1,modelRetries:0});
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  expect(model.created).toHaveLength(1); expect(model.created[0]!.tools?.map(tool=>tool.name).sort()).toEqual(env.tool.tools.map(tool=>tool.name).sort());
  const globals=env.db.select().from(schema.globalVocabulary).all(); expect(globals).toHaveLength(1); expect(globals[0]).toMatchObject({jlptLevel:'N5',meaning:'学校',levelSource:'MODEL_ESTIMATE'});
  const words=env.db.select().from(schema.textbookVocabulary).all(); expect(words).toHaveLength(2); expect(words[0]!.vocabularyId).toBe(words[1]!.vocabularyId);
  expect(env.db.select().from(schema.textbookKnowledge).all()).toHaveLength(2);
  expect(env.db.select().from(schema.textbookArticles).all()).toHaveLength(2);
  expect(env.db.select().from(schema.textbookSentences).all()).toHaveLength(2);
  expect(env.db.select().from(schema.textbookExerciseItems).all()).toHaveLength(2);
  expect(env.db.select().from(schema.documents).where(eq(schema.documents.id,'book')).get()!.astJson).toBeNull();
  const doc=await env.repo.getDocumentById('book'); if(!doc.ok)throw doc.error;
  const view=TextbookASTSchema.parse(JSON.parse(doc.value!.astJson!));
  expect(view.lessons[0]!.learningContent?.grammar[0]!.aiExplanation).toBe('目的地也可以用に。');
  expect(view.lessons[0]!.learningContent?.vocabulary[0]!.examples).toEqual(word.examples);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM flashcards WHERE user_id=?').get('owner')).toEqual({n:0});
  expect(env.repo.getRawDb().query("SELECT name FROM sqlite_master WHERE name IN ('textbook_lessons','textbook_lines')").all()).toEqual([]);
 });
 it('一个章节仅有知识点也可以完成，不要求文章、练习和小目录齐全',async()=>{
  const env=setup(), model=pipelineModel(env.tool,async({submit})=>{expect((await submit({items:[{kind:'PRONUNCIATION',title:'长音',explanation:'长音占两拍。'}]},'grammar')).ok).toBe(true);});
  const result=await env.repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'发音',tocEntries:[{id:'intro',title:'发音',level:'section',startPage:1},{id:'child',parentId:'intro',title:'小目录',level:'section',startPage:1}],lessonJobs:[{lessonId:'intro',text:'长音'}],adapter:model.adapter,submissionTool:env.tool,poolSize:1,modelRetries:0});
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  const slots=await env.repo.listTextbookLessonSlots('book'); expect(slots.ok && slots.value.map(item=>item.lessonId)).toEqual(['intro']);
  expect(model.inputs[0]!.input.message).not.toContain('小目录');
 });
 it('解析与模型流水线并行，第一章保存时第二章尚在解析，同一会话复用',async()=>{
  const env=setup(), second=deferred(), release=deferred(), saved=deferred(); let secondDone=false;
  const model=pipelineModel(env.tool,async({submit})=>{await second.promise; expect((await submit({items:[{text:'完整正文'}]})).ok).toBe(true);});
  const running=env.repo.executeTextbookPipeline({userId:'owner',documentId:'book',title:'并行教材',tocEntries:toc,pdf:await fixturePdf(2),parseConcurrency:2,poolSize:1,adapter:model.adapter,submissionTool:env.tool,modelRetries:0,
   inspector:{processPdf:()=>({pageCount:2,markdown:'',pagesNeedingOcr:[1,2]}),processPdfWithOcr:async()=>{throw new Error('不应走旧正文 OCR');}},
   chapterParser:{parse:async(_pdf,pages)=>{if(pages[0]===2){second.resolve();await release.promise;secondDone=true;}return parsedText('教材材料',pages);}},
   onProgress:progress=>{if(progress.lessonId==='a'&&progress.stage==='saved'){expect(secondDone).toBe(false);saved.resolve();}}
  });
  try{await saved.promise;release.resolve();const result=await running;expect(result.ok&&result.value.successfulLessons).toBe(2);expect(model.created).toHaveLength(1);}
  finally{release.resolve();await running;}
 });
 it('多个内容批次追加顺序、完全相同的重试不重复写，跨用户和章节写入被拒绝',async()=>{
  const env=setup(); await env.repo.seedTextbookTocSkeleton({userId:'owner',documentId:'book',title:'教材',language:'ja',entries:toc});
  const binding=env.tool.bind('s',{userId:'owner',documentId:'book',lessonId:'a',assignmentId:'attempt',signal:new AbortController().signal,allowAiExercises:true});env.tool.startTurn('s','attempt','t');
  const tool=env.tool.tools.find(tool=>tool.kind==='articles')!, context={userId:'owner',sessionId:'s',turnId:'t'};
  expect((await tool.execute({items:[{text:'第一段'}]},context)).ok).toBe(true);
  expect((await tool.execute({items:[{text:'第二段'}]},context)).ok).toBe(true);
  expect((await tool.execute({items:[{text:'第一段'}]},context)).ok).toBe(true);
  expect(env.db.select().from(schema.textbookArticles).all().map(row=>row.ord)).toEqual([0,1]);
  expect((await tool.execute({items:[{text:'非法'}]},{...context,userId:'other'})).ok).toBe(false);
  expect((await tool.execute({items:[{text:'迟到'}]},{...context,turnId:'old'})).ok).toBe(false);
  expect((await tool.execute({documentId:'other',items:[{text:'伪造身份'}]},context)).ok).toBe(false);
  // Repair the rejected category before completing this turn.
  expect((await tool.execute({items:[{text:'第二段'}]},context)).ok).toBe(true);
  expect((await binding.persist()).ok).toBe(true);env.tool.end('s');
  expect((await tool.execute({items:[{text:'迟到'}]},context)).ok).toBe(false);
 });
 it('一批词汇有非法等级时整批撤回；已有全局词与其他用户的同词互不覆盖',async()=>{
  const env=setup();for(const userId of ['owner','other']) await env.repo.seedTextbookTocSkeleton({userId,documentId:userId,title:'词汇',language:'ja',entries:[toc[0]!]});
  const scope={userId:'owner',documentId:'owner',chapterId:'a'};
  expect((await env.repo.writeTextbookContent(scope,'vocabulary',{items:[word,{...word,word:'未知',level:'N0'}]})).ok).toBe(false);expect(env.db.select().from(schema.globalVocabulary).all()).toHaveLength(0);
  expect((await env.repo.writeTextbookContent(scope,'vocabulary',{items:[word]})).ok).toBe(true);
  expect((await env.repo.writeTextbookContent({userId:'other',documentId:'other',chapterId:'a'},'vocabulary',{items:[{...word,level:'N2'}]})).ok).toBe(true);
  expect(env.db.select().from(schema.globalVocabulary).all().map(row=>row.jlptLevel)).toEqual(['N5','N2']);
  expect((await env.repo.writeTextbookContent({...scope,chapterId:'foreign'},'vocabulary',{items:[word]})).ok).toBe(false);
 });
});
