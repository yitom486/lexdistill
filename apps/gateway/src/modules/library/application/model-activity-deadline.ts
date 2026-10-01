import { BusinessError } from '@study-studio/shared';

/** 只由有效模型活动更新期限；超时先撤销本轮提交资格，再中断底层 Turn。 */
export function awaitModelActivity<T>(pending: () => Promise<T>, controller: AbortController, timeoutMs: number, first: boolean, diagnostics?: () => Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(controller.signal.reason instanceof BusinessError ? controller.signal.reason : new BusinessError('E_CANCELLED', '本次章节尝试已结束', 'AGENT_RUNTIME')); };
    const expired = () => {
      cleanup();
      const error = new BusinessError(first ? 'E_AGENT_FIRST_RESPONSE_TIMEOUT' : 'E_AGENT_STALL_TIMEOUT', first ? '模型未在配置时间内返回首个响应，可重试本部分' : '模型在配置时间内没有新活动，可重试本部分', 'AGENT_RUNTIME', true, { timeoutMs, ...diagnostics?.() });
      controller.abort(error); reject(error);
    };
    const timer = setTimeout(expired, timeoutMs);
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (timeoutMs <= 0) { expired(); return; }
    if (controller.signal.aborted) { aborted(); return; }
    try { pending().then(value => { cleanup(); resolve(value); }, cause => { cleanup(); reject(cause); }); }
    catch (cause) { cleanup(); reject(cause); }
  });
}
