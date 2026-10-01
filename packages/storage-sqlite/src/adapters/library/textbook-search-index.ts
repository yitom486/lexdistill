import { eq, sql } from 'drizzle-orm';
import { globalVocabulary, textbookVocabulary, textbookArticles, textbookSentences } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
/** Raw SQL is limited to the FTS virtual table, which Drizzle does not model. */
export function rebuildTextbookSearchInTx(tx: Tx, documentId: string): number {
  tx.run(sql`DELETE FROM textbook_fts WHERE document_id = ${documentId}`);
  let n = 0;
  const words = tx.select({ local: textbookVocabulary, global: globalVocabulary }).from(textbookVocabulary).innerJoin(globalVocabulary, eq(textbookVocabulary.vocabularyId, globalVocabulary.id)).where(eq(textbookVocabulary.documentId, documentId)).all();
  for (const { local, global } of words) { tx.run(sql`INSERT INTO textbook_fts(surface,reading,gloss,document_id,lesson_id,kind,ref) VALUES(${global.word},${global.reading},${local.meaning},${documentId},${local.chapterId},'vocab',${local.id})`); n++; }
  for (const table of [textbookArticles, textbookSentences]) for (const row of tx.select().from(table).where(eq(table.documentId, documentId)).all()) {
    tx.run(sql`INSERT INTO textbook_fts(ja,zh,document_id,lesson_id,kind,ref) VALUES(${row.text},${row.translation},${documentId},${row.chapterId},'line',${row.id})`); n++;
  }
  return n;
}
