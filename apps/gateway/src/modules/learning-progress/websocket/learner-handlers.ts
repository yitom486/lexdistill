import {
  type WsEnvelope,
  WsEventTypes,
  UpdateLearnerProfileSchema,
} from '@lexdistill/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
} from '@lexdistill/shared';
import type { LearnerRepository } from '@lexdistill/learner-core';

export type LearningProgressWebSocketRepository = Pick<
  LearnerRepository,
  'getLearnerProfile' | 'updateLearnerProfile' | 'getDailyTaskProgress' | 'recordDailyActivity'
>;

export interface LearningProgressWebSocketDependencies {
  learnerRepo: LearningProgressWebSocketRepository;
}

export async function handleProfileGet(
  deps: LearningProgressWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as { userId?: string };
  const userId = payload.userId ?? 'student_web_01';
  const profileRes = await deps.learnerRepo.getLearnerProfile(userId);
  if (!isOk(profileRes)) return err(profileRes.error);

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: profileRes.value,
    timestamp: Date.now(),
  });
}

export async function handleProfileUpdate(
  deps: LearningProgressWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    userId?: string;
    updates?: Record<string, unknown>;
  };
  const userId = payload.userId ?? 'student_web_01';
  // WS 为非信任边界：更新体先过协议 schema，非法直接 400，不进仓储。
  const parsedUpdates = UpdateLearnerProfileSchema.safeParse(
    payload.updates ?? envelope.payload ?? {}
  );
  if (!parsedUpdates.success) {
    return err(
      new BusinessError('E_INVALID_INPUT', '学习档案更新内容格式不正确。', 'VALIDATION')
    );
  }
  // exactOptionalPropertyTypes 下显式 undefined 不可赋给可选属性，逐字段收敛。
  const updates = parsedUpdates.data;
  const updateRes = await deps.learnerRepo.updateLearnerProfile(userId, {
    ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
    ...(updates.targetLanguage !== undefined ? { targetLanguage: updates.targetLanguage } : {}),
    ...(updates.studyGoal !== undefined ? { studyGoal: updates.studyGoal } : {}),
    ...(updates.learnerLevel !== undefined ? { learnerLevel: updates.learnerLevel } : {}),
    ...(updates.dailyGoalQuizzes !== undefined
      ? { dailyGoalQuizzes: updates.dailyGoalQuizzes }
      : {}),
    ...(updates.dailyGoalCards !== undefined
      ? { dailyGoalCards: updates.dailyGoalCards }
      : {}),
  });
  if (!isOk(updateRes)) return err(updateRes.error);

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.LEARNER_PROFILE_UPDATED,
    payload: updateRes.value,
    timestamp: Date.now(),
  });
}

export async function handleTaskProgressGet(
  deps: LearningProgressWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as { userId?: string; date?: string };
  const userId = payload.userId ?? 'student_web_01';
  const progressRes = await deps.learnerRepo.getDailyTaskProgress(userId, payload.date);
  if (!isOk(progressRes)) return err(progressRes.error);

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: progressRes.value,
    timestamp: Date.now(),
  });
}

export async function handleTaskActivityRecord(
  deps: LearningProgressWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    userId?: string;
    quizzes?: number;
    cards?: number;
    listeningMinutes?: number;
    mistakesResolved?: number;
    date?: string;
  };
  const userId = payload.userId ?? 'student_web_01';
  const recordRes = await deps.learnerRepo.recordDailyActivity(userId, payload);
  if (!isOk(recordRes)) return err(recordRes.error);

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.LEARNER_DAILY_TASK_UPDATED,
    payload: recordRes.value,
    timestamp: Date.now(),
  });
}
