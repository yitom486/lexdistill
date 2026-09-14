import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { DictionaryLookupTool } from '../modules/dictionary/tools/dictionary-lookup-tool.js';

/**
 * P3-1 阅读上下文最小接线。
 * - lookup 可选 documentId/quote：自有文档落 occurrence 归属；
 *   跨用户文档查词仍返回词条但不写 occurrence（读为公共资产，写须归属）；
 *   旧调用（无上下文）行为不变；
 * - 批注成功后显式 selection capture；幽灵文档批注仍成功但无选区行（不伪报）。
 */
describe('reading context (P3-1)', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    repo
      .getRawDb()
      .prepare(
        `INSERT INTO local_dictionary_entries (
          id, language, headword, reading, romanization, meanings_json,
          pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
        ) VALUES ('e1', 'ja', '曖昧', 'あいまい', NULL, '["含糊"]', NULL, NULL, 'test', 'test', 'test', 't')`
      )
      .run();
    repo
      .getRawDb()
      .prepare(
        `INSERT INTO documents (id, user_id, title, source_kind, language, content, created_at, updated_at)
         VALUES ('dA', 'uA', 'T', 'user_import', 'ja', 'c', 't', 't'),
                ('dC', 'default_user', 'S', 'curriculum_textbook', 'ja', 'c', 't', 't')`
      )
      .run();
  });

  function occurrences(userId: string): Array<{ document_id: string | null; quote: string | null }> {
    return repo
      .getRawDb()
      .query<{ document_id: string | null; quote: string | null }, [string]>(
        'SELECT document_id AS document_id, quote AS quote FROM term_occurrences WHERE user_id = ?'
      )
      .all(userId);
  }

  it('自有文档查词：occurrence 带 documentId/quote', async () => {
    const tool = new DictionaryLookupTool(repo);
    const res = await tool.execute(
      { language: 'ja', query: '曖昧', documentId: 'dA', quote: '曖昧な態度' },
      { userId: 'uA', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    expect(occurrences('uA')).toEqual([{ document_id: 'dA', quote: '曖昧な態度' }]);
  });

  it('跨用户文档查词：词条照返，occurrence 零写入', async () => {
    const tool = new DictionaryLookupTool(repo);
    const res = await tool.execute(
      { language: 'ja', query: '曖昧', documentId: 'dA', quote: '曖昧な態度' },
      { userId: 'uB', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    expect(occurrences('uB')).toEqual([]);
  });

  it('旧调用兼容：无上下文查词 occurrence 文档为空', async () => {
    const tool = new DictionaryLookupTool(repo);
    const res = await tool.execute({ language: 'ja', query: '曖昧' }, { userId: 'uA', sessionId: 's1' });
    expect(isOk(res)).toBe(true);
    expect(occurrences('uA')).toEqual([{ document_id: null, quote: null }]);
  });

  it('批注成功后显式 capture：选区行存在', async () => {
    const saved = await repo.saveAnnotation({
      id: 'ann1',
      documentId: 'dA',
      userId: 'uA',
      kind: 'VOCAB',
      quote: '曖昧な態度',
      startOffset: 0,
      endOffset: 5,
      createdBy: 'USER',
      createdAt: 't',
    });
    expect(isOk(saved)).toBe(true);
    const rows = repo
      .getRawDb()
      .query<{ id: string; document_id: string | null }, []>(
        'SELECT id AS id, document_id AS document_id FROM selection_contexts'
      )
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.document_id).toBe('dA');
  });

  it('幽灵文档批注：批注仍成功，选区零写入（不伪报）', async () => {
    const saved = await repo.saveAnnotation({
      id: 'ann-ghost',
      documentId: 'ghost-doc',
      userId: 'uA',
      kind: 'VOCAB',
      quote: '曖昧',
      startOffset: 0,
      endOffset: 2,
      createdBy: 'USER',
      createdAt: 't',
    });
    expect(isOk(saved)).toBe(true);
    const n = repo
      .getRawDb()
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM selection_contexts')
      .get();
    expect(n!.n).toBe(0);
  });
});
