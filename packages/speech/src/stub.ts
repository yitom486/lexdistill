/**
 * 仅供单测的假引擎：不发声，只记录调用并立即完成。
 * 生产代码禁止注册（接入一律真机）。
 */
import { ok, type Result, type BusinessError } from '@study-studio/shared';
import type { TtsSpeakHandle, TtsSpeakRequest } from './types.js';
import type { TtsEngine } from './engine.js';

export class StubTtsEngine implements TtsEngine {
  readonly id = 'stub';
  readonly label = 'Stub (tests only)';
  public readonly calls: TtsSpeakRequest[] = [];
  public stoppedCount = 0;

  public async speak(request: TtsSpeakRequest): Promise<Result<TtsSpeakHandle, BusinessError>> {
    this.calls.push(request);
    return ok({
      stop: () => {
        this.stoppedCount += 1;
      },
      finished: Promise.resolve(),
    });
  }

  public stopAll(): void {
    this.stoppedCount += 1;
  }
}
