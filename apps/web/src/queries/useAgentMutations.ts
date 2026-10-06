import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  gatewayClient,
  type SubjectiveGradePayload,
} from '../lib/gateway-client.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { QUERY_KEYS } from './useLearnerQueries.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { ObjectiveAnswerResultSchema, type ObjectiveAnswerInput } from '@study-studio/protocol';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

function assertConnected(): void {
  if (!useGatewayStore.getState().isConnected && !gatewayClient.isConnected) {
    const err = new Error('Gateway 未连接，请稍后重试。') as Error & {
      userMessage?: string;
      retryable?: boolean;
    };
    err.userMessage = '学习助手尚未连上，请确认 Gateway 已启动。';
    err.retryable = true;
    throw err;
  }
}

/** Only committed answers update learning queries and the persisted profile mirror. */
export function useSubmitQuizMutation() {
  const queryClient = useQueryClient();
  const userId = useUserProfileStore(s => s.profile.userId);

  return useMutation({
    mutationFn: async (payload: ObjectiveAnswerInput) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/practice/answers/${encodeURIComponent(userId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.userMessage ?? '保存作答失败，请重试。');
      return ObjectiveAnswerResultSchema.parse(body);
    },
    onSuccess: () => {
      void useUserProfileStore.getState().fetchProfile(userId);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LEARNING_ANALYSIS });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ACTIVITY_HISTORY });
    },
  });
}

/** 自适应出题（WS request/response） */
export function useGenerateAdaptiveQuizMutation() {
  return useMutation({
    mutationFn: async (options?: { weaknessSkillId?: string; count?: number }) => {
      assertConnected();
      return gatewayClient.generateAdaptiveQuiz(options);
    },
  });
}

/** 主观题批改 */
export function useGradeSubjectiveMutation() {
  return useMutation({
    mutationFn: async (payload: SubjectiveGradePayload) => {
      assertConnected();
      return gatewayClient.gradeSubjectiveQuiz(payload);
    },
  });
}

/** 连接态：模块只需指示灯时用这个，不必拉整套 agent API */
export function useGatewayConnection() {
  const isConnected = useGatewayStore((s) => s.isConnected);
  const isConnecting = useGatewayStore((s) => s.isConnecting);
  const latencyMs = useGatewayStore((s) => s.latencyMs);
  const sessionId = useGatewayStore((s) => s.sessionId);
  return { isConnected, isConnecting, latencyMs, sessionId };
}
