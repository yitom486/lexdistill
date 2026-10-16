import {expect,it} from 'bun:test';
import {Database} from 'bun:sqlite';
import {initSchema,runDoctor} from '@lexdistill/storage-sqlite';
it('doctor checks current chapter membership, content order and audit references without writing',()=>{
 const db=new Database(':memory:');try {
  initSchema(db);expect(runDoctor(db).errors).toEqual([]);
  db.run("INSERT INTO documents(id,user_id,title,source_kind,language,content,created_at,updated_at,chapters_json) VALUES('b','u','B','user_import','ja','','t','t','[{\"id\":\"c\"}]')");
  db.run("INSERT INTO textbook_articles(id,document_id,chapter_id,ord,text,source) VALUES('a1','b','missing',-1,'one','TEXTBOOK'),('a2','b','missing',-1,'two','TEXTBOOK')");
  const before=db.query('SELECT * FROM textbook_articles').all();
  const result=runDoctor(db);
  for(const rule of ['chapter-orphan:textbook_articles','ord-negative:textbook_articles','ord-dup:textbook_articles']) expect(result.findings.find(f=>f.rule===rule)?.level).toBe('FAIL');
  expect(db.query('SELECT * FROM textbook_articles').all()).toEqual(before);
 } finally{db.close();}
});
