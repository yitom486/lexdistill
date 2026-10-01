import {expect,it} from 'bun:test';
import {DrizzleLearnerRepository} from '../../../infrastructure/drizzle-learner-repository.js';
it('structured imports reuse global words across chapters and retain distinct readings',async()=>{
 const repo=new DrizzleLearnerRepository(':memory:');try {
  const lesson=(id:string,reading:string)=>({id,lessonNumber:1,title:id,vocabularies:[{id:'word-'+id,kanji:'橋',kana:reading,chinese:'bridge',pos:'',pitchAccent:''}],grammarPoints:[],dialogues:[],exercises:[]});
  expect((await repo.saveCanonicalAst({id:'b',userId:'u',title:'B',sourceKind:'user_import',language:'ja',content:'',createdAt:'t',updatedAt:'t'}, {id:'b',title:'B',shortTitle:'B',level:'N5',language:'JA',lessons:[lesson('c1','はし'),lesson('c2','はし'),lesson('c3','きょう')]})).ok).toBe(true);
  expect(repo.getRawDb().query("SELECT count(*) AS n FROM global_vocabulary WHERE user_id='u'").get()).toEqual({n:2});
  expect(repo.getRawDb().query("SELECT count(*) AS n FROM textbook_vocabulary WHERE document_id='b'").get()).toEqual({n:3});
  const linked=repo.getRawDb().query("SELECT vocabulary_id AS id FROM textbook_vocabulary WHERE chapter_id IN ('c1','c2')").all();
  expect(linked[0]).toEqual(linked[1]);
  expect(repo.getRawDb().query("SELECT DISTINCT jlpt_level FROM global_vocabulary WHERE user_id='u'").all()).toEqual([{jlpt_level:null}]);
 }finally{repo.getRawDb().close();}
});
