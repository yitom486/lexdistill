import {expect,it} from 'bun:test';
import {DrizzleLearnerRepository} from '../../../infrastructure/drizzle-learner-repository.js';
import type {TextbookAST} from '@lexdistill/document-model';
it('structured file import writes learning tables, keeps item IDs and examples, and replaces atomically',async()=>{
 const repo=new DrizzleLearnerRepository(':memory:');try {
  const doc={id:'b',userId:'u',title:'B',sourceKind:'user_import' as const,language:'ja',content:'',createdAt:'t',updatedAt:'t'};
  const book:TextbookAST={id:'b',title:'B',shortTitle:'B',level:'N5',language:'JA',lessons:[{
    id:'c',lessonNumber:19,title:'第19課',
    vocabularies:[{id:'v',kanji:'猫',kana:'ねこ',chinese:'cat',pos:'',pitchAccent:'',example:{japanese:'猫です',chinese:'It is a cat'}}],
    grammarPoints:[{id:'g',title:'です',explanation:'Polite ending',connection:'noun',examples:[{japanese:'猫です',chinese:'It is a cat'}]}],
    dialogues:[{speaker:'A',japanese:'猫です',chinese:'It is a cat'}],
    exercises:[{id:'e',type:'CHOICE',prompt:'Choose',options:['cat','dog'],answer:'cat'}]
  }]};
  expect((await repo.saveCanonicalAst(doc,book)).ok).toBe(true);
  expect((await repo.shredDocument('b',book)).ok).toBe(true);
  const db=repo.getRawDb();
  expect(db.query("SELECT id,answer_json FROM textbook_exercise_items WHERE document_id='b'").get()).toEqual({id:'e',answer_json:'"cat"'});
  expect(db.query("SELECT id,examples_json FROM textbook_knowledge WHERE document_id='b'").get()).toEqual({id:'g',examples_json:'[{"text":"猫です","translation":"It is a cat"}]'});
  expect(db.query("SELECT count(*) AS n FROM textbook_vocabulary WHERE document_id='b'").get()).toEqual({n:1});
  expect(db.query("SELECT json_extract(chapters_json,'$[0].order') AS n,ast_json FROM documents WHERE id='b'").get()).toEqual({n:1,ast_json:null});
  expect(db.query("SELECT ref FROM textbook_fts WHERE textbook_fts MATCH 'ねこ'").all()).toEqual([{ref:'v'}]);
  db.run("CREATE TRIGGER reject_articles BEFORE INSERT ON textbook_articles BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  const changed={...book,lessons:[{...book.lessons[0]!,dialogues:[],passageMd:'new article'}]};
  expect((await repo.saveCanonicalAst(doc,changed)).ok).toBe(false);
  expect(db.query("SELECT text FROM textbook_sentences WHERE document_id='b'").get()).toEqual({text:'猫です'});
  expect(db.query("SELECT count(*) AS n FROM global_vocabulary WHERE user_id='u'").get()).toEqual({n:1});
 }finally{repo.getRawDb().close();}
});
