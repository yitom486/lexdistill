import { and, desc, eq, max } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ChapterManifestSchema, TextbookLearningContentSchema } from '@lexdistill/document-model';
import { ExerciseSnapshotSchema, ExerciseGradeSchema, TextbookExerciseAttemptSchema, type ExerciseSnapshot, type ExerciseGrade, type SubmitTextbookExercise, type TextbookExerciseAttempt } from '@lexdistill/protocol';
import { BusinessError, generateId, nowIso } from '@lexdistill/shared';
import type { DrizzleDb } from '../../connection.js';
import { documents, textbookExerciseItems, textbookKnowledge, practicePlanRuns, practiceItemAttempts, quizAttempts, aiArtifactRuns } from '../../schema.js';

type Row = typeof practiceItemAttempts.$inferSelect;
type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
const missing = () => new BusinessError('E_ATTEMPT_NOT_FOUND', '未找到当前用户的作答记录', 'VALIDATION');
function owned(tx: Tx, userId: string, id: string): Row {
  const row = tx.select({ attempt: practiceItemAttempts }).from(practiceItemAttempts).innerJoin(practicePlanRuns, eq(practicePlanRuns.id, practiceItemAttempts.runId))
    .where(and(eq(practiceItemAttempts.id, id), eq(practicePlanRuns.userId, userId))).get();
  if (!row?.attempt.questionSnapshotJson) throw missing();
  return row.attempt;
}
function map(tx: Tx, row: Row): TextbookExerciseAttempt {
  const snapshot = ExerciseSnapshotSchema.parse(JSON.parse(row.questionSnapshotJson!));
  const audit = row.gradingRunId ? tx.select().from(aiArtifactRuns).where(eq(aiArtifactRuns.id, row.gradingRunId)).get() : undefined;
  return TextbookExerciseAttemptSchema.parse({ id: row.id, itemId: row.itemId, attemptNo: row.attemptNo, previousAttemptId: row.previousAttemptId,
    submissionKind: row.submissionKind, status: row.status, answer: JSON.parse(row.userAnswer!), snapshot,
    grading: row.gradingResultJson ? JSON.parse(row.gradingResultJson) : null, gradingErrorCode: row.gradingErrorCode,
    model: audit?.model ?? null, adapter: audit?.adapter ?? null, rubricVersion: snapshot.rubricVersion,
    submittedAt: row.submittedAt, gradedAt: row.gradedAt, timeSpentMs: row.timeSpentMs, temporary: false });
}
export function loadTextbookExercise(db: DrizzleDb, userId: string, documentId: string, chapterId: string, exerciseId: string): ExerciseSnapshot {
  return db.transaction(tx => loadInTx(tx, userId, documentId, chapterId, exerciseId));
}
function loadInTx(tx: Tx, userId: string, documentId: string, chapterId: string, exerciseId: string): ExerciseSnapshot {
    const doc = tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId))).get();
    if (!doc?.chaptersJson) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的教材', 'VALIDATION');
    const chapter = ChapterManifestSchema.parse(JSON.parse(doc.chaptersJson)).find(value => value.id === chapterId);
    const row = tx.select().from(textbookExerciseItems).where(and(eq(textbookExerciseItems.id, exerciseId), eq(textbookExerciseItems.documentId, documentId), eq(textbookExerciseItems.chapterId, chapterId))).get();
    if (!row || !chapter) throw new BusinessError('E_EXERCISE_NOT_FOUND', '本章没有这道练习题', 'VALIDATION');
    const exercise = TextbookLearningContentSchema.shape.exercises.element.parse({ id: row.id, type: row.type, prompt: row.prompt, source: row.source,
      difficultyTier: row.difficultyTier, difficultyReason: row.difficultyReason,
      ...(row.answerJson ? { answer: JSON.parse(row.answerJson) } : {}), ...(row.optionsJson ? { options: JSON.parse(row.optionsJson) } : {}),
      ...(row.leftJson ? { left: JSON.parse(row.leftJson) } : {}), ...(row.rightJson ? { right: JSON.parse(row.rightJson) } : {}),
      ...(row.gradingNotes ? { gradingNotes: row.gradingNotes } : {}), ...(row.explanation ? { explanation: row.explanation } : {}) });
    const knowledge = tx.select({ title: textbookKnowledge.title, explanation: textbookKnowledge.explanation }).from(textbookKnowledge).where(and(eq(textbookKnowledge.documentId, documentId), eq(textbookKnowledge.chapterId, chapterId))).all();
    return ExerciseSnapshotSchema.parse({ documentId, chapterId, chapterTitle: chapter.title, language: doc.language, exercise, knowledge, rubricVersion: 'textbook-grade-v1' });
}
export function prepareTextbookAttempt(db: DrizzleDb, userId: string, input: SubmitTextbookExercise): TextbookExerciseAttempt {
  return db.transaction(tx => {
    if (input.retryAttemptId) {
      const row = owned(tx, userId, input.retryAttemptId);
      if (JSON.stringify(JSON.parse(row.userAnswer!)) !== JSON.stringify(input.answer)) throw new BusinessError('E_ATTEMPT_FROZEN', '重试批改不能修改已提交答案，请作为修改后作答提交', 'VALIDATION');
      return map(tx, row);
    }
    // System-generated idempotency identity; never supplied by a model.
    const id = `patt_${createHash('sha256').update(JSON.stringify([userId, input.requestId])).digest('hex')}`;
    const exists = tx.select().from(practiceItemAttempts).where(eq(practiceItemAttempts.id, id)).get();
    if (exists) {
      const old = owned(tx, userId, id), snapshot = ExerciseSnapshotSchema.parse(JSON.parse(old.questionSnapshotJson!));
      if (JSON.stringify(JSON.parse(old.userAnswer!)) !== JSON.stringify(input.answer) || snapshot.documentId !== input.documentId || snapshot.chapterId !== input.chapterId || snapshot.exercise.id !== input.exerciseId) throw new BusinessError('E_REQUEST_ID_REUSED', '该提交标识已经用于其他答案，请重新提交', 'VALIDATION');
      return map(tx, old);
    }
    if (!input.documentId || !input.chapterId || !input.exerciseId) throw new BusinessError('E_INVALID_INPUT', '请指定教材、章节和题目', 'VALIDATION');
    const snapshot = loadInTx(tx, userId, input.documentId, input.chapterId, input.exerciseId);
    const previous = input.previousAttemptId ? owned(tx, userId, input.previousAttemptId) : undefined;
    if (previous) {
      const before = ExerciseSnapshotSchema.parse(JSON.parse(previous.questionSnapshotJson!));
      if (before.documentId !== input.documentId || before.chapterId !== input.chapterId || before.exercise.id !== input.exerciseId) throw new BusinessError('E_ATTEMPT_SCOPE_INVALID', '修改作答必须属于同一题目', 'VALIDATION');
      if (previous.status !== 'GRADED' && previous.status !== 'GRADING_FAILED') throw new BusinessError('E_ATTEMPT_BUSY', '请等待本次批改结束再修改作答', 'VALIDATION', true);
    }
    const now = nowIso(), runId = previous?.runId ?? generateId('prun');
    const latestNo = tx.select({ n: max(practiceItemAttempts.attemptNo) }).from(practiceItemAttempts).where(and(eq(practiceItemAttempts.runId, runId), eq(practiceItemAttempts.itemId, input.exerciseId))).get()?.n ?? 0;
    if (!previous) tx.insert(practicePlanRuns).values({ id: runId, userId, language: snapshot.language, blocksJson: '[]', status: 'IN_PROGRESS', startedAt: now, createdAt: now }).run();
    tx.insert(practiceItemAttempts).values({ id, runId, blockId: input.chapterId, itemId: input.exerciseId, status: 'SUBMITTED', userAnswer: JSON.stringify(input.answer),
      questionSnapshotJson: JSON.stringify(snapshot), attemptNo: latestNo + 1, previousAttemptId: previous?.id ?? null,
      submissionKind: previous ? 'REVISION' : 'INDEPENDENT', timeSpentMs: input.timeSpentMs ?? null, submittedAt: now }).run();
    return map(tx, owned(tx, userId, id));
  });
}
export function getTextbookAttempt(db: DrizzleDb, userId: string, id: string) { return db.transaction(tx => map(tx, owned(tx, userId, id))); }
export function claimTextbookGrade(db: DrizzleDb, userId: string, id: string, gradingRunId: string) {
  return db.transaction(tx => {
    const row = owned(tx, userId, id);
    if (row.status === 'GRADED') return false;
    tx.update(practiceItemAttempts).set({ status: 'GRADING', gradingRunId, gradingErrorCode: null }).where(eq(practiceItemAttempts.id, id)).run();
    return true;
  });
}
export interface GradeAudit { id: string; adapter: string; model: string; inputSnapshot: string }
export function settleTextbookGrade(db: DrizzleDb, userId: string, id: string, audit: GradeAudit | undefined, grading: ExerciseGrade | undefined, errorCode?: string) {
  return db.transaction(tx => {
    const row = owned(tx, userId, id);
    if (audit && row.gradingRunId !== audit.id) throw new BusinessError('E_GRADING_STALE', '旧批改结果已被拒绝，本次作答正在重新批改', 'VALIDATION');
    if (row.status === 'GRADED') return map(tx, row);
    const snapshot = ExerciseSnapshotSchema.parse(JSON.parse(row.questionSnapshotJson!));
    const now = nowIso();
    if (audit) tx.insert(aiArtifactRuns).values({ id: audit.id, userId, action: 'textbook.grade', adapter: audit.adapter, model: audit.model,
      inputSnapshotHash: createHash('sha256').update(audit.inputSnapshot).digest('hex'), promptVersion: snapshot.rubricVersion, schemaVersion: 'exercise-grade-v1',
      status: grading ? 'completed' : 'failed', errorCode: errorCode ?? null, createdAt: now, completedAt: now }).onConflictDoNothing().run();
    if (grading) {
      const valid = ExerciseGradeSchema.parse(grading);
      tx.update(practiceItemAttempts).set({ status: 'GRADED', gradingResultJson: JSON.stringify(valid), gradedAt: now, gradingErrorCode: null }).where(eq(practiceItemAttempts.id, id)).run();
      tx.insert(quizAttempts).values({ id: generateId('qatt'), userId, language: snapshot.language, questionId: row.itemId, userAnswer: row.userAnswer!,
        isCorrect: valid.score === valid.maxScore, score: valid.score, maxScore: valid.maxScore, timeSpentMs: row.timeSpentMs ?? 0,
        testedSkillId: '', sourceAttemptId: id, documentId: snapshot.documentId, chapterId: snapshot.chapterId, difficultyTier: snapshot.exercise.difficultyTier,
        submissionKind: row.submissionKind, createdAt: now }).onConflictDoNothing({ target: quizAttempts.sourceAttemptId }).run();
      tx.update(practicePlanRuns).set({ status: 'COMPLETED', completedAt: now }).where(eq(practicePlanRuns.id, row.runId)).run();
    } else tx.update(practiceItemAttempts).set({ status: 'GRADING_FAILED', gradingErrorCode: errorCode ?? 'E_GRADING_FAILED', gradingResultJson: null, gradedAt: null }).where(eq(practiceItemAttempts.id, id)).run();
    return map(tx, owned(tx, userId, id));
  });
}
export function textbookExerciseHistory(db: DrizzleDb, userId: string, documentId: string, chapterId: string) {
  return db.transaction(tx => {
    const doc = tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId))).get();
    if (!doc) throw missing();
    const rows = tx.select({ attempt: practiceItemAttempts }).from(practiceItemAttempts).innerJoin(practicePlanRuns, eq(practicePlanRuns.id, practiceItemAttempts.runId))
      .where(and(eq(practicePlanRuns.userId, userId), eq(practiceItemAttempts.blockId, chapterId))).orderBy(desc(practiceItemAttempts.submittedAt)).all();
    return rows.filter(({ attempt }) => {
      const parsed = ExerciseSnapshotSchema.safeParse(attempt.questionSnapshotJson ? JSON.parse(attempt.questionSnapshotJson) : null);
      return parsed.success && parsed.data.documentId === documentId;
    }).map(({ attempt }) => map(tx, attempt));
  });
}
