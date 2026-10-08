import { describe, it, expect, beforeEach } from 'bun:test';
import { isOk, isErr } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

describe('DrizzleLearnerRepository', () => {
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_streak_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('should auto-create a default learner profile if non-existent', async () => {
    const res = await repo.getLearnerProfile(testUserId);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    expect(res.value.userId).toBe(testUserId);
    expect(res.value.targetLanguage).toBe('en');
    expect(res.value.studyGoal).toBe('CET6');
    expect(res.value.learnerLevel).toBe('NOVICE');
    expect(res.value.streakDays).toBe(0);
    expect(res.value.dailyGoalQuizzes).toBe(5);
    expect(res.value.dailyGoalCards).toBe(10);
    expect(res.value.dailyGoalNewWords).toBe(10);
    expect(res.value.wordLevelFilter).toBeNull();
  });

  it('should update daily new-words quota and level filter cleanly', async () => {
    const updateRes = await repo.updateLearnerProfile(testUserId, {
      dailyGoalNewWords: 20,
      wordLevelFilter: ['N5', 'N4'],
    });
    expect(isOk(updateRes)).toBe(true);
    if (!isOk(updateRes)) return;
    expect(updateRes.value.dailyGoalNewWords).toBe(20);
    expect(updateRes.value.wordLevelFilter).toEqual(['N5', 'N4']);
    const cleared = await repo.updateLearnerProfile(testUserId, { wordLevelFilter: null });
    expect(isOk(cleared)).toBe(true);
    if (!isOk(cleared)) return;
    expect(cleared.value.wordLevelFilter).toBeNull();
    expect(cleared.value.dailyGoalNewWords).toBe(20);
  });

  it('should update learner profile fields cleanly', async () => {
    const updateRes = await repo.updateLearnerProfile(testUserId, {
      displayName: '樱木花道',
      studyGoal: 'JLPT_N1',
      learnerLevel: 'INTERMEDIATE',
      dailyGoalQuizzes: 8,
      dailyGoalCards: 15,
    });

    expect(isOk(updateRes)).toBe(true);
    if (!isOk(updateRes)) return;

    expect(updateRes.value.displayName).toBe('樱木花道');
    expect(updateRes.value.studyGoal).toBe('JLPT_N1');
    expect(updateRes.value.learnerLevel).toBe('INTERMEDIATE');
    expect(updateRes.value.dailyGoalQuizzes).toBe(8);
    expect(updateRes.value.dailyGoalCards).toBe(15);
  });

  it('should accurately compute daily task progress and streak upon goal completion', async () => {
    // 初始目标：quizzes 5, cards 10
    const initialProgress = await repo.getDailyTaskProgress(testUserId, '2026-09-04');
    expect(isOk(initialProgress)).toBe(true);
    if (!isOk(initialProgress)) return;
    expect(initialProgress.value.isGoalCompleted).toBe(false);
    expect(initialProgress.value.streakDays).toBe(0);

    // 1. 完成部分任务 (3 道题，5 张卡)
    const step1 = await repo.recordDailyActivity(testUserId, {
      quizzes: 3,
      cards: 5,
      date: '2026-09-04',
    });
    expect(isOk(step1)).toBe(true);
    if (!isOk(step1)) return;
    expect(step1.value.quizzesCount).toBe(3);
    expect(step1.value.cardsReviewedCount).toBe(5);
    expect(step1.value.isGoalCompleted).toBe(false);
    expect(step1.value.streakDays).toBe(0);

    // 2. 达成每日目标门槛 (再做 2 道题，5 张卡 -> 总计 5 题，10 卡)
    const step2 = await repo.recordDailyActivity(testUserId, {
      quizzes: 2,
      cards: 5,
      date: '2026-09-04',
    });
    expect(isOk(step2)).toBe(true);
    if (!isOk(step2)) return;
    expect(step2.value.quizzesCount).toBe(5);
    expect(step2.value.cardsReviewedCount).toBe(10);
    expect(step2.value.isGoalCompleted).toBe(true);
    expect(step2.value.streakDays).toBe(1);
    expect(step2.value.completedAt).not.toBeNull();

    // 3. 用户感觉良好，开启超额连刷 (Overtime Burst)
    const step3 = await repo.recordDailyActivity(testUserId, {
      quizzes: 6, // 达到 11 题 (超过 5 题的两倍)
      cards: 10, // 达到 20 张卡
      date: '2026-09-04',
    });
    expect(isOk(step3)).toBe(true);
    if (!isOk(step3)) return;
    expect(step3.value.isGoalCompleted).toBe(true);
    expect(step3.value.isOvertimeBurst).toBe(true);
    expect(step3.value.intensityLevel).toBe(4);
    // 当日连胜天数保持 1，不重复+1
    expect(step3.value.streakDays).toBe(1);
  });

  it('should increase streak consecutively across days', async () => {
    // Day 1: 2026-09-03 达成目标
    await repo.recordDailyActivity(testUserId, {
      quizzes: 5,
      cards: 10,
      date: '2026-09-03',
    });

    const day1Profile = await repo.getLearnerProfile(testUserId);
    if (isOk(day1Profile)) {
      expect(day1Profile.value.streakDays).toBe(1);
    }

    // Day 2: 2026-09-04 连续第二天达成目标
    const day2 = await repo.recordDailyActivity(testUserId, {
      quizzes: 5,
      cards: 10,
      date: '2026-09-04',
    });
    expect(isOk(day2)).toBe(true);
    if (!isOk(day2)) return;
    expect(day2.value.streakDays).toBe(2);

    const day2Profile = await repo.getLearnerProfile(testUserId);
    if (isOk(day2Profile)) {
      expect(day2Profile.value.streakDays).toBe(2);
      expect(day2Profile.value.maxStreakDays).toBe(2);
    }
  });

  it('should reset streak if gap days exist', async () => {
    // Day 1: 2026-09-01 达成目标 (streak = 1)
    await repo.recordDailyActivity(testUserId, {
      quizzes: 5,
      cards: 10,
      date: '2026-09-01',
    });

    // Day 2 (2026-09-02) 缺席
    // Day 3 (2026-09-04) 再次达成目标 -> 连胜重新从 1 开始计算
    const day3 = await repo.recordDailyActivity(testUserId, {
      quizzes: 5,
      cards: 10,
      date: '2026-09-04',
    });
    expect(isOk(day3)).toBe(true);
    if (!isOk(day3)) return;
    expect(day3.value.streakDays).toBe(1);
  });

  it('should return fused profile snapshot with skills and daily task progress', async () => {
    await repo.recordDailyActivity(testUserId, {
      quizzes: 5,
      cards: 10,
    });

    const snapshotRes = await repo.getProfileSnapshot(testUserId);
    expect(isOk(snapshotRes)).toBe(true);
    if (!isOk(snapshotRes)) return;

    expect(snapshotRes.value.profile).toBeDefined();
    expect(snapshotRes.value.dailyTask).toBeDefined();
    expect(snapshotRes.value.dailyTask?.isGoalCompleted).toBe(true);
  });

  it('should auto-seed initial learning data (cards, questions) into SQLite', async () => {
    // 冷启动种子为日语资产；切到 ja 轨道再读
    await repo.updateLearnerProfile('student_web_01', { targetLanguage: 'ja' });

    // 1. 验证卡片自动灌库与读取
    const cardsRes = await repo.getDueCards('student_web_01');
    expect(isOk(cardsRes)).toBe(true);
    if (!isOk(cardsRes)) return;
    expect(cardsRes.value.length).toBeGreaterThanOrEqual(2);
    expect(cardsRes.value[0]?.front).toBeDefined();

    // 2. 验证题库自动灌库与读取（种子挂在 student_web_01 + ja）
    const questionsRes = await repo.getQuestions('student_web_01');
    expect(isOk(questionsRes)).toBe(true);
    if (!isOk(questionsRes)) return;
    expect(questionsRes.value.length).toBeGreaterThanOrEqual(2);
    expect(questionsRes.value.some((q) => q.id === 'q_01')).toBe(true);

    // 3. 验证错题本初始为 0（新用户未做错前为纯净初始态）
    const mistakesRes = await repo.getMistakes('student_web_01');
    expect(isOk(mistakesRes)).toBe(true);
    if (!isOk(mistakesRes)) return;
    expect(mistakesRes.value.length).toBe(0);
  });

  it('should persist updated FSRS review state for flashcards in SQLite', async () => {
    await repo.updateLearnerProfile('student_web_01', { targetLanguage: 'ja' });
    const cardsRes = await repo.getDueCards('student_web_01');
    expect(isOk(cardsRes)).toBe(true);
    if (!isOk(cardsRes)) return;

    const targetCard = { ...cardsRes.value[0]! };
    targetCard.fsrs = {
      ...targetCard.fsrs,
      stability: 12.5,
      reps: 5,
      dueAt: '2026-09-20T00:00:00.000Z',
    };

    // 保存更新
    const saveRes = await repo.saveCard(targetCard);
    expect(isOk(saveRes)).toBe(true);

    // 再次从 SQLite 重新读取，验证最新状态被持久化
    const reloadedRes = await repo.getDueCards('student_web_01', 50);
    expect(isOk(reloadedRes)).toBe(true);
    if (!isOk(reloadedRes)) return;

    const reloadedCard = reloadedRes.value.find((c) => c.id === targetCard.id);
    expect(reloadedCard).toBeDefined();
    expect(reloadedCard?.fsrs.stability).toBe(12.5);
    expect(reloadedCard?.fsrs.reps).toBe(5);
    expect(reloadedCard?.fsrs.dueAt).toBe('2026-09-20T00:00:00.000Z');
  });

  it('should persist dynamically generated questions and resolve mistakes cleanly', async () => {
    await repo.updateLearnerProfile('student_web_01', { targetLanguage: 'ja' });
    // 1. 保存一道由 AI 生成的新题目
    const newQuestion = {
      id: 'q_ai_dynamized_01',
      userId: 'student_web_01',
      type: 'CHOICE',
      category: 'AI 弱项专攻',
      prompt: '请选择正确的助词：',
      content: '公園（　）散歩します。',
      options: [
        { key: 'A', text: 'を', note: '经过的场所' },
        { key: 'B', text: 'に', note: '静态存在场所' },
      ],
      correctAnswer: 'A',
      explanation: '「散歩する」搭配移动经过的场所使用助词「を」。',
      testedSkillId: 'jp.particle.traversal_o',
      difficulty: 3,
    };

    const saveQRes = await repo.saveQuestion(newQuestion);
    expect(isOk(saveQRes)).toBe(true);

    const qListRes = await repo.getQuestions('student_web_01');
    expect(isOk(qListRes)).toBe(true);
    if (!isOk(qListRes)) return;
    expect(qListRes.value.some((q) => q.id === 'q_ai_dynamized_01')).toBe(true);

    // 2. 保存错题并连续订正两次，验证攻克状态完全由 SQLite 流转
    const saveMistakeRes = await repo.saveMistake({
      id: 'mst_01',
      userId: 'student_web_01',
      questionId: 'q_01',
      question: {
        id: 'q_01',
        type: 'MULTIPLE_CHOICE',
        prompt: '选择正确的动作场所助词：',
        content: '図書館（　）本を読みます。',
        correctAnswer: 'で',
        explanation: '场所助词',
        testedSkillId: 'jp.particle.action_de',
        difficultyTier: 2,
      },
      lastUserSubmission: 'に',
      lastGrading: {
        isCorrect: false,
        score: 0,
        explanation: '助词错误',
        correctAnswer: 'で',
        questionId: 'q_01',
        userSubmission: 'に',
        mistakeRecorded: true,
      },
      isResolved: false,
      recordedAt: new Date().toISOString(),
      retryCount: 0,
      consecutiveCorrect: 0,
    });
    expect(isOk(saveMistakeRes)).toBe(true);
    const retryOneRes = await repo.retryMistake('student_web_01', 'mst_01', true);
    expect(isOk(retryOneRes)).toBe(true);
    if (isOk(retryOneRes)) {
      expect(retryOneRes.value.consecutiveCorrect).toBe(1);
      expect(retryOneRes.value.isResolved).toBe(false);
    }

    const retryTwoRes = await repo.retryMistake('student_web_01', 'mst_01', true);
    expect(isOk(retryTwoRes)).toBe(true);
    if (isOk(retryTwoRes)) {
      expect(retryTwoRes.value.consecutiveCorrect).toBe(2);
      expect(retryTwoRes.value.isResolved).toBe(true);
    }

    const mistakesRes = await repo.getMistakes('student_web_01');
    expect(isOk(mistakesRes)).toBe(true);
    if (!isOk(mistakesRes)) return;

    const resolvedMistake = mistakesRes.value.find((m) => m.id === 'mst_01');
    expect(resolvedMistake?.isResolved).toBe(true);
    expect(resolvedMistake?.consecutiveCorrect).toBe(2);
  });

  it('isolates study goals and questions by target language track', async () => {
    const userId = 'test_user_lang_tracks';
    await repo.getLearnerProfile(userId);

    // EN 轨道写题
    await repo.saveQuestion({
      id: 'q_en_only',
      userId,
      type: 'CHOICE',
      category: 'reading',
      prompt: 'Main idea?',
      content: 'English passage',
      correctAnswer: 'A',
      explanation: 'en',
      testedSkillId: 'en.reading.comprehension',
      difficulty: 2,
      language: 'en',
    });

    // 切到日语并改目标
    const jaUpdate = await repo.updateLearnerProfile(userId, {
      targetLanguage: 'ja',
      studyGoal: 'JLPT_N2',
      overallLevel: 'N3-',
    });
    expect(isOk(jaUpdate)).toBe(true);
    if (!isOk(jaUpdate)) return;
    expect(jaUpdate.value.targetLanguage).toBe('ja');
    expect(jaUpdate.value.studyGoal).toBe('JLPT_N2');

    await repo.saveQuestion({
      id: 'q_ja_only',
      userId,
      type: 'CHOICE',
      category: 'grammar',
      prompt: '助詞',
      content: '公園（　）歩く',
      correctAnswer: 'A',
      explanation: 'ja',
      testedSkillId: 'jp.particle.traversal_o',
      difficulty: 2,
      language: 'ja',
    });

    const jaQs = await repo.getQuestions(userId);
    expect(isOk(jaQs)).toBe(true);
    if (!isOk(jaQs)) return;
    expect(jaQs.value.some((q) => q.id === 'q_ja_only')).toBe(true);
    expect(jaQs.value.some((q) => q.id === 'q_en_only')).toBe(false);

    // 切回英语：目标应恢复为该语种档案（CET6），题库仅 EN
    const enBack = await repo.updateLearnerProfile(userId, { targetLanguage: 'en' });
    expect(isOk(enBack)).toBe(true);
    if (!isOk(enBack)) return;
    expect(enBack.value.targetLanguage).toBe('en');
    expect(enBack.value.studyGoal).toBe('CET6');

    const enQs = await repo.getQuestions(userId);
    expect(isOk(enQs)).toBe(true);
    if (!isOk(enQs)) return;
    expect(enQs.value.some((q) => q.id === 'q_en_only')).toBe(true);
    expect(enQs.value.some((q) => q.id === 'q_ja_only')).toBe(false);
  });

  it('creates a stable daily study plan and overlays live activity', async () => {
    const userId = 'plan_user_01';
    await repo.updateLearnerProfile(userId, { targetLanguage: 'en', learnerLevel: 'BEGINNER' });
    // M1：新用户先走完带路（收3词/做3题/读1篇），计划才回到标准步骤
    for (let i = 0; i < 3; i++) {
      await repo.recordTermExposure({
        userId,
        language: 'en',
        headword: `plan词${i}`,
        source: 'collect',
        markCollected: true,
        flashcardId: `plan_card_${i}`,
      });
      await repo.recordQuizAttempt({
        id: `plan_q_${i}`,
        userId,
        questionId: `plan_qq_${i}`,
        userAnswer: 'x',
        isCorrect: true,
        score: 1,
        timeSpentMs: 1000,
        testedSkillId: 'en.vocab',
        createdAt: new Date().toISOString(),
      });
    }
    await repo.recordDailyActivity(userId, { reading: 1, language: 'en' });

    const first = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.planDate).toBe('2026-09-05');
    // 路线单元置顶（en starter 单词单元，kind 仍是 NEW_WORDS；通用查词步让路）
    expect(first.value.steps[0]?.id).toBe('step_unit_en-u-starter');
    expect(first.value.steps[0]?.kind).toBe('NEW_WORDS');
    expect(first.value.steps.some((s) => s.id === 'step_new_words')).toBe(false);
    expect(first.value.steps.some((s) => s.kind === 'READING')).toBe(true);
    expect(first.value.steps.some((s) => s.kind === 'QUIZ')).toBe(true);

    const second = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.steps.map((s) => s.kind)).toEqual(first.value.steps.map((s) => s.kind));

    await repo.recordDailyActivity(userId, { cards: 1, date: '2026-09-05' });
    const afterCards = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(afterCards)).toBe(true);
    if (!isOk(afterCards)) return;
    // 不相关的复习总数不能推进指定词汇单元。
    const unitStep = afterCards.value.steps.find((s) => s.id === 'step_unit_en-u-starter');
    expect(unitStep?.progressText).toBe('0/10');
    expect(unitStep?.done).toBe(false);
    await repo.recordDailyActivity(userId, { cards: 2, date: '2026-09-05' });
    const afterMore = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(afterMore)).toBe(true);
    if (!isOk(afterMore)) return;
    expect(afterMore.value.steps.find((s) => s.id === 'step_unit_en-u-starter')?.done).toBe(false);
    const manualUnit = await repo.completeDailyPlanStep(userId, 'step_unit_en-u-starter', '2026-09-05');
    expect(isOk(manualUnit)).toBe(false);

    const marked = await repo.completeDailyPlanStep(userId, 'step_quiz', '2026-09-05');
    expect(isOk(marked)).toBe(true);
    if (!isOk(marked)) return;
    expect(marked.value.steps.find((s) => s.kind === 'QUIZ')?.done).toBe(true);
  });

  it('recomputes quiz and mistake steps from live activity after scoring/resolving', async () => {
    // P4-A 验收：做完题、攻克错题后，日计划重新查询得到正确变化，刷新一致。
    const userId = 'plan_user_02';
    await repo.updateLearnerProfile(userId, {
      learnerLevel: 'BEGINNER',
      targetLanguage: 'en',
      dailyGoalQuizzes: 1,
      dailyGoalCards: 1,
    });
    // M1：先走完带路，计划才回到标准步骤（含 MISTAKES）
    for (let i = 0; i < 3; i++) {
      await repo.recordTermExposure({
        userId,
        language: 'en',
        headword: `plan2词${i}`,
        source: 'collect',
        markCollected: true,
        flashcardId: `plan2_card_${i}`,
      });
      await repo.recordQuizAttempt({
        id: `plan2_q_${i}`,
        userId,
        questionId: `plan2_qq_${i}`,
        userAnswer: 'x',
        isCorrect: true,
        score: 1,
        timeSpentMs: 1000,
        testedSkillId: 'en.vocab',
        createdAt: new Date().toISOString(),
      });
    }
    await repo.recordDailyActivity(userId, { reading: 1, language: 'en' });
    // 入库一道未消错题，使计划出现 MISTAKES 步骤
    const saveMistakeRes = await repo.saveMistake({
      id: 'mst_plan_02',
      userId,
      questionId: 'q_plan_02',
      question: {
        id: 'q_plan_02',
        type: 'MULTIPLE_CHOICE',
        prompt: 'Choose the correct tense.',
        content: 'She ___ to school every day.',
        correctAnswer: 'goes',
        explanation: '一般现在时第三人称单数',
        testedSkillId: 'en.grammar.tense',
        difficultyTier: 2,
      },
      lastUserSubmission: 'go',
      lastGrading: {
        isCorrect: false,
        score: 0,
        explanation: '时态错误',
        correctAnswer: 'goes',
        questionId: 'q_plan_02',
        userSubmission: 'go',
        mistakeRecorded: true,
      },
      isResolved: false,
      recordedAt: new Date().toISOString(),
      retryCount: 0,
      consecutiveCorrect: 0,
    });
    expect(isOk(saveMistakeRes)).toBe(true);

    const before = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(before)).toBe(true);
    if (!isOk(before)) return;
    expect(before.value.steps.some((s) => s.kind === 'MISTAKES')).toBe(true);
    expect(before.value.steps.find((s) => s.kind === 'QUIZ')?.done).toBe(false);
    expect(before.value.steps.find((s) => s.kind === 'MISTAKES')?.done).toBe(false);

    // 闪卡评分路径内部会 recordDailyActivity({ quizzes: 1 })，这里直接模拟该信号
    const quizAct = await repo.recordDailyActivity(userId, { quizzes: 1, date: '2026-09-05' });
    expect(isOk(quizAct)).toBe(true);
    const afterQuiz = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(afterQuiz)).toBe(true);
    if (!isOk(afterQuiz)) return;
    expect(afterQuiz.value.steps.find((s) => s.kind === 'QUIZ')?.done).toBe(true);
    // 步骤顺序在活动后保持冻结不变
    expect(afterQuiz.value.steps.map((s) => s.kind)).toEqual(
      before.value.steps.map((s) => s.kind)
    );

    // 错题攻克路径内部会 recordDailyActivity({ mistakesResolved: 1 })
    const mistakeAct = await repo.recordDailyActivity(userId, {
      mistakesResolved: 1,
      date: '2026-09-05',
    });
    expect(isOk(mistakeAct)).toBe(true);
    const afterMistake = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
    expect(isOk(afterMistake)).toBe(true);
    if (!isOk(afterMistake)) return;
    expect(afterMistake.value.steps.find((s) => s.kind === 'MISTAKES')?.done).toBe(true);
    expect(afterMistake.value.completedCount).toBeGreaterThan(before.value.completedCount);
  });
});

describe('quiz_questions extras round-trip (P6-2)', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'p62_user_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  function dictationQuestion(id: string, extra: Record<string, unknown> | undefined) {
    return {
      id,
      userId,
      type: 'DICTATION',
      category: 'dictation',
      prompt: '听写挖空',
      content: '公園（　）歩く',
      correctAnswer: 'を',
      explanation: '助词',
      testedSkillId: 'en.test.dictation',
      difficulty: 2,
      language: 'en',
      ...(extra === undefined ? {} : { dictation: extra }),
    };
  }

  it('persists and reads back dictation extras', async () => {
    await repo.saveQuestion(
      dictationQuestion('q_dict_1', {
        fullJapanese: '公園を歩く',
        speaker: 'teacher',
        furiganaHint: 'を',
      })
    );
    const listRes = await repo.getQuestions(userId, 50, 'en', { types: ['DICTATION'] });
    expect(isOk(listRes)).toBe(true);
    if (!isOk(listRes)) return;
    const found = listRes.value.find((q) => q.id === 'q_dict_1');
    expect(found).toBeDefined();
    expect(found?.dictation).toEqual({
      fullJapanese: '公園を歩く',
      speaker: 'teacher',
      furiganaHint: 'を',
    });
  });

  it('omits extras for rows without them (backward compatible)', async () => {
    await repo.saveQuestion(dictationQuestion('q_plain_1', undefined));
    const listRes = await repo.getQuestions(userId, 50, 'en', { types: ['DICTATION'] });
    expect(isOk(listRes)).toBe(true);
    if (!isOk(listRes)) return;
    const found = listRes.value.find((q) => q.id === 'q_plain_1');
    expect(found).toBeDefined();
    expect('dictation' in (found as object)).toBe(false);
  });

  it('drops corrupt extras instead of inventing', async () => {
    await repo.saveQuestion(dictationQuestion('q_bad_1', { speaker: 'x' }));
    const listRes = await repo.getQuestions(userId, 50, 'en', { types: ['DICTATION'] });
    expect(isOk(listRes)).toBe(true);
    if (!isOk(listRes)) return;
    const found = listRes.value.find((q) => q.id === 'q_bad_1');
    expect(found).toBeDefined();
    expect('dictation' in (found as object)).toBe(false);
  });
});
