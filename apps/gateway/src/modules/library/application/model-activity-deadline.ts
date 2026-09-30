import { BusinessError } from '@study-studio/shared';

/** 每次公开事件重置活动期限；超时先撤销本轮提交资格，再中断底层 Turn。 */
export function awaitModelActivity<T>(pending: Promise<T>, controller: AbortController, timeoutMs: number, first: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new BusinessError('E_CANCELLED', '本次章节尝试已结束', 'AGENT_RUNTIME')); };
    const timer = setTimeout(() => {
      cleanup();
      controller.abort();
      reject(new BusinessError(first ? 'E_AGENT_FIRST_RESPONSE_TIMEOUT' : 'E_AGENT_STALL_TIMEOUT', first ? '模型未在配置时间内返回首个响应，可重试本部分' : '模型在配置时间内没有新活动，可重试本部分', 'AGENT_RUNTIME', true, { timeoutMs }));
    }, timeoutMs);
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (controller.signal.aborted) aborted();
    pending.then(value => { cleanup(); resolve(value); }, cause => { cleanup(); reject(cause); });
  });
}
