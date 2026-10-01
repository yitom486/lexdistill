import {expect,it} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migration} from '../../../../packages/storage-sqlite/src/migrations/v017-lesson-sort-order.js';
it('published v17 migration adds its historical column without rewriting data',()=>{
 const db=new Database(':memory:');try {
  db.run("CREATE TABLE textbook_lessons(document_id TEXT,lesson_id TEXT,lesson_number INTEGER,title TEXT)");
  db.run("INSERT INTO textbook_lessons VALUES('b','c',18,'第19課')");
  db.run(migration.sql);
  expect(db.query('SELECT lesson_number,sort_order FROM textbook_lessons').get()).toEqual({lesson_number:18,sort_order:null});
 } finally{db.close();}
});
