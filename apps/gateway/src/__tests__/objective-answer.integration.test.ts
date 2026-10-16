import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { BusinessError, err, isErr, isOk } from '@lexdistill/shared';
import type { ObjectiveAnswerInput } from '@lexdistill/protocol';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../modules/learning-content/public.js';
import { assemblePracticeRun } from '../modules/practice/application/practice-assembly.js';
import { buildBalancedPracticeBlocks } from '@lexdistill/learning';

describe('objective answers and integrated practice records', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'answer_test';
  const input: ObjectiveAnswerInput = { submissionId: 'submission_1', questionId: 'answer_q', language: 'en', userAnswer: 'B', timeSpentMs: 1200 };
  afterEach(() => repo.getRawDb().close());
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    await repo.getLearnerProfile(userId);
    await repo.saveQuestion({ id: input.questionId, userId, language: 'en', type: 'MULTIPLE_CHOICE',
      prompt: 'Choose the correct verb.', content: 'She ___ to school yesterday.', options: ['go', 'went', 'goes'],
      correctAnswer: 'went', explanation: 'Yesterday requires the past tense.', testedSkillId: 'en.grammar.past', difficulty: 2 });
  });
  async function count() {
    const progress = await repo.getDailyTaskProgress(userId);
    expect(isOk(progress)).toBe(true);
    return isOk(progress) ? progress.value.quizzesCount : -1;
  }
  it('grades against stored option text, persists once, and creates a previously unseen skill metric', async () => {
    const result = await repo.submitObjectiveAnswer(userId, input);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toMatchObject({ isCorrect: true, score: 1, correctAnswer: 'went', persistedToDb: true });
    expect(await count()).toBe(1);
    const snapshot = await repo.getProfileSnapshot(userId, 'en');
    expect(isOk(snapshot)).toBe(true);
    if (isOk(snapshot)) expect(snapshot.value.allMetrics.find(metric => metric.id === 'en.grammar.past')).toMatchObject({ totalAttempts: 1, correctAttempts: 1 });
    const retry = await repo.submitObjectiveAnswer(userId, input);
    expect(retry).toEqual(result);
    expect(await count()).toBe(1);
  });
  it('serializes concurrent retries so quiz counts, metrics and mistakes are not duplicated', async () => {
    const wrong = { ...input, userAnswer: 'A' };
    const results = await Promise.all([repo.submitObjectiveAnswer(userId, wrong), repo.submitObjectiveAnswer(userId, wrong)]);
    expect(results.every(isOk)).toBe(true);
    expect(await count()).toBe(1);
    const mistakes = await repo.getMistakes(userId, { language: 'en' });
    expect(isOk(mistakes)).toBe(true);
    if (isOk(mistakes)) expect(mistakes.value).toHaveLength(1);
  });
  it('rejects reused submission identities with changed answers, foreign owners and other languages', async () => {
    await repo.submitObjectiveAnswer(userId, input);
    expect(isErr(await repo.submitObjectiveAnswer(userId, { ...input, userAnswer: 'A' }))).toBe(true);
    expect(isErr(await repo.submitObjectiveAnswer('other_user', input))).toBe(true);
    expect(isErr(await repo.submitObjectiveAnswer(userId, { ...input, language: 'ja' }))).toBe(true);
    expect(await count()).toBe(1);
  });
  it('rolls back attempts, activity and metrics when saving the mistake fails; the same identity can then retry', async () => {
    const failure = spyOn(repo, 'saveMistake').mockResolvedValue(err(new BusinessError('E_TEST', 'test write failure', 'DATABASE')));
    const result = await repo.submitObjectiveAnswer(userId, { ...input, userAnswer: 'A' });
    failure.mockRestore();
    expect(isErr(result)).toBe(true);
    expect(await count()).toBe(0);
    const snapshot = await repo.getProfileSnapshot(userId, 'en');
    if (isOk(snapshot)) expect(snapshot.value.allMetrics.find(metric => metric.id === 'en.grammar.past')).toBeUndefined();
    expect(isOk(await repo.submitObjectiveAnswer(userId, { ...input, userAnswer: 'A' }))).toBe(true);
    expect(await count()).toBe(1);
  });
  it('persists reading passages and acceptable dictation variants when reloading a question', async () => {
    await repo.saveQuestion({ id: 'reading_q', userId, language: 'en', type: 'FILL_IN_BLANK',
      prompt: 'Complete the sentence.', content: 'I ___ ready.', correctAnswer: 'am', acceptableVariants: ['feel'],
      reading: { setId: 'passage_1', title: 'A short passage', body: 'I am ready.' }, testedSkillId: 'en.reading.cloze' });
    const questions = await repo.getQuestions(userId, 100, 'en');
    expect(isOk(questions)).toBe(true);
    if (isOk(questions)) expect(questions.value.find(question => question.id === 'reading_q')).toMatchObject({
      reading: { title: 'A short passage', body: 'I am ready.' }, acceptableVariants: ['feel'],
    });
    const result = await repo.submitObjectiveAnswer(userId, { ...input, submissionId: 'variant', questionId: 'reading_q', userAnswer: ' FEEL ' });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.isCorrect).toBe(true);
  });
  it('reads and records the requested language without changing the active language or borrowing its goals', async () => {
    await repo.updateLearnerProfile(userId, { targetLanguage: 'en', dailyGoalQuizzes: 1, dailyGoalCards: 1 });
    await repo.updateLearnerProfile(userId, { targetLanguage: 'ja', dailyGoalQuizzes: 8, dailyGoalCards: 8 });
    await repo.recordDailyActivity(userId, { language: 'ja', quizzes: 2 });
    const recorded = await repo.recordDailyActivity(userId, { language: 'en', quizzes: 1, cards: 1 });
    if (!isOk(recorded)) throw recorded.error;
    expect(recorded.value).toMatchObject({ language: 'en', quizzesCount: 1, dailyGoalQuizzes: 1, isGoalCompleted: true });
    const english = await repo.getDailyTaskProgress(userId, undefined, 'en');
    const japanese = await repo.getDailyTaskProgress(userId, undefined, 'ja');
    if (!isOk(english) || !isOk(japanese)) throw new Error('Missing language progress');
    expect(english.value.quizzesCount).toBe(1);
    expect(japanese.value).toMatchObject({ language: 'ja', quizzesCount: 2, dailyGoalQuizzes: 8 });
    const plan = await repo.getOrCreateDailyStudyPlan(userId, undefined, 'en');
    if (!isOk(plan)) throw plan.error;
    expect(plan.value.language).toBe('en');
    const active = await repo.getLearnerProfile(userId);
    if (!isOk(active)) throw active.error;
    expect(active.value).toMatchObject({ targetLanguage: 'ja', dailyGoalQuizzes: 8, totalQuizzesAnswered: 2 });
  });
  it('assembles real cloze and dictation content for all three languages without duplicating finite templates', async () => {
    for (const language of ['en', 'ja', 'ko'] as const) {
      await repo.setTrackLevel(userId, language, 'ADVANCED');
      const lessons = await repo.listLessons(userId, language);
      if (isOk(lessons)) for (const lesson of lessons.value) await repo.completeLesson(userId, lesson.skillId);
      const blocks = buildBalancedPracticeBlocks(language).filter(block => block.kind === 'CLOZE' || block.kind === 'DICTATION');
      const run = await repo.startPracticePlanRun(userId, { language, blocks });
      expect(isOk(run)).toBe(true);
      if (!isOk(run)) continue;
      const assembled = await assemblePracticeRun(repo, userId, run.value.id, new LearningContentTool(repo));
      expect(isOk(assembled)).toBe(true);
      const items = await repo.getPracticeRunItems(userId, run.value.id);
      expect(isOk(items)).toBe(true);
      if (!isOk(items)) continue;
      const cloze = items.value.filter(item => item.blockId === 'balanced_cloze');
      const listening = items.value.filter(item => item.blockId === 'balanced_listening');
      expect(cloze).toHaveLength(3);
      expect(cloze.every(item => Boolean(item.question.reading?.body))).toBe(true);
      expect(listening.length).toBeGreaterThan(0);
      expect(listening.every(item => item.question.type === 'LISTENING_DICTATION' && Boolean(item.question.dictation?.fullJapanese))).toBe(true);
    }
  });
  it('refuses to finish ungraded work, and commits skills and mistakes once on completion', async () => {
    const run = await repo.startPracticePlanRun(userId, { language: 'en', blocks: [{ id: 'grammar', kind: 'QUIZ', count: 1, gradingMode: 'AUTO_IMMEDIATE' }] });
    if (!isOk(run)) throw run.error;
    const collection = await repo.collectPracticeQuestions({ userId, title: 'Practice', intent: 'GENERATE_QUIZ', planRunId: run.value.id,
      blockId: 'grammar', gradingMode: 'AUTO_IMMEDIATE', questions: [{ id: 'run_q', type: 'MULTIPLE_CHOICE', prompt: 'Past tense',
        content: 'She ___ yesterday.', options: ['go', 'went'], correctAnswer: 'went', explanation: 'Past tense.', testedSkillId: 'en.grammar.past', difficultyTier: 2 }] });
    if (!isOk(collection)) throw collection.error;
    const itemId = collection.value.items[0]!.id;
    expect(isErr(await repo.finalizePracticePlanRun(userId, run.value.id))).toBe(true);
    await repo.submitPracticeItem(userId, run.value.id, itemId, 'A', { isCorrect: false, score: 0, testedSkillId: 'en.grammar.past' });
    const completed = await Promise.all([repo.finalizePracticePlanRun(userId, run.value.id), repo.finalizePracticePlanRun(userId, run.value.id)]);
    expect(completed.every(isOk)).toBe(true);
    expect(await count()).toBe(1);
    const snapshot = await repo.getProfileSnapshot(userId, 'en');
    if (isOk(snapshot)) expect(snapshot.value.allMetrics.find(metric => metric.id === 'en.grammar.past')?.totalAttempts).toBe(1);
    const mistakes = await repo.getMistakes(userId, { language: 'en' });
    if (isOk(mistakes)) expect(mistakes.value[0]?.questionId).toBe('run_q');
  });
});
