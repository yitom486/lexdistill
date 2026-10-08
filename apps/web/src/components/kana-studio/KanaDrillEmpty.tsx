import { sound } from "../../utils/audio.js";
import { Button } from "../ui/button.js";
import type { KanaStudioState } from '../../hooks/useKanaStudio.js';
export function KanaDrillEmpty({ state }: {
    state: KanaStudioState;
}) {
    const { refetchKana, isKanaLoading, setIsDrillActive, adaptiveKanaQueueQuery } = state;
    return (<div className="text-center py-6 space-y-4">
                <p className="text-xs text-ink-stone-500">
                  {isKanaLoading || adaptiveKanaQueueQuery.isLoading
            ? '正在按练习记录组题…'
            : '假名表为空：请确认网关已启动（默认 localhost:8080），然后重试。'}
                </p>
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
