import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * P1-D1 映射去重（v30 起 term_map 表退役，计数只在 shred 内存统计）。
 * 不变量：
 * - AST vocab.id / grammar.id 为位置性 ID，不得透传或持久化；
 * - textbook_vocab / grammar 保留全部 occurrence 及 ord，不得去重/删除/合并；
 * - 去重键 = 截断/清洗后的 (document_id, lesson_id, kind, 文本)，同课同 kind 同文本只计首条；
 * - vocab/grammar（kind 不同）与跨 lesson 永不互斥；
 * - 断言口径：mappedEntries + unmapped == 去重后期望条数（命中与否看种子词典，不锁定）。
 */

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function docBase(id: string) {
  return {
    id, userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja',
    content: 'c', createdAt: 'x', updatedAt: 'x',
  };
}

function lesson(id: string, n: number, vocabs: Array<{ kanji: string; kana?: string; chinese?: string }>, grammars: string[] = []) {
  return {
    id, lessonNumber: n, title: `t${n}`,
    vocabularies: vocabs.map((v, i) => ({
      id: `${id}-v${i + 1}`, kanji: v.kanji, kana: v.kana ?? 'かな', chinese: v.chinese ?? '义',
    })),
    grammarPoints: grammars.map((t, i) => ({
      id: `${id}-g${i + 1}`, title: t, connection: '接续', explanation: '说明',
      examples: [{ japanese: '食べます。', chinese: '吃。' }],
    })),
    dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
    exercises: [],
  };
}

function book(lessons: Array<ReturnType<typeof lesson>>) {
  return { id: 'b1', language: 'JA', title: 'B', shortTitle: 'B', lessons };
}

describe('P1-D1 映射去重计数', () => {
  it('同课重复 vocab surface：shred 成功；occurrence 两行；映射只计一条', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book([lesson('l1', 1, [{ kanji: '食べる' }, { kanji: '食べる', chinese: '吃（重复）' }])]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const v = repo.getRawDb().query('SELECT ord AS o, surface AS s FROM textbook_vocab WHERE document_id=? ORDER BY ord').all('d1') as Array<{ o: number; s: string }>;
    expect(v).toEqual([{ o: 0, s: '食べる' }, { o: 1, s: '食べる' }]);
    const fts = repo.getRawDb().query("SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id=? AND kind='vocab'").get('d1') as { n: number };
    expect(fts.n).toBe(2);
    expect(res.value.mappedEntries + res.value.unmapped).toBe(1);
  });

  it('同课重复 grammar title：shred 成功；grammar 两行；映射只计一条', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book([lesson('l1', 1, [], ['〜ます', '〜ます'])]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const g = repo.getRawDb().query('SELECT ord AS o, title AS t FROM textbook_grammar WHERE document_id=? ORDER BY ord').all('d1') as Array<{ o: number; t: string }>;
    expect(g).toEqual([{ o: 0, t: '〜ます' }, { o: 1, t: '〜ます' }]);
    expect(res.value.mappedEntries + res.value.unmapped).toBe(1);
  });

  it('vocab 与 grammar 同文本：kind 不同，各计一条（不互斥）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const l = lesson('l1', 1, [{ kanji: '食べる' }], ['食べる']);
    const b = book([l]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.mappedEntries + res.value.unmapped).toBe(2);
  });

  it('跨课同文本：各课各计一条（不跨 lesson 去重）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book([
      lesson('l1', 1, [{ kanji: '社員' }]),
      lesson('l2', 2, [{ kanji: '社員' }]),
    ]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.mappedEntries + res.value.unmapped).toBe(2);
  });

  it('截断后碰撞：两不同长文本经 slice(0,64) 相同，去重后只计一条但 occurrence 两行', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const prefix = 'あ'.repeat(64);
    const b = book([lesson('l1', 1, [{ kanji: prefix + 'X' }, { kanji: prefix + 'Y' }])]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const v = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_vocab WHERE document_id=?').get('d1') as { n: number };
    expect(v.n).toBe(2);
    expect(res.value.mappedEntries + res.value.unmapped).toBe(1);
  });

  it('非映射的真实 shred 错误仍整体回滚（去重不掩盖）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    // 破坏 shred 必经表：textbook_lines 缺席使 shred 抛错（与 P1-A0 原子回滚同口径）
    repo.getRawDb().run('DROP TABLE textbook_lines');
    const b = book([lesson('l1', 1, [{ kanji: '食べる' }])]);
    const res = await repo.saveCanonicalAst(docBase('d1'), b as never);
    expect(isOk(res)).toBe(false);
  });

  it('无重复 fixture 结果不变（行数/映射/统计口径与此前一致）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const b = book([lesson('l1', 1, [{ kanji: '食べる' }, { kanji: '飲む' }], ['〜ます'])]);
    const res = await repo.shredDocument('d1', b as never);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const db = repo.getRawDb();
    const cv = (db.query('SELECT COUNT(*) AS n FROM textbook_vocab WHERE document_id=?').get('d1') as { n: number }).n;
    const cg = (db.query('SELECT COUNT(*) AS n FROM textbook_grammar WHERE document_id=?').get('d1') as { n: number }).n;
    const cl = (db.query('SELECT COUNT(*) AS n FROM textbook_lines WHERE document_id=?').get('d1') as { n: number }).n;
    const cf = (db.query("SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id=? AND kind='vocab'").get('d1') as { n: number }).n;
    expect({ cv, cg, cl, cf }).toEqual({ cv: 2, cg: 1, cl: 1, cf: 2 });
    expect(res.value.mappedEntries + res.value.unmapped).toBe(3);
  });
});
