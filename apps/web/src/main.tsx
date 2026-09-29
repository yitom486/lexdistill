import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  QueryCache,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { App } from './App.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { configureGatewayForRuntime } from './platform/gateway-runtime.js';
import { ensureTtsEngines } from './tts/tts-engines.js';
import './index.css';

// 注册包驱动的统一 TTS 播放入口。
ensureTtsEngines();

/** 后端 BusinessError 透出的 retryable 标记（error 为未知形状时一律视为可重试）。 */
function isRetryableFalse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable?: unknown }).retryable === false
  );
}

/** 优先取 BusinessError.userMessage，其次 Error.message，最后安抚性兜底。 */
function toUserMessage(error: unknown, fallback: string): string {
  return getUserMessage(error) ?? (error instanceof Error ? error.message : fallback);
}

/** 仅当 error 携带字符串 userMessage 时返回，否则 undefined（Query 全局拦截用）。 */
function getUserMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'userMessage' in error) {
    const userMessage = (error as { userMessage?: unknown }).userMessage;
    if (typeof userMessage === 'string' && userMessage) return userMessage;
  }
  return undefined;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 分钟内视为新鲜数据
      gcTime: 1000 * 60 * 30, // 30 分钟缓存回收期
      refetchOnWindowFocus: false,
      retry: (failureCount, error: unknown) => {
        // 如果后端明确告知 retryable 为 false，则不再进行重试
        if (isRetryableFalse(error)) return false;
        return failureCount < 2;
      },
    },
  },
  // 全局 Query 错误统一拦截
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      const userMessage = getUserMessage(error);
      if (userMessage) {
        toast.error(userMessage);
      }
    },
  }),
  // 全局 Mutation 变更失败统一拦截与友好安抚
  mutationCache: new MutationCache({
    onError: (error: unknown) => {
      toast.error(toUserMessage(error, '学习数据保存失败，请检查网络后重试。'));
    },
  }),
});

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = rootElement;

  async function bootstrap(): Promise<void> {
    try {
      await configureGatewayForRuntime();
    } finally {
      ReactDOM.createRoot(root).render(
        <React.StrictMode>
          <ErrorBoundary
            variant="fullscreen"
            title="应用遇到了意外崩溃"
            message="Lingua Studio 核心运行环境遇到了不可预期的错误。您的本地设置与学习资产已得到保护。"
          >
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </ErrorBoundary>
        </React.StrictMode>
      );
    }
  }

  void bootstrap();
}
