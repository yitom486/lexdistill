import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Slider } from '../ui/slider.js';
import { Badge } from '../ui/badge.js';
import { useTtsStore } from '../../stores/useTtsStore.js';
import type { SupportedLanguage } from '../../utils/audio.js';

interface Props {
  lang: SupportedLanguage;
  /** 网关下发的轨道试音文案；为空表示配置未就绪。 */
  serverText: string;
  /** 输入框占位：父级按试音配置三态（同步中/失败/未下发）给出，失败时绝不显示“正在同步”。 */
  previewPlaceholder?: string;
  /** 用户覆盖输入（空即使用服务端文案）。 */
  userText: string;
  onUserTextChange: (next: string) => void;
}

/**
 * 试听条：一套播放状态（合成→本地缓存→重播），同一按钮按状态切换。
 * 同一组合命中本地缓存即免费重播，不再合成计费；任一条件变化自动转回试听。
 */
export function TtsPreviewBar({ lang, serverText, previewPlaceholder, userText, onUserTextChange }: Props) {
  const rate = useTtsStore((s) => s.rate);
  const setRate = useTtsStore((s) => s.setRate);
  const isSpeaking = useTtsStore((s) => s.isSpeaking);
  const isStreaming = useTtsStore((s) => s.isStreaming);
  const streamedSeconds = useTtsStore((s) => s.streamedSeconds);
  const streamedChunks = useTtsStore((s) => s.streamedChunks);
  const hasLastAudio = useTtsStore((s) => s.hasLastAudio);
  const lastAudioInfo = useTtsStore((s) => s.lastAudioInfo);
  const speak = useTtsStore((s) => s.speak);
  const stop = useTtsStore((s) => s.stop);
  const replayLast = useTtsStore((s) => s.replayLast);
  const canReplay = useTtsStore((s) => s.canReplay);

  const effectiveText = userText.trim() || serverText;
  const ready = effectiveText.trim().length > 0;
  const replayable = ready && !isSpeaking && canReplay(effectiveText, { lang, rate, purpose: 'preview' });

  const handleMainButton = (): void => {
    if (!ready) return;
    if (isSpeaking) {
      stop();
      return;
    }
    if (replayable) {
      void replayLast();
      return;
    }
    void speak(effectiveText, { lang, purpose: 'preview' });
  };

  return (
    <div className="mt-7 border-t border-line pt-7">
      <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="block text-base font-semibold text-ink">
          <span className="flex items-center justify-between">
            试听内容
            <span className="text-xs font-normal text-ink-mute">{effectiveText.length} 字</span>
          </span>
          <input
            className="mt-3 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            value={userText}
            onChange={(e) => onUserTextChange(e.target.value)}
            placeholder={previewPlaceholder ?? (serverText || '输入句子试听…')}
          />
        </label>
        <div>
          <div className="mb-5 flex justify-between text-base font-semibold text-ink"><span>语速</span><span>{rate.toFixed(1)}×</span></div>
          <Slider aria-label="朗读语速" value={rate} min={0.5} max={1.5} step={0.1} onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (typeof next === 'number') setRate(next);
          }} />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="恢复服务端试音文案"
            aria-label="恢复服务端试音文案"
            onClick={() => onUserTextChange('')}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            className="min-h-12 gap-2 px-6 text-base"
            disabled={!ready}
            title={replayable ? '本地已有本次组合的音频，免费重播' : '流式合成并试听'}
            onClick={handleMainButton}
          >
            {isSpeaking ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isSpeaking ? '停止' : replayable ? '重播' : '试听'}
          </Button>
        </div>
      </div>
      {serverText && !userText.trim() && (
        <p className="mt-2 text-xs text-ink-mute">已使用服务端试音文案，可直接试听或输入自己的句子覆盖。</p>
      )}
      {replayable && (
        <p className="mt-2 text-xs text-ink-mute">本地已有本次组合的音频，重播不计费；改动文本/音色/模型/语速后会自动重新合成。</p>
      )}
      {isStreaming && (
        <p role="status" className="mt-2 text-xs text-ink-mute">
          流式播出中…已收 {streamedChunks} 包 / {streamedSeconds.toFixed(1)}s（首包即播，无需等待整段生成）。
        </p>
      )}
      {hasLastAudio && lastAudioInfo && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{lastAudioInfo.provider}</Badge>
          <Badge variant="outline">{lastAudioInfo.voice}</Badge>
          {lastAudioInfo.model ? <Badge variant="outline">{lastAudioInfo.model}</Badge> : null}
        </div>
      )}
    </div>
  );
}
