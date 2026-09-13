import { describe, expect, it } from 'bun:test';
import {
  scheduleFsrsReviewV1 as viaFacade,
  blueprintFor as blueprintViaFacade,
  buildLocalRunSummary as summaryViaFacade,
  gradeObjectiveAnswer as gradeViaFacade,
  acceptedDbTypesForBlock as dbTypesViaFacade,
  buildVocabQuestionsFromCards as vocabViaFacade,
  buildTranslationQuestionsFromCards as translationViaFacade,
  buildReadingQuestions as readingViaFacade,
  buildTextbookLessonQuestions as textbookViaFacade,
  mapPoolQuestion as poolViaFacade,
  mapQuestionType as poolTypeViaFacade,
  summarizeLearningEvidence as summarizeViaFacade,
  recordSkillAttempt as recordViaFacade,
  buildProfileSnapshot as snapshotViaFacade,
  type FsrsState as FsrsStateViaFacade,
} from '../index.js';
import { scheduleFsrsReviewV1 as viaCore } from '../scheduling/index.js';
import {
  blueprintFor as blueprintViaCore,
  buildLocalRunSummary as summaryViaCore,
  gradeObjectiveAnswer as gradeViaCore,
  acceptedDbTypesForBlock as dbTypesViaCore,
  buildVocabQuestionsFromCards as vocabViaCore,
  buildTranslationQuestionsFromCards as translationViaCore,
  buildReadingQuestions as readingViaCore,
  mapPoolQuestion as poolViaCore,
  mapQuestionType as poolTypeViaCore,
  buildTextbookLessonQuestions as textbookViaCore,
} from '../practice/index.js';
import {
  summarizeLearningEvidence as summarizeViaCore,
  recordSkillAttempt as recordViaCore,
  buildProfileSnapshot as snapshotViaCore,
} from '@study-studio/learner-core';
import type { FsrsState as FsrsStateViaCore } from '@study-studio/learning-algorithms';

/** C6 learning 表面锁：具名导出即本包子目录的实现本身，不漂移、不包装。 */
describe('learning 入口', () => {
  it('排程与蓝图入口与规范包同一实现', () => {
    expect(viaFacade).toBe(viaCore);
    expect(blueprintViaFacade).toBe(blueprintViaCore);
  });

  it('学习进度纯函数与 learner-core 同一实现', () => {
    expect(summarizeViaFacade).toBe(summarizeViaCore);
    expect(recordViaFacade).toBe(recordViaCore);
    expect(snapshotViaFacade).toBe(snapshotViaCore);
  });

  it('运行汇总入口与 ./practice 同一实现（M7-14 修复）', () => {
    expect(summaryViaFacade).toBe(summaryViaCore);
  });

  it('客观题判题入口与 ./practice 同一实现（M7-15）', () => {
    expect(gradeViaFacade).toBe(gradeViaCore);
  });

  it('题构造入口与 ./practice 同一实现（M7-16）', () => {
    expect(dbTypesViaFacade).toBe(dbTypesViaCore);
    expect(vocabViaFacade).toBe(vocabViaCore);
    expect(translationViaFacade).toBe(translationViaCore);
    expect(readingViaFacade).toBe(readingViaCore);
    expect(textbookViaFacade).toBe(textbookViaCore);
    expect(poolViaFacade).toBe(poolViaCore);
    expect(poolTypeViaFacade).toBe(poolTypeViaCore);
  });

  it('转出排程状态类型（编译期锁：缺失即 typecheck 失败）', () => {
    const state: FsrsStateViaFacade = {
      stability: 1,
      difficulty: 5,
      reps: 0,
      lapses: 0,
      dueAt: '2026-09-07T12:00:00.000Z',
      state: 'NEW',
    };
    const same: FsrsStateViaCore = state;
    expect(same.state).toBe('NEW');
  });
});
