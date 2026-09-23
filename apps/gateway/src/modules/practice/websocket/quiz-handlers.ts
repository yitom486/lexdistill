import {
  type WsEnvelope,
  WsEventTypes,
} from '@study-studio/protocol';
import {
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
  ok,
} from '@study-studio/shared';
import type { PracticeSubmissionRepository } from '../application/submit-practice-attempt.js';
import { submitPracticeAttempt } from '../application/submit-practice-attempt.js';
import type { PersistableQuestion } from '../persistence/questions.js';
import { normalizeTrackLanguage } from '../../../services/learning-language-policy.js';

interface PracticeToolLike {
  execute(
    input: unknown,
    context: { userId: string; sessionId: string }
  ): Promise<Result<unknown, BusinessError>>;
}

export interface PracticeQuizSubmitWebSocketDependencies {
  learnerRepo: PracticeSubmissionRepository;
}

export interface PracticeQuizToolWebSocketDependencies {
  toolRegistry: {
    get(name: string): PracticeToolLike | undefined;
  };
  /** Only supplied by the host when its repository supports persistent question storage. */
  saveGeneratedQuestions?: (
    questions: PersistableQuestion[]
  ) => Promise<Result<void, BusinessError>>;
}

/** Record a submitted practice answer and return the established WS completion envelope. */
export async function handleQuizSubmit(
  deps: PracticeQuizSubmitWebSocketDependencies,
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

  const submitRes = await submitPracticeAttempt(deps.learnerRepo, payload);
  if (!isOk(submitRes)) return err(submitRes.error);

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

export async function handleQuizGenerate(
  deps: PracticeQuizToolWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  // C5：优先 learning.content；旧 quiz.generateAdaptive 仅作兼容回退
  const contentTool = deps.toolRegistry.get('learning.content');
  const legacyTool = deps.toolRegistry.get('quiz.generateAdaptive');
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
  if (deps.saveGeneratedQuestions) {
    const generatedOutput = toolRes.value as { questions?: unknown[]; targetSkillName?: string };
    const partitionLang = normalizeTrackLanguage(
      typeof rawPayload.targetLanguage === 'string' ? rawPayload.targetLanguage : undefined
    );
    const questions = (generatedOutput.questions ?? []).map(
      (question): PersistableQuestion => {
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
    const saveRes = await deps.saveGeneratedQuestions(questions);
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
  deps: PracticeQuizToolWebSocketDependencies,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const tool = deps.toolRegistry.get('quiz.gradeSubjective');
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
