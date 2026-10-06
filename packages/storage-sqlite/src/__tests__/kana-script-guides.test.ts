import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { KanaItemSchema, KanaLearningGuideSchema } from '@study-studio/protocol';
import { KANA_SEEDS } from '../seeds/kana-seed.js';
import { initSchema } from '../ddl.js';
import { seedInitialData } from '../seed-bootstrap.js';

const guide = (face: string, script: 'hiragana' | 'katakana' = 'hiragana') =>
  KANA_SEEDS.find((item) => item[script] === face)!.learningGuide!.scripts![script];

describe('逐字假名讲义', () => {
  it('104 个课程项目的两套字形讲义都通过传输契约，清音联想不共用模板', () => {
    expect(KANA_SEEDS).toHaveLength(104);
    for (const item of KANA_SEEDS) {
      expect(KanaItemSchema.safeParse(item).success).toBe(true);
      for (const script of ['hiragana', 'katakana'] as const) {
        const current = item.learningGuide!.scripts![script];
        expect(current.shapeFeatures.length).toBeGreaterThanOrEqual(2);
        expect(current.exampleWords.length).toBeGreaterThan(0);
        expect(current.recallQuestion).toContain(item[script]);
        expect(current.contrasts[0]!.kana).not.toBe(item[script]);
        expect(current.contrasts.every((contrast) => contrast.romaji.length > 0)).toBe(true);
      }
    }
    const basic = KANA_SEEDS.filter((item) => item.type === 'SEION' || item.type === 'SPECIAL');
    expect(new Set(basic.map((item) => item.learningGuide!.scripts!.hiragana.memoryTip)).size).toBe(46);
    expect(new Set(basic.map((item) => item.learningGuide!.scripts!.katakana.memoryTip)).size).toBe(46);
  });

  it('ア讲自己的滑梯和マ对照，不再展示あ的绳结或草书安字来源', () => {
    expect(guide('ア', 'katakana').memoryTip).toContain('滑梯');
    expect(guide('ア', 'katakana').memoryTip).not.toContain('绳子');
    expect(guide('ア', 'katakana').contrasts[0]!.kana).toBe('マ');
    expect(guide('ア', 'katakana').exampleWords[0]!.word).toBe('アイス');
    expect(guide('あ').contrasts[0]!.kana).toBe('お');
  });

  it('常见错形用实际笔画修正，シ/ツ和ソ/ン明确位置和方向', () => {
    expect(guide('へ').shapeFeatures.join(' ')).toContain('一笔');
    expect(guide('に').shapeFeatures.join(' ')).toContain('不会穿过');
    expect(guide('な').shapeFeatures.join(' ')).toContain('小圈');
    expect(guide('ぬ').contrasts[0]!.difference).toContain('右下');
    expect(guide('き').contrasts[0]!.difference).toContain('两道');
    expect(guide('シ', 'katakana').contrasts[0]!.kana).toBe('ツ');
    expect(guide('シ', 'katakana').contrasts[0]!.difference).toContain('右上向左下');
    expect(guide('ン', 'katakana').contrasts[0]!.difference).toContain('左下向右上');
  });

  it('拗音按小字和拍数对照，浊点与圆圈按主体而非套用不相关字形', () => {
    expect(guide('ギャ', 'katakana').contrasts[0]!.kana).toBe('ギヤ');
    expect(guide('ギャ', 'katakana').contrasts[0]!.difference).toContain('两拍');
    expect(guide('ギャ', 'katakana').shapeFeatures.join(' ')).toContain('浊点');
    expect(guide('パ', 'katakana').contrasts.map((item) => item.kana)).toEqual(['ハ', 'バ']);
    expect(guide('ぢ').contrasts.map((item) => item.kana)).toEqual(['ち', 'じ']);
    expect(guide('を').recallAnswer).toContain('读 o');
    expect(guide('ヲ', 'katakana').recallAnswer).toContain('读 o');
    expect(guide('づ').recallAnswer).toContain('读 zu');
  });

  it('旧版本讲义仍可解析，不要求用户库立即具备新字段', () => {
    expect(KanaLearningGuideSchema.safeParse({ soundDescription: 'a', memoryTip: '旧提示', pronunciationTip: '张口' }).success).toBe(true);
  });

  it('已有库重启更新课程讲义，学习状态保持原样；重复更新不增加课程行', () => {
    const db = new Database(':memory:');
    try {
      initSchema(db);
      db.run("UPDATE curriculum_kana SET learning_guide_json='{}' WHERE id='kana_a'");
      db.query('INSERT INTO kana_practice_states(user_id,kana_id,script_type,fsrs_json,consecutive_errors,updated_at) VALUES (?,?,?,?,?,?)')
        .run('existing-learner', 'kana_a', 'KATAKANA', '{"reps":8,"stability":4}', 2, '2026-10-01');
      const before = db.query('SELECT * FROM kana_practice_states').all();
      seedInitialData(db);
      const stored = db.query<{ learning_guide_json: string }, []>("SELECT learning_guide_json FROM curriculum_kana WHERE id='kana_a'").get()!;
      expect(KanaLearningGuideSchema.parse(JSON.parse(stored.learning_guide_json)).scripts!.katakana.memoryTip).toContain('滑梯');
      seedInitialData(db);
      expect(db.query<{ n: number }, []>('SELECT count(*) AS n FROM curriculum_kana').get()!.n).toBe(104);
      expect(db.query('SELECT * FROM kana_practice_states').all()).toEqual(before);
    } finally { db.close(); }
  });
});
