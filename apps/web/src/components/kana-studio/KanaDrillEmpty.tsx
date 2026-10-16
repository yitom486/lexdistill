import { sound } from "../../utils/audio.js";
import { Button } from "../ui/button.js";
import { GATEWAY_BASE_URL } from "../../lib/api-client.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
export function KanaDrillEmpty({ state }: {
    state: KanaStudioState;
}) {
    const { refetchKana, isKanaLoading, setIsDrillActive, adaptiveKanaQueueQuery } = state;
    const queueLoading = isKanaLoading || adaptiveKanaQueueQuery.isLoading;
    // 空队列三种情形：组题中 / 队列请求失败 / 成功但无可练题目。空本身不是故障证据。
    const queueFailed = !queueLoading && adaptiveKanaQueueQuery.isError === true;
    return (<div className="text-center py-6 space-y-4">
                <p className="text-xs text-ink-stone-500">
                  {queueLoading
            ? '正在按练习记录组题…'
            : queueFailed
              ? '自测题读取失败。'
              : '当前暂无可练题目，可先在矩阵学习后再来。'}
                </p>
                {!queueLoading && queueFailed && (
                  <details className="text-xs text-ink-faint-soft">
                    <summary className="cursor-pointer hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded">
                      查看连接诊断
                    </summary>
                    <p className="mt-1 leading-relaxed">练习队列请求未成功，可检查网关连接与运行状态后重试。当前网关地址：{GATEWAY_BASE_URL}（默认 localhost:8080）。</p>
                  </details>
                )}
                <div className="flex items-center justify-center gap-3">
                  <Button onClick={() => {
            sound.playClick();
            setIsDrillActive(false);
        }} variant="outline" size="sm" className="text-xs">
                    返回矩阵学习
                  </Button>
                  <Button onClick={() => {
            void refetchKana();
        }} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs">
                    重新加载
                  </Button>
                </div>
              </div>);
}
