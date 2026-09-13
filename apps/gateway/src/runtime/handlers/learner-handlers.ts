import {
  type WsEnvelope,
  WsEventTypes,
  UpdateLearnerProfileSchema,
} from '@study-studio/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
  nowIso,
} from '@study-studio/shared';
import { recordSkillAttempt } from '@study-studio/learning';
import {
  createMistakeEntry,
} from '@study-studio/learner-core';
import type { GatewayServer } from '../gateway-runtime.js';
import { DrizzleLearnerRepository } from '../../infrastructure/drizzle-learner-repository.js';
import { normalizeTrackLanguage } from '../../services/learning-language-policy.js';

export async function handleQuizSubmit(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = envelope.payload as {
    userId: string;
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    score: number;
    timeSpentMs: number;
    testedSkillId: string;
    questionContent?: string;
    correctAnswer?: string;
    explanation?: string;
  };

  // 1. 持久化单次做题记录
  const attemptRes = await server.learnerRepo.recordQuizAttempt({
    id: generateId('att'),
    userId: payload.userId,
    questionId: payload.questionId,
    userAnswer: payload.userAnswer,
    isCorrect: payload.isCorrect,
    score: payload.score,
    timeSpentMs: payload.timeSpentMs,
    testedSkillId: payload.testedSkillId,
    createdAt: nowIso(),
  });
  if (!isOk(attemptRes)) return err(attemptRes.error);

  // 2. 将本次正误立即合并进 SQLite 学习画像，而不是仅依赖前端缓存。
  const snapshotRes = await server.learnerRepo.getProfileSnapshot(payload.userId);
  if (isOk(snapshotRes)) {
    const previous = snapshotRes.value.allMetrics.find(
      (metric) => metric.id === payload.testedSkillId
    );
    if (previous) {
      const metricRes = await server.learnerRepo.saveSkillMetric(
        payload.userId,
        recordSkillAttempt(previous, payload.isCorrect)
      );
      if (!isOk(metricRes)) return err(metricRes.error);
    }
  }

  // 3. 如果答错，自动将该题归入 SQLite 错题本
  if (!payload.isCorrect) {
    const mistake = createMistakeEntry(
      payload.userId,
      {
        id: payload.questionId,
        type: 'MULTIPLE_CHOICE',
        prompt: '自适应客观题',
        content: payload.questionContent ?? '',
        correctAnswer: payload.correctAnswer ?? '',
        explanation: payload.explanation ?? '',
        testedSkillId: payload.testedSkillId,
        difficultyTier: 3,
      },
      payload.userAnswer,
      {
        questionId: payload.questionId,
        isCorrect: false,
        score: 0,
        correctAnswer: payload.correctAnswer ?? '',
        userSubmission: payload.userAnswer,
        explanation: payload.explanation ?? '回答有误',
        mistakeRecorded: true,
      }
    );
    const mistakeRes = await server.learnerRepo.saveMistake(mistake);
    if (!isOk(mistakeRes)) return err(mistakeRes.error);
  }

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: {
      status: 'RECORDED',
      questionId: payload.questionId,
      isCorrect: payload.isCorrect,
      persistedToDb: true,
    },
    timestamp: Date.now(),
  });
}

export async function handleProfileGet(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as { userId?: string };
  const userId = payload.userId ?? 'student_web_01';
  const profileRes = await server.learnerRepo.getLearnerProfile(userId);
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
  server: GatewayServer,
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
  const updateRes = await server.learnerRepo.updateLearnerProfile(userId, {
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
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as { userId?: string; date?: string };
  const userId = payload.userId ?? 'student_web_01';
  const progressRes = await server.learnerRepo.getDailyTaskProgress(userId, payload.date);
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
  server: GatewayServer,
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
  const recordRes = await server.learnerRepo.recordDailyActivity(userId, payload);
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

export async function handleQuizGenerate(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  // C5：优先 learning.content；旧 quiz.generateAdaptive 仅作兼容回退
  const contentTool = server.toolRegistry.get('learning.content');
  const legacyTool = server.toolRegistry.get('quiz.generateAdaptive');
  const rawPayload = (envelope.payload ?? {}) as Record<string, unknown>;
  const userId =
    typeof rawPayload.userId === 'string' ? rawPayload.userId : 'student_web_01';
  const count = typeof rawPayload.count === 'number' ? rawPayload.count : 1;

  let toolRes: Result<unknown, BusinessError>;
  if (contentTool) {
    toolRes = await contentTool.execute(
      {
        action: 'generate_quiz',
        count,
        skillIds: rawPayload.weaknessSkillId
          ? [String(rawPayload.weaknessSkillId)]
          : undefined,
        language: normalizeTrackLanguage(
          typeof rawPayload.targetLanguage === 'string' ? rawPayload.targetLanguage : undefined
        ),
        collect: true,
      },
      { userId, sessionId: envelope.sessionId }
    );
    if (isOk(toolRes)) {
      const out = toolRes.value as {
        questions?: unknown[];
        message?: string;
      };
      toolRes = ok({
        targetSkillId: rawPayload.weaknessSkillId ?? 'adaptive',
        targetSkillName: 'learning.content 自适应组卷',
        adaptationReason: out.message ?? '经 learning.content 生成',
        questions: out.questions ?? [],
      });
    }
  } else if (legacyTool) {
    toolRes = await legacyTool.execute(
      {
        targetLanguage: rawPayload.targetLanguage ?? 'en',
        targetLevel: rawPayload.targetLevel ?? 'CEFR B1',
        weaknessSkillId: rawPayload.weaknessSkillId,
        count,
      },
      { userId, sessionId: envelope.sessionId }
    );
  } else {
    return err(new BusinessError('E_TOOL_NOT_FOUND', '出题工具未注册', 'AGENT_RUNTIME'));
  }
  if (!isOk(toolRes)) return err(toolRes.error);

  // 动态生成的题目属于学习资产；在发送给客户端前先写入 SQLite，刷新后仍可恢复。
  if (server.learnerRepo instanceof DrizzleLearnerRepository) {
    const generatedOutput = toolRes.value as { questions?: unknown[]; targetSkillName?: string };
    const partitionLang = normalizeTrackLanguage(
      typeof rawPayload.targetLanguage === 'string' ? rawPayload.targetLanguage : undefined
    );
    const questions = (generatedOutput.questions ?? []).map(
      (question) => {
        const generated = question as Record<string, unknown>;
        return {
        ...generated,
        userId,
        language: generated.language ?? partitionLang,
        // GeneratedQuestion 是工具协议，quiz_questions 则是可直接渲染的题库模型。
        category: generated.category ?? generatedOutput.targetSkillName ?? 'AI 靶向练习',
        difficulty: generated.difficulty ?? generated.difficultyTier ?? 3,
        };
      }
    );
    const saveRes = await server.learnerRepo.saveQuestions(questions);
    if (!isOk(saveRes)) return err(saveRes.error);
  }

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: toolRes.value,
    timestamp: Date.now(),
  });
}

export async function handleQuizGradeSubjective(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const tool = server.toolRegistry.get('quiz.gradeSubjective');
  if (!tool) {
    return err(new BusinessError('E_TOOL_NOT_FOUND', '主观题智能批改工具未注册', 'AGENT_RUNTIME'));
  }
  const gradePayload = (envelope.payload ?? {}) as { userId?: unknown };
  const toolRes = await tool.execute(envelope.payload, {
    userId: typeof gradePayload.userId === 'string' ? gradePayload.userId : 'student_web_01',
    sessionId: envelope.sessionId,
  });
  if (!isOk(toolRes)) return err(toolRes.error);

  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: toolRes.value,
    timestamp: Date.now(),
  });
}
