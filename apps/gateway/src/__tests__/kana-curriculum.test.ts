import { describe, it, expect, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { app } from '../index.js';
import { isOk } from '@lexdistill/shared';
import type { KanaItem } from '@lexdistill/protocol';

describe('Curriculum Kana Repository & Seeds (Companion Integration)', () => {
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_kana_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('should auto-seed and retrieve full kana curriculum dataset', async () => {
    const res = await repo.getCurriculumKana();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.length).toBeGreaterThanOrEqual(100);
      const a = res.value.find((k) => k.id === 'kana_a');
      expect(a).toBeDefined();
      expect(a?.hiragana).toBe('あ');
      expect(a?.katakana).toBe('ア');
      expect(a?.romaji).toBe('a');
      expect(a?.type).toBe('SEION');
      expect(a?.learningGuide?.soundDescription).toContain('张口');
      expect(a?.learningGuide?.memoryTip).toContain('啊');
      expect(a?.learningGuide?.pronunciationTip).toContain('下颌');
      expect(a?.learningGuide?.confusionNotes).toContain('お');
      expect(a?.learningGuide?.exampleWords?.[0]?.meaning).toBe('早上');

      const guides = res.value.flatMap((item) =>
        item.learningGuide ? [item.learningGuide] : []
      );
      expect(guides).toHaveLength(res.value.length);
      expect(
        guides.every((guide) =>
          Boolean(
            guide.soundDescription &&
              guide.memoryTip &&
              guide.pronunciationTip &&
              guide.confusionNotes
          )
        )
      ).toBe(true);
      expect(new Set(guides.map((guide) => guide.soundDescription)).size).toBeGreaterThan(80);
      expect(new Set(guides.map((guide) => guide.pronunciationTip)).size).toBeGreaterThan(80);
      expect(new Set(guides.map((guide) => guide.confusionNotes)).size).toBeGreaterThan(80);
      expect(
        guides.some((guide) => guide.soundDescription.includes('假名本身通常没有独立词义'))
      ).toBe(false);
      expect(
        guides.some((guide) =>
          Boolean(guide.confusionNotes?.includes('先看收笔方向和是否有圆圈'))
        )
      ).toBe(false);

      const su = res.value.find((k) => k.id === 'kana_su');
      expect(su?.katakana).toBe('ス');

      const tsu = res.value.find((k) => k.id === 'kana_tsu');
      expect(tsu?.learningGuide?.soundDescription).toContain('ts');
      expect(tsu?.learningGuide?.confusionNotes).toContain('す');

      const fu = res.value.find((k) => k.id === 'kana_fu');
      expect(fu?.learningGuide?.pronunciationTip).toContain('唇缝');

      const ra = res.value.find((k) => k.id === 'kana_ra');
      expect(ra?.learningGuide?.pronunciationTip).toContain('轻弹');

      const n = res.value.find((k) => k.id === 'kana_n');
      expect(n?.learningGuide?.soundDescription).toContain('鼻音拍');

      const wo = res.value.find((k) => k.id === 'kana_wo');
      expect(wo?.learningGuide?.confusionNotes).toContain('宾语助词');

      const dji = res.value.find((k) => k.id === 'kana_dji');
      expect(dji?.learningGuide?.soundDescription).toContain('じ');
      expect(dji?.learningGuide?.soundDescription).toContain('同音');

      const dzu = res.value.find((k) => k.id === 'kana_dzu');
      expect(dzu?.learningGuide?.soundDescription).toContain('ず');

      const kya = res.value.find((k) => k.id === 'kana_kya');
      expect(kya?.learningGuide?.soundDescription).toContain('一拍');
      expect(kya?.learningGuide?.confusionNotes).toContain('小「ゃ」');

      const pa = res.value.find((k) => k.id === 'kana_pa');
      expect(pa?.learningGuide?.confusionNotes).toContain('圆圈');
    }
  });

  it('should filter kana by type correctly', async () => {
    const seionRes = await repo.getCurriculumKana('SEION');
    expect(isOk(seionRes)).toBe(true);
    if (isOk(seionRes)) {
      expect(seionRes.value.length).toBe(45);
      expect(seionRes.value.every((k) => k.type === 'SEION')).toBe(true);
    }

    const dakuonRes = await repo.getCurriculumKana('DAKUON');
    expect(isOk(dakuonRes)).toBe(true);
    if (isOk(dakuonRes)) {
      expect(dakuonRes.value.length).toBe(20);
      expect(dakuonRes.value.every((k) => k.type === 'DAKUON')).toBe(true);
    }

    const yoonRes = await repo.getCurriculumKana('YOON');
    expect(isOk(yoonRes)).toBe(true);
    if (isOk(yoonRes)) {
      expect(yoonRes.value.length).toBe(33);
      expect(yoonRes.value.every((k) => k.type === 'YOON')).toBe(true);
    }
  });

  it('should record kana practice and update learner skill metrics & daily task activity', async () => {
    // 假名练习属于日语轨道；默认轨道为英语时必须显式切换，避免跨语种读取断言。
    const switchTrack = await repo.updateLearnerProfile(testUserId, { targetLanguage: 'ja' });
    expect(isOk(switchTrack)).toBe(true);

    // 第一次练习答对
    const practice1 = await repo.recordKanaPractice(testUserId, 'kana_a', true, 'HIRAGANA');
    expect(isOk(practice1)).toBe(true);
    if (isOk(practice1)) {
      expect(practice1.value.proficiency).toBe(1.0);
    }

    // 第二次练习答错
    const practice2 = await repo.recordKanaPractice(testUserId, 'kana_i', false, 'HIRAGANA');
    expect(isOk(practice2)).toBe(true);
    if (isOk(practice2)) {
      expect(practice2.value.proficiency).toBe(0.5);
    }

    // 检查画像指标中已产生 jp.kana.hiragana
    const snapshot = await repo.getProfileSnapshot(testUserId);
    expect(isOk(snapshot)).toBe(true);
    if (isOk(snapshot)) {
      const kanaMetric = snapshot.value.allMetrics.find((m) => m.id === 'jp.kana.hiragana');
      expect(kanaMetric).toBeDefined();
      expect(kanaMetric?.totalAttempts).toBe(2);
      expect(kanaMetric?.correctAttempts).toBe(1);
    }

    // 检查当日打卡活动记录
    const progress = await repo.getDailyTaskProgress(testUserId);
    expect(isOk(progress)).toBe(true);
    if (isOk(progress)) {
      expect(progress.value.quizzesCount).toBeGreaterThanOrEqual(2);
    }
  });

  it('should build a ten-item adaptive queue and promote a previously wrong kana', async () => {
    const switchTrack = await repo.updateLearnerProfile(testUserId, { targetLanguage: 'ja' });
    expect(isOk(switchTrack)).toBe(true);

    const initial = await repo.getAdaptiveKanaQueue(testUserId, {
      types: ['SEION', 'SPECIAL'],
      scriptType: 'HIRAGANA',
      limit: 10,
    });
    expect(isOk(initial)).toBe(true);
    if (isOk(initial)) {
      expect(initial.value).toHaveLength(10);
    }

    const wrong = await repo.recordKanaPractice(testUserId, 'kana_te', false, 'HIRAGANA');
    expect(isOk(wrong)).toBe(true);

    const afterWrong = await repo.getAdaptiveKanaQueue(testUserId, {
      types: ['SEION', 'SPECIAL'],
      scriptType: 'HIRAGANA',
      limit: 10,
    });
    expect(isOk(afterWrong)).toBe(true);
    if (isOk(afterWrong)) {
      expect(afterWrong.value).toHaveLength(10);
      expect(afterWrong.value[0]?.id).toBe('kana_te');
    }
  });
});

describe('Curriculum Kana Hono RPC Routes', () => {
  it('should get full kana and filtered kana via HTTP GET', async () => {
    const resAll = await app.request('/api/curriculum/kana');
    expect(resAll.status).toBe(200);
    const allKana = (await resAll.json()) as KanaItem[];
    expect(Array.isArray(allKana)).toBe(true);
    expect(allKana.length).toBeGreaterThanOrEqual(100);

    const resSeion = await app.request('/api/curriculum/kana?type=SEION');
    expect(resSeion.status).toBe(200);
    const seion = (await resSeion.json()) as KanaItem[];
    expect(seion.every((k) => k.type === 'SEION')).toBe(true);

    const resQueue = await app.request(
      '/api/curriculum/kana/queue/http_kana_user_01?types=SEION%2CSPECIAL&scriptType=HIRAGANA&limit=10'
    );
    expect(resQueue.status).toBe(200);
    const queue = (await resQueue.json()) as KanaItem[];
    expect(queue).toHaveLength(10);
    expect(queue.every((k) => k.type === 'SEION' || k.type === 'SPECIAL')).toBe(true);
  });

  it('should record practice result via HTTP POST', async () => {
    const res = await app.request('/api/curriculum/kana/practice/http_kana_user_01', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kanaId: 'kana_ka',
        isCorrect: true,
        scriptType: 'KATAKANA',
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success?: unknown; proficiency?: unknown };
    expect(data.success).toBe(true);
    expect(typeof data.proficiency).toBe('number');
  });
});
