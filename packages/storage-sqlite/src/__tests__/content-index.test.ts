import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import { initSchema, runMigrations } from '../ddl.js';
import {
  projectContentSegments,
  listContentSegments,
  segmentHash,
  chunkTextToSegments,
} from '../adapters/library/content-segments.js';
import {
  ensureCanonicalContentSources,
  interpretSourceKind,
  getContentSource,
} from '../adapters/library/content-sources.js';
import { captureSelectionContext } from '../adapters/library/selection-contexts.js';
import {
  recordTermExposure,
  recordReadingExposures,
  buildTermKey,
} from '../adapters/dictionary/encountered-terms.js';
import { V027_RECOUNT_SQL } from '../migrations/v027-encountered-term-counts.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

/** P1-3a：documents 行播种（投影／选区的前置归属）。 */
function seedDoc(db: Database, id: string, userId: string, sourceKind: string): void {
  db.prepare(
    `INSERT INTO documents (id, user_id, title, source_kind, language, content, created_at, updated_at)
     VALUES (?, ?, 'T', ?, 'ja', 'c', 't', 't')`
  ).run(id, userId, sourceKind);
}

describe('P2-1 chunkTextToSegments（换行／Unicode 偏移／空段）', () => {
  it('空行分段＋偏移回代一致', () => {
    const content = '第一段内容\n\n第二段内容';
    const chunks = chunkTextToSegments(content);
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      expect(content.slice(c.start, c.end)).toBe(c.text);
    }
    expect(chunks[0]).toMatchObject({ text: '第一段内容', start: 0 });
  });

  it('\\r\\n 与空白行统一处理，空段丢弃不占位', () => {
    const content = 'A\r\n\r\n   \r\nB\n\n\nC';
    const chunks = chunkTextToSegments(content);
    expect(chunks.map((c) => c.text)).toEqual(['A', 'B', 'C']);
    for (const c of chunks) {
      expect(content.slice(c.start, c.end)).toBe(c.text);
    }
  });

  it('emoji／代理对偏移一致（UTF-16 码元语义）', () => {
    const content = '你好🌸世界\n\n第二段🎉';
    const chunks = chunkTextToSegments(content);
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      expect(content.slice(c.start, c.end)).toBe(c.text);
    }
    expect(chunks[1]!.text).toBe('第二段🎉');
  });

  it('纯空白输入得零段', () => {
    expect(chunkTextToSegments('   \n\n  ')).toEqual([]);
    expect(chunkTextToSegments('')).toEqual([]);
  });
});

describe('P1-3 content-segments', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('投影→列表：ord 致密，hash 作用域化', async () => {
    seedDoc(db, 'd1', 'u1', 'user_import');
    const res = await projectContentSegments({ sqlite: db }, {
      userId: 'u1',
      documentId: 'd1',
      texts: ['第一段', '第二段', '第三段'],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({ inserted: 3, skipped: 0 });
    const listed = await listContentSegments({ sqlite: db }, 'd1');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.map((s) => s.ord)).toEqual([0, 1, 2]);
    expect(listed.value.every((s) => s.lessonId === '')).toBe(true);
  });

  it('重跑幂等：同 hash 全跳过，零重复行', async () => {
    seedDoc(db, 'd1', 'u1', 'user_import');
    const input = { userId: 'u1', documentId: 'd1', texts: ['甲', '乙'] };
    const first = await projectContentSegments({ sqlite: db }, input);
    expect(isOk(first) && first.value.inserted).toBe(2);
    const second = await projectContentSegments({ sqlite: db }, input);
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value).toEqual({ inserted: 0, skipped: 2 });
    const n = db.query('SELECT COUNT(*) AS n FROM content_segments').get() as { n: number };
    expect(n.n).toBe(2);
  });

  it('相同文本跨文档不冲突（作用域 hash）', async () => {
    seedDoc(db, 'd1', 'u1', 'user_import');
    seedDoc(db, 'd2', 'u1', 'user_import');
    await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd1', texts: ['同文'] });
    const res = await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd2', texts: ['同文'] });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.inserted).toBe(1);
    expect(segmentHash('d1', '', 0, '同文')).not.toBe(segmentHash('d2', '', 0, '同文'));
  });

  it('同作用域不同文本即漂移 fail-closed', async () => {
    seedDoc(db, 'd1', 'u1', 'user_import');
    await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd1', texts: ['原文'] });
    const res = await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd1', texts: ['改文'] });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_SEGMENT_SCOPE_CONFLICT');
  });

  it('读永不写：空文档返回空数组', async () => {
    const listed = await listContentSegments({ sqlite: db }, 'ghost');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value).toEqual([]);
  });
});

describe('P1-3 content-sources', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('规范行幂等写入 6 行，重跑零重复', async () => {
    const first = await ensureCanonicalContentSources({ sqlite: db });
    expect(isOk(first)).toBe(true);
    const second = await ensureCanonicalContentSources({ sqlite: db });
    expect(isOk(second)).toBe(true);
    const n = db.query('SELECT COUNT(*) AS n FROM content_sources').get() as { n: number };
    expect(n.n).toBe(6);
  });

  it('display 可变不破坏身份', async () => {
    await ensureCanonicalContentSources({ sqlite: db });
    db.run("UPDATE content_sources SET display_name = '改名' WHERE id = 'csrc-user-pdf'");
    const again = await ensureCanonicalContentSources({ sqlite: db });
    expect(isOk(again)).toBe(true);
    const row = db
      .query('SELECT display_name AS d FROM content_sources WHERE id = ?')
      .get('csrc-user-pdf') as { d: string };
    // ON CONFLICT DO NOTHING：展示名保持用户侧修改，不被种子覆盖。
    expect(row.d).toBe('改名');
  });

  it('interpretSourceKind：归属／格式双轴解释，未知 fail-closed', () => {
    expect(interpretSourceKind('curriculum_textbook')).toEqual({
      format: 'text',
      origin: 'curriculum_textbook',
      originRef: '',
    });
    expect(interpretSourceKind('epub')).toEqual({ format: 'epub', origin: 'user_import', originRef: '' });
    // user_import 单值不定格式：不臆造。
    expect(interpretSourceKind('user_import').format).toBe('');
    expect(() => interpretSourceKind('nope')).toThrow();
  });

  it('getContentSource 命中／缺失', async () => {
    await ensureCanonicalContentSources({ sqlite: db });
    const hit = await getContentSource({ sqlite: db }, 'pdf', 'user_import', '');
    expect(isOk(hit) && hit.value?.id).toBe('csrc-user-pdf');
    const miss = await getContentSource({ sqlite: db }, 'audio', 'user_import', '');
    expect(isOk(miss) && miss.value).toBe(null);
  });
});

describe('P1-3 selection-contexts（SI-1/2/3）', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('段选区：document 缺省时以段归属回填', async () => {
    seedDoc(db, 'd9', 'u1', 'user_import');
    await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd9', texts: ['可点文本'] });
    const segs = await listContentSegments({ sqlite: db }, 'd9');
    if (!isOk(segs)) return;
    const res = await captureSelectionContext({ sqlite: db }, {
      userId: 'u1',
      language: 'ja',
      segmentId: segs.value[0]!.id,
      surface: '可点',
      normalizedText: '可点文本',
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.documentId).toBe('d9');
  });

  it('SI-1：三空拒绝', async () => {
    const res = await captureSelectionContext({ sqlite: db }, {
      userId: 'u1',
      language: 'ja',
      surface: 'x',
      normalizedText: '',
    });
    expect(isOk(res)).toBe(false);
  });

  it('SI-2：归属不一致拒绝；未知段拒绝', async () => {
    seedDoc(db, 'd9', 'u1', 'user_import');
    seedDoc(db, 'other-doc', 'u1', 'user_import');
    await projectContentSegments({ sqlite: db }, { userId: 'u1', documentId: 'd9', texts: ['文本'] });
    const segs = await listContentSegments({ sqlite: db }, 'd9');
    if (!isOk(segs)) return;
    const clash = await captureSelectionContext({ sqlite: db }, {
      userId: 'u1',
      language: 'ja',
      documentId: 'other-doc',
      segmentId: segs.value[0]!.id,
      surface: 'x',
      normalizedText: 'y',
    });
    expect(isOk(clash)).toBe(false);
    const ghost = await captureSelectionContext({ sqlite: db }, {
      userId: 'u1',
      language: 'ja',
      segmentId: 'seg_ghost',
      surface: 'x',
      normalizedText: 'y',
    });
    expect(isOk(ghost)).toBe(false);
  });
});

describe('P1-3 v22 旧库升级 v23–v27', () => {
  it('旧库应用 23–27：新表/加列/回填一次到位，重跑零重复', () => {
    const db = freshDb();
    // 退回 v22 时代形状。
    db.run('DROP TABLE content_segments');
    db.run('DROP TABLE content_sources');
    db.run('DROP TABLE selection_contexts');
    db.run('ALTER TABLE card_drafts DROP COLUMN selection_context_id');
    db.run('ALTER TABLE term_occurrences DROP COLUMN segment_id');
    db.run('ALTER TABLE term_occurrences DROP COLUMN lesson_id');
    db.run('ALTER TABLE encountered_terms DROP COLUMN lookup_count');
    db.run('ALTER TABLE encountered_terms DROP COLUMN read_count');
    db.run('DELETE FROM schema_migrations WHERE version >= 23');
    // 历史行（旧列形状）。
    db.run(
      `INSERT INTO encountered_terms
         (user_id, language, term_key, headword, reading, status,
          exposure_count, first_seen_at, last_seen_at, flashcard_id)
       VALUES ('u9', 'ja', 'k', '橋', 'はし', 'new', 2, 't1', 't2', NULL)`
    );
    db.run(
      `INSERT INTO term_occurrences
         (id, user_id, language, term_key, source, document_id, quote, created_at)
       VALUES ('o1', 'u9', 'ja', 'k', 'lookup', NULL, NULL, 't1'),
              ('o2', 'u9', 'ja', 'k', 'reading', 'd1', NULL, 't2')`
    );
    const res = runMigrations(db);
    expect(res.applied).toEqual([23, 24, 25, 26, 27]);
    const row = db
      .query(
        'SELECT exposure_count AS e, lookup_count AS l, read_count AS r FROM encountered_terms'
      )
      .get() as { e: number; l: number; r: number };
    expect(row).toEqual({ e: 2, l: 1, r: 1 });
    const seg = db.query('SELECT COUNT(*) AS n FROM content_segments').get() as { n: number };
    expect(seg.n).toBe(0);
    const src = db.query('SELECT COUNT(*) AS n FROM content_sources').get() as { n: number };
    expect(src.n).toBe(0);
    // 重跑幂等：无新 apply。
    expect(runMigrations(db).applied).toEqual([]);
  });
});

describe('P1-3 encountered-term counts（CI-1/2/3/5）', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('分计数按来源折算：lookup/read/collect', async () => {
    const deps = { sqlite: db };
    await recordTermExposure(deps, { userId: 'u1', language: 'ja', headword: '曖昧', reading: 'あいまい', source: 'lookup' });
    await recordTermExposure(deps, { userId: 'u1', language: 'ja', headword: '曖昧', reading: 'あいまい', source: 'lookup' });
    await recordTermExposure(deps, { userId: 'u1', language: 'ja', headword: '曖昧', reading: 'あいまい', source: 'reading', documentId: 'd1' });
    const collected = await recordTermExposure(deps, {
      userId: 'u1', language: 'ja', headword: '曖昧', reading: 'あいまい',
      source: 'collect', markCollected: true, flashcardId: 'c1',
    });
    expect(isOk(collected)).toBe(true);
    if (!isOk(collected)) return;
    expect(collected.value.exposureCount).toBe(4);
    expect(collected.value.lookupCount).toBe(2);
    expect(collected.value.readCount).toBe(1);
    expect(collected.value.status).toBe('collected');
    expect(buildTermKey('曖昧', 'あいまい')).toBe(collected.value.termKey);
  });

  it('reading 批量走 read 计数', async () => {
    const deps = { sqlite: db };
    const res = await recordReadingExposures(deps, {
      userId: 'u1',
      language: 'ja',
      documentId: 'd1',
      lessonId: 'l1',
      terms: [{ headword: '桜', reading: 'さくら' }],
    });
    expect(isOk(res)).toBe(true);
    const row = db
      .query('SELECT exposure_count AS e, lookup_count AS l, read_count AS r FROM encountered_terms')
      .get() as { e: number; l: number; r: number };
    expect(row).toEqual({ e: 1, l: 0, r: 1 });
  });

  it('v027 回填：清零后重放恢复，重跑稳定', async () => {
    const deps = { sqlite: db };
    await recordTermExposure(deps, { userId: 'u1', language: 'ja', headword: '曖昧', source: 'lookup' });
    await recordTermExposure(deps, { userId: 'u1', language: 'ja', headword: '曖昧', source: 'import', documentId: 'd1' });
    // 模拟 v027 前历史行：计数清零。
    db.run('UPDATE encountered_terms SET lookup_count = 0, read_count = 0');
    for (const sql of V027_RECOUNT_SQL) db.run(sql);
    const row = db
      .query('SELECT lookup_count AS l, read_count AS r FROM encountered_terms')
      .get() as { l: number; r: number };
    expect(row).toEqual({ l: 1, r: 1 });
    for (const sql of V027_RECOUNT_SQL) db.run(sql);
    const again = db
      .query('SELECT lookup_count AS l, read_count AS r FROM encountered_terms')
      .get() as { l: number; r: number };
    expect(again).toEqual({ l: 1, r: 1 });
  });
});

describe('P1-3a 文档隔离（自有／跨用户／公共／不一致／孤儿）', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    seedDoc(db, 'dA', 'uA', 'user_import');
    seedDoc(db, 'dC', 'default_user', 'curriculum_textbook');
    seedDoc(db, 'dB', 'uB', 'user_import');
  });

  function codeOf(r: unknown): string {
    return !isOk(r as never) ? (r as { error: { code: string } }).error.code : 'OK';
  }

  it('自有：投影＋选区通过', async () => {
    const p = await projectContentSegments({ sqlite: db }, {
      userId: 'uA',
      documentId: 'dA',
      texts: ['自有文本'],
    });
    expect(isOk(p)).toBe(true);
    const s = await captureSelectionContext({ sqlite: db }, {
      userId: 'uA',
      language: 'ja',
      documentId: 'dA',
      surface: '自有',
      normalizedText: '自有文本',
    });
    expect(isOk(s)).toBe(true);
  });

  it('跨用户：投影／文档选区／段选区统一 E_NOT_FOUND', async () => {
    await projectContentSegments({ sqlite: db }, { userId: 'uA', documentId: 'dA', texts: ['t'] });
    const segs = await listContentSegments({ sqlite: db }, 'dA');
    if (!isOk(segs)) return;
    const p = await projectContentSegments({ sqlite: db }, { userId: 'uB', documentId: 'dA', texts: ['t'] });
    expect(codeOf(p)).toBe('E_NOT_FOUND');
    const sDoc = await captureSelectionContext({ sqlite: db }, {
      userId: 'uB',
      language: 'ja',
      documentId: 'dA',
      surface: 'x',
      normalizedText: 'y',
    });
    expect(codeOf(sDoc)).toBe('E_NOT_FOUND');
    const sSeg = await captureSelectionContext({ sqlite: db }, {
      userId: 'uB',
      language: 'ja',
      segmentId: segs.value[0]!.id,
      surface: 'x',
      normalizedText: 'y',
    });
    expect(codeOf(sSeg)).toBe('E_NOT_FOUND');
  });

  it('公共教材：他用户投影＋选区通过', async () => {
    const p = await projectContentSegments({ sqlite: db }, {
      userId: 'uB',
      documentId: 'dC',
      texts: ['公共课文'],
    });
    expect(isOk(p)).toBe(true);
    const s = await captureSelectionContext({ sqlite: db }, {
      userId: 'uB',
      language: 'ja',
      documentId: 'dC',
      surface: '公共',
      normalizedText: '公共课文',
    });
    expect(isOk(s)).toBe(true);
  });

  it('归属不一致：文档与段分属两主拒绝', async () => {
    await projectContentSegments({ sqlite: db }, { userId: 'uB', documentId: 'dB', texts: ['乙文本'] });
    const segs = await listContentSegments({ sqlite: db }, 'dB');
    if (!isOk(segs)) return;
    const res = await captureSelectionContext({ sqlite: db }, {
      userId: 'uA',
      language: 'ja',
      documentId: 'dA',
      segmentId: segs.value[0]!.id,
      surface: 'x',
      normalizedText: 'y',
    });
    expect(isOk(res)).toBe(false);
  });

  it('孤儿：未知文档投影／选区统一 E_NOT_FOUND', async () => {
    const p = await projectContentSegments({ sqlite: db }, {
      userId: 'uA',
      documentId: 'ghost-doc',
      texts: ['t'],
    });
    expect(codeOf(p)).toBe('E_NOT_FOUND');
    const s = await captureSelectionContext({ sqlite: db }, {
      userId: 'uA',
      language: 'ja',
      documentId: 'ghost-doc',
      surface: 'x',
      normalizedText: 'y',
    });
    expect(codeOf(s)).toBe('E_NOT_FOUND');
    expect(db.query('SELECT COUNT(*) AS n FROM content_segments').get()).toEqual({ n: 0 });
  });
});
