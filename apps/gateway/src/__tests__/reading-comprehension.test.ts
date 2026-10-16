import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { app } from '../index.js';
import { isOk } from '@lexdistill/shared';
import type { ReadingPassageSet } from '@lexdistill/protocol';

describe('Reading Comprehension Repository & Seeds (Companion Integration)', () => {
  let sqlite: Database;
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_reading';

  beforeEach(() => {
    sqlite = new Database(':memory:');
    repo = new DrizzleLearnerRepository(sqlite);
  });

  it('should auto-seed default reading sets into documents and retrieve them', async () => {
    const listRes = await repo.listReadingSets(testUserId);
    expect(isOk(listRes)).toBe(true);
    if (isOk(listRes)) {
      expect(listRes.value.length).toBeGreaterThanOrEqual(4);
      const titles = listRes.value.map((s) => s.title);
      expect(titles.some((t) => t.includes('カフェ'))).toBe(true);
      expect(titles.some((t) => t.includes('Cities Trial'))).toBe(true);
    }
  });

  it('should filter reading sets by origin and language correctly', async () => {
    // 仅过滤 AI 篇目
    const aiRes = await repo.listReadingSets(testUserId, 'ai');
    expect(isOk(aiRes)).toBe(true);
    if (isOk(aiRes)) {
      expect(aiRes.value.length).toBeGreaterThanOrEqual(2);
      expect(aiRes.value.every((s) => s.origin === 'ai')).toBe(true);
    }

    // 仅过滤真实新闻
    const newsRes = await repo.listReadingSets(testUserId, 'news');
    expect(isOk(newsRes)).toBe(true);
    if (isOk(newsRes)) {
      expect(newsRes.value.length).toBeGreaterThanOrEqual(2);
      expect(newsRes.value.every((s) => s.origin === 'news')).toBe(true);
    }

    // 仅过滤英文篇目
    const enRes = await repo.listReadingSets(testUserId, undefined, 'EN');
    expect(isOk(enRes)).toBe(true);
    if (isOk(enRes)) {
      expect(enRes.value.every((s) => s.language === 'EN')).toBe(true);
    }
  });

  it('should save a dynamically generated reading set and allow retrieval', async () => {
    const customSet = {
      id: 'read_custom_test_1',
      origin: 'ai' as const,
      title: 'テスト用の新しい読解記事',
      topic: '科学技術',
      difficulty: 3 as const,
      language: 'JA' as const,
      sourceLabel: 'AI 生成 · テスト篇',
      body: 'これはテスト用の本文です。読解の練習を行います。',
      questions: [
        {
          id: 'q_custom_1',
          prompt: '本文の主題は何ですか。',
          options: [
            { key: 'A', text: '読解の練習' },
            { key: 'B', text: '料理のレシピ' },
          ],
          correctAnswer: 'A',
          explanation: '本文に読解の練習を行うとある。',
        },
      ],
    };

    const saveRes = await repo.saveReadingSet(testUserId, customSet);
    expect(isOk(saveRes)).toBe(true);

    const listRes = await repo.listReadingSets(testUserId);
    expect(isOk(listRes)).toBe(true);
    if (isOk(listRes)) {
      const found = listRes.value.find((s) => s.id === 'read_custom_test_1');
      expect(found).toBeDefined();
      expect(found?.title).toBe('テスト用の新しい読解記事');
      expect(found?.questions.length).toBe(1);
    }
  });

  it('should record reading practice, updating skill metrics and daily activity log', async () => {
    await repo.updateLearnerProfile(testUserId, { targetLanguage: 'ja' });

    // 提交日文阅读成绩：3 题对 3 题
    const practiceRes = await repo.recordReadingPractice(testUserId, {
      setId: 'read_ai_cafe',
      score: 3,
      totalQuestions: 3,
      language: 'JA',
    });

    expect(isOk(practiceRes)).toBe(true);
    if (isOk(practiceRes)) {
      expect(practiceRes.value.proficiency).toBe(1.0);
    }

    // 检查 skill_metrics
    const snapshotRes = await repo.getProfileSnapshot(testUserId);
    expect(isOk(snapshotRes)).toBe(true);
    if (isOk(snapshotRes)) {
      const readingMetric = snapshotRes.value.allMetrics.find(
        (m) => m.id === 'jp.reading.comprehension'
      );
      expect(readingMetric).toBeDefined();
      expect(readingMetric?.totalAttempts).toBe(3);
      expect(readingMetric?.correctAttempts).toBe(3);
      expect(readingMetric?.dimension).toBe('READING');
    }

    // 检查打卡日志
    const progressRes = await repo.getDailyTaskProgress(testUserId);
    expect(isOk(progressRes)).toBe(true);
    if (isOk(progressRes)) {
      expect(progressRes.value.quizzesCount).toBeGreaterThanOrEqual(3);
      expect(progressRes.value.readingCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Reading Comprehension Hono RPC Routes', () => {
  const testUserId = 'test_user_hono_reading';

  it('should list reading sets via GET /api/reading/sets/:userId', async () => {
    const res = await app.request(`/api/reading/sets/${testUserId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as ReadingPassageSet[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('should dynamically generate a new reading set via POST /api/reading/generate/:userId', async () => {
    const payload = {
      origin: 'ai',
      difficulty: 2,
      language: 'JA',
      topic: '旅行と温泉',
    };

    const res = await app.request(`/api/reading/generate/${testUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const created = (await res.json()) as ReadingPassageSet;
    expect(created.id).toBeDefined();
    expect(created.title).toContain('旅行と温泉');
    expect(created.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate a Korean TOPIK passage set via POST /api/reading/generate/:userId', async () => {
    const payload = {
      origin: 'ai',
      difficulty: 2,
      language: 'KO',
      topic: '여행과 온천',
    };

    const res = await app.request(`/api/reading/generate/${testUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const created = (await res.json()) as ReadingPassageSet;
    expect(created.language).toBe('KO');
    expect(/[\uAC00-\uD7A3]/.test(created.body)).toBe(true);
    expect(created.body).not.toContain('interim EN scaffold');
    expect(created.questions.length).toBeGreaterThanOrEqual(2);
    expect(/[\uAC00-\uD7A3]/.test(created.questions[0]?.prompt ?? '')).toBe(true);
  });

  it('should record practice score via POST /api/reading/practice/:userId', async () => {
    const payload = {
      setId: 'read_news_quiet_delivery',
      score: 2,
      totalQuestions: 3,
      language: 'EN',
    };

    const res = await app.request(`/api/reading/practice/${testUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const result = (await res.json()) as { success?: unknown; proficiency?: unknown };
    expect(result.success).toBe(true);
    expect(typeof result.proficiency).toBe('number');
  });
});
