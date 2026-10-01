import { afterEach, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { initSchema } from '../ddl.js';
import * as schema from '../schema.js';
import { seedTextbookTocSkeleton, listTextbookLessonSlots, getTextbookAssetStats } from '../adapters/library/toc-skeleton.js';
import { writeTextbookContent } from '../adapters/library/textbook-content.js';
import { completeTextbookChapter } from '../adapters/library/textbook-view.js';
let sqlite: Database|undefined;afterEach(()=>{sqlite?.close();sqlite=undefined;});
it('章节清单和内容独立存储，复核目录保留已保存内容；显式覆盖仅清本书内容、不清全局词汇',async()=>{
 sqlite=new Database(':memory:');initSchema(sqlite);const db=drizzle(sqlite,{schema});
 const input={documentId:'book',userId:'owner',title:'教材',language:'ja',sourceFingerprint:'file',entries:[{id:'root',title:'第一章',level:'lesson' as const,startPage:10},{id:'small',parentId:'root',title:'小节',level:'section' as const,startPage:10}]};
 expect((await seedTextbookTocSkeleton({db},input)).ok).toBe(true);
 const scope={userId:'owner',documentId:'book',chapterId:'root'};
 expect((await writeTextbookContent({db},scope,'vocabulary',{items:[{word:'本',reading:'ほん',meaning:'书',level:'N5'}]})).ok).toBe(true);
 expect((await completeTextbookChapter({db},scope)).ok).toBe(true);
 expect((await seedTextbookTocSkeleton({db},input)).ok).toBe(true);
 const slots=await listTextbookLessonSlots({db},'book');expect(slots.ok&&slots.value.map(row=>[row.lessonId,row.status])).toEqual([['root','ready']]);
 expect((await seedTextbookTocSkeleton({db},{...input,sourceFingerprint:'other'})).ok).toBe(false);
 expect((await seedTextbookTocSkeleton({db},{...input,userId:'other'})).ok).toBe(false);
 expect((await seedTextbookTocSkeleton({db},{...input,forceOverwrite:true})).ok).toBe(true);
 expect(db.select().from(schema.globalVocabulary).all()).toHaveLength(1);expect(db.select().from(schema.textbookVocabulary).all()).toHaveLength(0);
 const stats=await getTextbookAssetStats({db},'book');expect(stats.ok&&stats.value.readyLessons).toBe(0);
});
it('目录页码倒序不能保存任何章节',async()=>{
 sqlite=new Database(':memory:');initSchema(sqlite);const db=drizzle(sqlite,{schema});
 const result=await seedTextbookTocSkeleton({db},{documentId:'book',userId:'owner',title:'教材',entries:[{id:'a',title:'一',level:'lesson',startPage:5},{id:'b',title:'二',level:'lesson',startPage:2}]});
 expect(result.ok).toBe(false);expect(db.select().from(schema.documents).all()).toHaveLength(0);
});
