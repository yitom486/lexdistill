import { afterEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import { binding, fixture, question } from './question-generation.fixtures.js';

function prepare(sqlite: Database) {
  for (const [id, user, language] of [['book', binding.userId, 'en'], ['foreign', 'other', 'en'], ['japanese', binding.userId, 'ja']]) {
    sqlite.query(`INSERT INTO documents (id,user_id,language,title,source_kind,content,chapters_json,created_at,updated_at)
      VALUES (?,?,?,'Textbook','TEXTBOOK','',?,?,?)`).run(id!, user!, language!, JSON.stringify([{ id: 'lesson', title: 'Lesson', order: 1, startPage: null, endPage: null, status: 'ready' }]), new Date().toISOString(), new Date().toISOString());
  }
  sqlite.query("INSERT INTO textbook_articles (id,document_id,chapter_id,ord,title,text,translation,source) VALUES ('article','book','lesson',0,'School','She is a student.','她是一名学生。','TEXTBOOK')").run();
  sqlite.query("INSERT INTO textbook_materials VALUES ('book','lesson','Simple present tense.',?)").run(new Date().toISOString());
}
describe('authorized structured textbook tools', () => {
  let f: ReturnType<typeof fixture>;
  afterEach(async () => { await f.tools.dispose(); f.sqlite.close(); });
  it('reads real chapter tables with pagination and accepts only authorized citations', async () => {
    f = fixture({ textbookScopes: [{ documentId: 'book', chapterId: 'lesson' }] }, undefined, prepare);
    const result = await f.invoke('generation.textbook', { documentId: 'book', chapterId: 'lesson', kind: 'articles', limit: 1 });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toMatchObject({ items: [{ id: 'article', text: 'She is a student.' }], nextOffset: null });
    for (const kind of ['knowledge', 'sentences', 'exercises', 'vocabulary', 'material']) expect(isOk(await f.invoke('generation.textbook', { documentId: 'book', chapterId: 'lesson', kind }))).toBe(true);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'citation', questions: [question({ citations: [{ documentId: 'book', chapterId: 'lesson' }] })] }))).toBe(true);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'bad-citation', questions: [question({ citations: [{ documentId: 'foreign', chapterId: 'lesson' }] })] }))).toBe(false);
  });
  it('rejects unconfigured chapters, other users and languages when creating tasks or reading textbooks', async () => {
    f = fixture({}, undefined, prepare);
    for (const documentId of ['book', 'foreign', 'japanese']) expect(isOk(await f.invoke('generation.textbook', { documentId, chapterId: 'lesson', kind: 'articles' }))).toBe(false);
    const cfg = f.repository.config(binding).config;
    for (const scope of [{ documentId: 'foreign', chapterId: 'lesson' }, { documentId: 'japanese', chapterId: 'lesson' }, { documentId: 'book', chapterId: 'missing' }]) {
      expect(() => f.repository.createTask({ ...binding, taskId: `bad-${scope.documentId}-${scope.chapterId}` }, { ...cfg, textbookScopes: [scope] }, f.expiresAt)).toThrow();
    }
  });
});
