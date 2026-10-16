import { describe, it, expect, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { app } from '../index.js';
import { isOk } from '@lexdistill/shared';
import type { HangulItem } from '@lexdistill/protocol';

describe('Curriculum Hangul Repository & Seeds (Companion Integration)', () => {
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_hangul_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('should auto-seed and retrieve full hangul curriculum dataset', async () => {
    const res = await repo.getCurriculumHangul();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.length).toBe(42);
      const g = res.value.find((h) => h.id === 'hangul_g');
      expect(g).toBeDefined();
      expect(g?.jamo).toBe('ㄱ');
      expect(g?.name).toBe('기역');
      expect(g?.romanization).toBe('g');
      expect(g?.type).toBe('CONSONANT');
      const a = res.value.find((h) => h.id === 'hangul_a');
      expect(a).toBeDefined();
      expect(a?.jamo).toBe('ㅏ');
      expect(a?.romanization).toBe('a');
      expect(a?.type).toBe('VOWEL');
    }
  });

  it('should filter hangul by type correctly', async () => {
    const consonantRes = await repo.getCurriculumHangul('CONSONANT');
    expect(isOk(consonantRes)).toBe(true);
    if (isOk(consonantRes)) {
      expect(consonantRes.value.length).toBe(14);
      expect(consonantRes.value.every((h) => h.type === 'CONSONANT')).toBe(true);
    }

    const vowelRes = await repo.getCurriculumHangul('VOWEL');
    expect(isOk(vowelRes)).toBe(true);
    if (isOk(vowelRes)) {
      expect(vowelRes.value.length).toBe(10);
      expect(vowelRes.value.every((h) => h.type === 'VOWEL')).toBe(true);
    }
  });

  it('should filter phase-2 y-vowels, compounds and codas correctly', async () => {
    const yRes = await repo.getCurriculumHangul('YVOWEL');
    expect(isOk(yRes)).toBe(true);
    if (isOk(yRes)) {
      expect(yRes.value.length).toBe(4);
      expect(yRes.value.every((h) => h.type === 'YVOWEL')).toBe(true);
      expect(yRes.value.map((h) => h.jamo).sort().join('')).toBe('ㅑㅕㅛㅠ');
    }

    const compoundRes = await repo.getCurriculumHangul('COMPOUND');
    expect(isOk(compoundRes)).toBe(true);
    if (isOk(compoundRes)) {
      expect(compoundRes.value.length).toBe(7);
      expect(compoundRes.value.every((h) => h.type === 'COMPOUND')).toBe(true);
      const wa = compoundRes.value.find((h) => h.id === 'hangul_wa');
      expect(wa?.romanization).toBe('wa');
    }

    const codaRes = await repo.getCurriculumHangul('CODA');
    expect(isOk(codaRes)).toBe(true);
    if (isOk(codaRes)) {
      expect(codaRes.value.length).toBe(7);
      expect(codaRes.value.every((h) => h.type === 'CODA')).toBe(true);
      const codaG = codaRes.value.find((h) => h.id === 'hangul_coda_g');
      expect(codaG?.romanization).toBe('k');
    }
  });

  it('should record hangul practice and update learner skill metrics & daily task activity', async () => {
    // 谚文练习属于韩语轨道；默认轨道为英语时必须显式切换，避免跨语种读取断言。
    const switchTrack = await repo.updateLearnerProfile(testUserId, { targetLanguage: 'ko' });
    expect(isOk(switchTrack)).toBe(true);

    // 第一次练习答对（子音）
    const practice1 = await repo.recordHangulPractice(testUserId, 'hangul_g', true, 'CONSONANT');
    expect(isOk(practice1)).toBe(true);
    if (isOk(practice1)) {
      expect(practice1.value.proficiency).toBe(1.0);
    }

    // 第二次练习答错（子音）
    const practice2 = await repo.recordHangulPractice(testUserId, 'hangul_n', false, 'CONSONANT');
    expect(isOk(practice2)).toBe(true);
    if (isOk(practice2)) {
      expect(practice2.value.proficiency).toBe(0.5);
    }

    // 第三次练习答对（母音，走独立技能）
    const practice3 = await repo.recordHangulPractice(testUserId, 'hangul_a', true, 'VOWEL');
    expect(isOk(practice3)).toBe(true);
    if (isOk(practice3)) {
      expect(practice3.value.proficiency).toBe(1.0);
    }

    // 检查画像指标中已产生 ko.hangul.consonant / ko.hangul.vowel
    const snapshot = await repo.getProfileSnapshot(testUserId);
    expect(isOk(snapshot)).toBe(true);
    if (isOk(snapshot)) {
      const consonantMetric = snapshot.value.allMetrics.find((m) => m.id === 'ko.hangul.consonant');
      expect(consonantMetric).toBeDefined();
      expect(consonantMetric?.totalAttempts).toBe(2);
      expect(consonantMetric?.correctAttempts).toBe(1);
      const vowelMetric = snapshot.value.allMetrics.find((m) => m.id === 'ko.hangul.vowel');
      expect(vowelMetric).toBeDefined();
      expect(vowelMetric?.totalAttempts).toBe(1);
    }

    // 检查当日打卡活动记录
    const progress = await repo.getDailyTaskProgress(testUserId);
    expect(isOk(progress)).toBe(true);
    if (isOk(progress)) {
      expect(progress.value.quizzesCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('should record phase-2 practice into the ko.hangul.compound skill', async () => {
    const switchTrack = await repo.updateLearnerProfile(testUserId, { targetLanguage: 'ko' });
    expect(isOk(switchTrack)).toBe(true);

    const p1 = await repo.recordHangulPractice(testUserId, 'hangul_ya', true, 'YVOWEL');
    expect(isOk(p1)).toBe(true);
    const p2 = await repo.recordHangulPractice(testUserId, 'hangul_wa', true, 'COMPOUND');
    expect(isOk(p2)).toBe(true);
    const p3 = await repo.recordHangulPractice(testUserId, 'hangul_coda_g', false, 'CODA');
    expect(isOk(p3)).toBe(true);

    const snapshot = await repo.getProfileSnapshot(testUserId);
    expect(isOk(snapshot)).toBe(true);
    if (isOk(snapshot)) {
      const compoundMetric = snapshot.value.allMetrics.find((m) => m.id === 'ko.hangul.compound');
      expect(compoundMetric).toBeDefined();
      expect(compoundMetric?.totalAttempts).toBe(3);
      expect(compoundMetric?.correctAttempts).toBe(2);
    }
  });
});

describe('Curriculum Hangul Hono RPC Routes', () => {
  it('should get full hangul and filtered hangul via HTTP GET', async () => {
    const resAll = await app.request('/api/curriculum/hangul');
    expect(resAll.status).toBe(200);
    const allHangul = (await resAll.json()) as HangulItem[];
    expect(Array.isArray(allHangul)).toBe(true);
    expect(allHangul.length).toBe(42);

    const resConsonant = await app.request('/api/curriculum/hangul?type=CONSONANT');
    expect(resConsonant.status).toBe(200);
    const consonants = (await resConsonant.json()) as HangulItem[];
    expect(consonants.every((h) => h.type === 'CONSONANT')).toBe(true);
  });

  it('should record practice result via HTTP POST', async () => {
    const res = await app.request('/api/curriculum/hangul/practice/http_hangul_user_01', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hangulId: 'hangul_m',
        isCorrect: true,
        scriptType: 'CONSONANT',
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success?: unknown; proficiency?: unknown };
    expect(data.success).toBe(true);
    expect(typeof data.proficiency).toBe('number');
  });
});
