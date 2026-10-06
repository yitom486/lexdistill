import { describe,expect,it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initSchema,runMigrations } from '../ddl.js';
import type {SchemaMigration} from '../migrations/types.js';
import { SCHEMA_MIGRATIONS } from '../migrations/index.js';
function v36(db:Database) {
  // Synchronous fixture setup: run the unchanged historic catalog, then restore it.
  // The catalog is an ordinary mutable array; mutation is confined to synchronous fixture setup.
  const catalog=SCHEMA_MIGRATIONS as SchemaMigration[];
  const newest=catalog.splice(catalog.findIndex(m => m.version > 36));
  try {initSchema(db);} finally {catalog.push(...newest);}
  for(const table of ['textbook_materials','textbook_vocabulary','textbook_knowledge','textbook_articles','textbook_sentences','textbook_exercise_items','global_vocabulary']) db.run('DROP TABLE '+table);
}
describe('v37 existing textbook migration',()=>{
 it('copies real v36 rows, preserves content and identities, removes old tables and survives reopening',()=>{
  const db=new Database(':memory:');
  try {
   v36(db);
   db.run("INSERT INTO documents(id,user_id,title,source_kind,language,content,created_at,updated_at) VALUES('book','owner','Book','user_import','ja','','t','t')");
   db.run("INSERT INTO textbook_lessons(document_id,lesson_id,lesson_number,title,sort_order,kind,status,passage_md) VALUES('book','ch',1,'Chapter',1,'lesson','ready','Cleaned material')");
   db.run("INSERT INTO textbook_lessons(document_id,lesson_id,lesson_number,title,sort_order,kind,parent_id,status) VALUES('book','sub',2,'Subsection',2,'section','ch','ready')");
   db.run("INSERT INTO textbook_vocab(document_id,lesson_id,ord,surface,reading,gloss_zh,example_ja,example_zh) VALUES('book','sub',0,'猫','ねこ','cat','猫です','It is a cat')");
   db.run("INSERT INTO textbook_grammar(document_id,lesson_id,ord,title,explanation,examples_json) VALUES('book','sub',0,'です','Explanation','[]')");
   db.run("INSERT INTO textbook_lines(document_id,lesson_id,ord,ja,zh,kind,block_id,source) VALUES('book','ch',0,'Article','Translation','PARAGRAPH','a1','TEXTBOOK'),('book','sub',0,'Sentence','Meaning','DIALOGUE','s1','TEXTBOOK')");
   db.run(`INSERT INTO textbook_exercises(document_id,lesson_id,ord,type,prompt,answer,exercise_id,options_json,answer_json,source) VALUES('book','sub',0,'CHOICE','Choose','cat','e1','[{"id":"o1","text":"cat"},{"id":"o2","text":"dog"}]','{"optionIds":["o1"]}','TEXTBOOK')`);
   expect(runMigrations(db).applied).toEqual([37,38,39,40]);
   expect(db.query("SELECT word,reading,jlpt_level FROM global_vocabulary").get()).toEqual({word:'猫',reading:'ねこ',jlpt_level:null});
   expect(db.query("SELECT chapter_id,meaning,examples_json FROM textbook_vocabulary").get()).toEqual({chapter_id:'ch',meaning:'cat',examples_json:'[{"text":"猫です","translation":"It is a cat"}]'});
   expect(db.query("SELECT id,chapter_id,text FROM textbook_sentences").get()).toEqual({id:'s1',chapter_id:'ch',text:'Sentence'});
   expect(db.query("SELECT id,chapter_id,answer_json FROM textbook_exercise_items").get()).toEqual({id:'e1',chapter_id:'ch',answer_json:'["cat"]'});
   expect(db.query("SELECT text FROM textbook_materials").get()).toEqual({text:'Cleaned material'});
   expect(db.query("SELECT count(*) AS n FROM textbook_fts").get()).toEqual({n:3});
   initSchema(db);initSchema(db);
   expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('textbook_lessons','textbook_lines','textbook_vocab','textbook_grammar','textbook_exercises')").all()).toEqual([]);
   expect(db.query("SELECT ast_json,chapters_json FROM documents WHERE id='book'").get()).toMatchObject({ast_json:null});
   expect(db.query("SELECT json_array_length(chapters_json) AS n FROM documents WHERE id='book'").get()).toEqual({n:1});
  } finally {db.close();}
 });
 it('failed conversion rolls back both copied rows and schema changes',()=>{
  const db=new Database(':memory:');try {
   v36(db);
   db.run("INSERT INTO documents(id,user_id,title,source_kind,language,content,created_at,updated_at) VALUES('b','u','B','user_import','ja','','t','t')");
   db.run("INSERT INTO textbook_lessons(document_id,lesson_id,lesson_number,title,sort_order,kind,status) VALUES('b','c',1,'C',1,'lesson','ready')");
   db.run("INSERT INTO textbook_exercises(document_id,lesson_id,ord,type,prompt,answer,options_json) VALUES('b','c',0,'CHOICE','Q','A','broken-json')");
   expect(()=>runMigrations(db)).toThrow();
   expect(db.query("SELECT max(version) AS v FROM schema_migrations").get()).toEqual({v:36});
   expect(db.query("SELECT prompt FROM textbook_exercises").get()).toEqual({prompt:'Q'});
   expect(db.query("SELECT name FROM sqlite_master WHERE name='global_vocabulary'").all()).toEqual([]);
  } finally{db.close();}
 });
 it('migrates repeated model IDs across chapters and resolves answers from canonical options',()=>{
  const db=new Database(':memory:');try {
   v36(db);
   db.run("INSERT INTO documents(id,user_id,title,source_kind,language,content,created_at,updated_at) VALUES('b','u','B','user_import','ja','','t','t')");
   for(const chapter of ['one','two']) {
    db.query("INSERT INTO textbook_lessons(document_id,lesson_id,lesson_number,title,sort_order,kind,status,content_json) VALUES('b',?,1,?,1,'lesson','ready',?)").run(chapter,chapter,JSON.stringify({knowledgePoints:[{id:'kp1'}]}));
    db.query("INSERT INTO textbook_grammar(document_id,lesson_id,ord,title,explanation,examples_json) VALUES('b',?,0,'Grammar','Explanation','[]')").run(chapter);
    db.query("INSERT INTO textbook_lines(document_id,lesson_id,ord,ja,kind,block_id,source) VALUES('b',?,0,?,'DIALOGUE','line1','TEXTBOOK')").run(chapter,chapter+' sentence');
    db.query("INSERT INTO textbook_exercises(document_id,lesson_id,ord,type,prompt,answer,exercise_id,options_json,answer_json,content_json,source) VALUES('b',?,0,'CHOICE','Choose','yes','ex1',?,?,?,'TEXTBOOK')").run(chapter,JSON.stringify(['yes','no']),JSON.stringify({optionIds:['o1']}),JSON.stringify({options:[{id:'o1',text:'yes'},{id:'o2',text:'no'}]}));
   }
   expect(runMigrations(db).applied).toEqual([37,38,39,40]);
   for(const table of ['textbook_knowledge','textbook_sentences','textbook_exercise_items']) expect(db.query(`SELECT count(*) AS n,count(DISTINCT id) AS ids FROM ${table}`).get()).toEqual({n:2,ids:2});
   expect(db.query('SELECT answer_json FROM textbook_exercise_items').all()).toEqual([{answer_json:'["yes"]'},{answer_json:'["yes"]'}]);
   expect(db.query('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
  }finally{db.close();}
 });
});
