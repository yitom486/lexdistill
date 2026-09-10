import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  planLessonOrdering,
  applyLessonOrdering,
  verifyDense,
} from '../infrastructure/db/lesson-ordering.js';

const dbs: Database[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

function mem(): Database {
  const db = new Database(':memory:');
  dbs.push(db);
  db.run(`CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, ast_json TEXT)`);
  db.run(
    `CREATE TABLE textbook_lessons (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, lesson_number INTEGER NOT NULL, title TEXT NOT NULL, sort_order INTEGER, PRIMARY KEY (document_id, lesson_id))`
  );
  return db;
}

function astOf(numbers: number[]): string {
  return JSON.stringify({
    id: 'b1',
    language: 'JA',
    title: 'B',
    shortTitle: 'B',
    lessons: numbers.map((n, i) => ({
      id: `l${i + 1}`,
      lessonNumber: n,
      title: `第${n}課`,
      vocabularies: [],
      grammarPoints: [],
      dialogues: [],
      exercises: [],
    })),
  });
}

function seedDerived(db: Database, docId: string, rows: Array<{ id: string; n: number }>): void {
  const ins = db.prepare(
    'INSERT INTO textbook_lessons (document_id, lesson_id, lesson_number, title) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((list: typeof rows) => {
    for (const r of list) ins.run(docId, r.id, r.n, `t${r.n}`);
  });
  tx(rows);
}

describe('lesson-ordering plan（只读 dry-run）', () => {
  it('match：gap number 照回 index+1', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([15, 16, 18, 20]));
    seedDerived(db, 'd1', [
      { id: 'l1', n: 15 },
      { id: 'l2', n: 16 },
      { id: 'l3', n: 18 },
      { id: 'l4', n: 20 },
    ]);
    const plan = planLessonOrdering(db);
    expect(plan.unresolvedCount).toBe(0);
    const d = plan.docs[0]!;
    expect(d.status).toBe('ok');
    expect(d.updates).toEqual([
      { lessonId: 'l1', sortOrder: 1 },
      { lessonId: 'l2', sortOrder: 2 },
      { lessonId: 'l3', sortOrder: 3 },
      { lessonId: 'l4', sortOrder: 4 },
    ]);
  });

  it('missing/extra：unresolved，不猜', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([1, 2, 3]));
    seedDerived(db, 'd1', [
      { id: 'l1', n: 1 },
      { id: 'l2', n: 2 },
      { id: 'lx', n: 99 },
    ]);
    const plan = planLessonOrdering(db);
    const d = plan.docs[0]!;
    expect(d.status).toBe('unresolved');
    expect(d.missing).toEqual(['l3']);
    expect(d.extra).toEqual(['lx']);
    expect(d.updates).toEqual([]);
  });

  it('invalid AST + 有 Derived：unresolved；无 Derived 的非教材形：skipped', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('bad','B','{broken')`).run();
    seedDerived(db, 'bad', [{ id: 'l1', n: 1 }]);
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('news','N',?)`).run(
      JSON.stringify({ id: 'news', questions: [] })
    );
    const plan = planLessonOrdering(db);
    const byId = new Map(plan.docs.map((d) => [d.documentId, d]));
    expect(byId.get('bad')?.status).toBe('unresolved');
    expect(byId.get('news')?.status).toBe('skipped');
  });

  it('duplicate lesson id：schema 直接拒收 → unresolved（不猜）', () => {
    const db = mem();
    const raw = JSON.parse(astOf([1, 2])) as { lessons: Array<{ id: string }> };
    raw.lessons[1]!.id = 'l1';
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(JSON.stringify({
      id: 'b1',
      language: 'JA',
      title: 'B',
      shortTitle: 'B',
      lessons: raw.lessons.map((l, i) => ({
        ...l,
        lessonNumber: i + 1,
        title: 't',
        vocabularies: [],
        grammarPoints: [],
        dialogues: [],
        exercises: [],
      })),
    }));
    seedDerived(db, 'd1', [{ id: 'l1', n: 1 }]);
    const plan = planLessonOrdering(db);
    // P1-C0.75 Task 3 后：重复 id 过不了 parseTextbookAST，走“AST 非法但有 Derived”分支
    expect(plan.docs[0]?.status).toBe('unresolved');
    expect(plan.docs[0]?.updates).toEqual([]);
  });
});

describe('lesson-ordering apply（显式写）', () => {
  it('有 unresolved 即整体拒绝，零写入', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([1, 2]));
    seedDerived(db, 'd1', [
      { id: 'l1', n: 1 },
      { id: 'lx', n: 9 },
    ]);
    const plan = planLessonOrdering(db);
    expect(() => applyLessonOrdering(db, plan)).toThrow();
    const n = db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE sort_order IS NOT NULL').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('成功写入 + 幂等重跑 + post-verify', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([15, 16, 18, 20]));
    seedDerived(db, 'd1', [
      { id: 'l1', n: 15 },
      { id: 'l2', n: 16 },
      { id: 'l3', n: 18 },
      { id: 'l4', n: 20 },
    ]);
    const first = applyLessonOrdering(db, planLessonOrdering(db));
    expect(first).toMatchObject({ documents: 1, rows: 4, verified: true });
    expect(verifyDense(db)).toBe(true);
    const second = applyLessonOrdering(db, planLessonOrdering(db));
    expect(second).toMatchObject({ documents: 1, rows: 4, verified: true });
  });

  it('单行断言失败即整事务回滚', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([1, 2]));
    seedDerived(db, 'd1', [
      { id: 'l1', n: 1 },
      { id: 'l2', n: 2 },
    ]);
    // 手工构造带坏行的 plan（l-ghost 不存在）：第一行写完后第二行断言炸，事务必须整体回滚
    const plan = planLessonOrdering(db);
    const hacked = {
      ...plan,
      docs: plan.docs.map((d) =>
        d.documentId === 'd1'
          ? { ...d, updates: [...d.updates, { lessonId: 'l-ghost', sortOrder: 99 }] }
          : d
      ),
    };
    expect(() => applyLessonOrdering(db, hacked)).toThrow();
    const n = db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE sort_order IS NOT NULL').get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('verifyDense 连续性', () => {
  it('NULL/重复/断号/<=0/非整数皆判假', () => {
    const db = mem();
    db.query(`INSERT INTO documents (id, title, ast_json) VALUES ('d1','B',?)`).run(astOf([1, 2, 3]));
    const set = (id: string, v: unknown): void => {
      db.query(`INSERT INTO textbook_lessons (document_id, lesson_id, lesson_number, title, sort_order) VALUES ('d1',?,1,'t',?)`).run(id, v as number);
    };
    set('l1', 1);
    set('l2', null);
    set('l3', 3);
    expect(verifyDense(db)).toBe(false);
    db.run(`UPDATE textbook_lessons SET sort_order = 2 WHERE lesson_id = 'l2'`);
    db.run(`UPDATE textbook_lessons SET sort_order = 2 WHERE lesson_id = 'l3'`);
    expect(verifyDense(db)).toBe(false); // 重复
    db.run(`UPDATE textbook_lessons SET sort_order = 5 WHERE lesson_id = 'l3'`);
    expect(verifyDense(db)).toBe(false); // 断号（max!=count）
    db.run(`UPDATE textbook_lessons SET sort_order = 3 WHERE lesson_id = 'l3'`);
    expect(verifyDense(db)).toBe(true);
    db.run(`UPDATE textbook_lessons SET sort_order = 0 WHERE lesson_id = 'l3'`);
    expect(verifyDense(db)).toBe(false); // <=0
  });
});
