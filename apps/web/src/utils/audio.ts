/** UI 音效与包驱动的语音播放入口。 */

import { BusinessError, translateToBusinessError } from '@study-studio/shared';
import type { TtsPurpose } from '@study-studio/speech';
import { createTTSClient, type UnifiedSynthesizeFailure } from 'gemini-tts-studio/client';
import { toast } from 'sonner';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

export interface SpeechStudioConfig {
  rate: number;
  preferredService: string;
  providerApiKeys: Record<string, string>;
  azureRegion: string;
  localBaseUrl: string;
  voiceId: string;
}

function readTtsFailure(error: unknown): UnifiedSynthesizeFailure | null {
  if (!error || typeof error !== 'object' || !('failure' in error)) return null;
  const failure: unknown = error.failure;
  if (!failure || typeof failure !== 'object') return null;
  const candidate = failure as { ok?: unknown; preferredError?: unknown; fallbackError?: unknown };
  const preferred = candidate.preferredError;
  if (candidate.ok !== false || !preferred || typeof preferred !== 'object') return null;
  const first = preferred as { provider?: unknown; message?: unknown };
  if (typeof first.provider !== 'string' || typeof first.message !== 'string') return null;
  const second = candidate.fallbackError;
  if (second !== null && second !== undefined) {
    if (!second || typeof second !== 'object') return null;
    const local = second as { provider?: unknown; message?: unknown };
    if (typeof local.provider !== 'string' || typeof local.message !== 'string') return null;
  }
  // Every field read from the package error has been checked above.
  return failure as UnifiedSynthesizeFailure;
}

export type SupportedLanguage = 'JA' | 'EN' | 'KO';

class SoundEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // 1. 温暖柔和的按键微触感 (类似木质/机械键盘微触)
  public playClick() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.04);
    } catch {}
  }

  // 2. 答对 / 记忆掌握时的温润和弦 (类似木琴 / 卡林巴琴声)
  public playSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 大三和弦
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.06);

        gain.gain.setValueAtTime(0.07, ctx.currentTime + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.06 + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.06);
        osc.stop(ctx.currentTime + idx * 0.06 + 0.28);
      });
    } catch {}
  }

  public playCorrect() {
    this.playSuccess();
  }

  // 3. 做错时的安抚低音 (不刺耳、非报警声，而是温和的木质提醒)
  public playMistake() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(190, ctx.currentTime + 0.14);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.14);
    } catch {}
  }

  public playError() {
    this.playMistake();
  }

  // 4. 每日打卡达成 / 连击突破时的庆祝和弦 (Fanfare)
  public playFanfare() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 连音升华
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0.1, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.45);
      });
    } catch {}
  }
}

export const sound = new SoundEngine();

/** 仅保存播放状态并调用 gemini-tts-studio；模型、音色与兜底均由包处理。 */
class SpeechStudioEngine {
  private listeners = new Set<() => void>();
  private config: SpeechStudioConfig = {
    rate: 0.9, preferredService: '',
    providerApiKeys: {}, azureRegion: '', localBaseUrl: '', voiceId: '',
  };
  private isSpeaking = false;
  private currentText = '';
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private abortController: AbortController | null = null;
  private sequence = 0;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify(): void { this.listeners.forEach((listener) => listener()); }
  public configure(next: Partial<SpeechStudioConfig>): void {
    this.config = { ...this.config, ...next };
    this.notify();
  }
  public getConfig(): SpeechStudioConfig { return { ...this.config }; }
  public getIsSpeaking(): boolean { return this.isSpeaking; }
  public getCurrentText(): string { return this.currentText; }

  public async speak(
    text: string,
    options?: {
      lang?: SupportedLanguage;
      rate?: number;
      purpose?: TtsPurpose;
      personaName?: string;
      neural?: { voiceId?: string; stylePrompt?: string };
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (error?: unknown) => void;
    },
  ): Promise<void> {
    this.stop();
    if (!text.trim()) return;
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.abortController = controller;
    this.isSpeaking = true;
    this.currentText = text;
    this.notify();
    options?.onStart?.();
    try {
      const config = this.config;
      const language = options?.lang === 'JA' ? 'ja-JP' : options?.lang === 'KO' ? 'ko-KR' : 'en-US';
      // Gateway 地址可能在 Tauri 启动后变更，因此每次调用读取 live binding。
      const credentialHeaders = Object.fromEntries(
        Object.entries(config.providerApiKeys)
          .filter(([provider, key]) => /^[a-z0-9-]+$/.test(provider) && Boolean(key))
          .map(([provider, key]) => [`x-${provider}-api-key`, key]),
      );
      const client = createTTSClient({
        baseUrl: GATEWAY_BASE_URL,
        prefix: '/api/tts-studio',
        headers: credentialHeaders,
      });
      const voiceId = options?.neural?.voiceId || config.voiceId;
      const voicePreference = {
        ...(voiceId ? { voiceId } : {}),
      };
      const result = await client.synthesizeUnified({
        text,
        language,
        ...(options?.purpose ? { purpose: options.purpose } : {}),
        ...(config.preferredService ? { preferredService: config.preferredService } : {}),
        ...(Object.keys(voicePreference).length > 0 ? { voicePreference } : {}),
        credentials: {
          ...(config.azureRegion ? { azureRegion: config.azureRegion } : {}),
          ...(config.localBaseUrl ? { localBaseUrl: config.localBaseUrl } : {}),
        },
      }, controller.signal);
      if (sequence !== this.sequence) return;
      if (result.usedFallback) {
        toast.warning(`首选语音服务失败，已改用本地 TTS：${result.preferredError?.message ?? '原因未提供'}`);
      }
      for (const warning of result.warnings ?? []) toast.message(warning);
      const bytes = Uint8Array.from(atob(result.audioBase64), (char) => char.charCodeAt(0));
      const audioUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      this.currentAudioUrl = audioUrl;
      audio.playbackRate = options?.rate ?? config.rate;
      audio.onended = () => {
        if (sequence !== this.sequence) return;
        this.finishPlayback();
        options?.onEnd?.();
      };
      audio.onerror = () => {
        if (sequence !== this.sequence) return;
        const error = new BusinessError('E_TTS_AUDIO', '语音已生成，但音频播放失败。', 'TOOL_EXECUTION', false);
        this.finishPlayback();
        toast.error(error.userMessage);
        options?.onError?.(error);
      };
      await audio.play();
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      const failure = readTtsFailure(error);
      const userError = failure
        ? new BusinessError(
            'E_TTS_SYNTHESIS',
            `首选 ${failure.preferredError.provider} 失败：${failure.preferredError.message}${failure.fallbackError ? `；本地 TTS 失败：${failure.fallbackError.message}` : ''}`,
            'TOOL_EXECUTION',
            false,
          )
        : translateToBusinessError(error, 'TTS_UNIFIED_CLIENT');
      this.finishPlayback();
      toast.error(userError.userMessage);
      options?.onError?.(userError);
    }
  }
  private finishPlayback(): void {
    this.sequence++;
    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = null;
    this.currentAudio = null;
    this.abortController = null;
    this.isSpeaking = false;
    this.currentText = '';
    this.notify();
  }
  public stop(): void {
    this.sequence++;
    this.abortController?.abort();
    this.currentAudio?.pause();
    this.finishPlayback();
  }
}

// 模块单例跨 HMR 保留当前播放与用户偏好。
const globalScope = globalThis as unknown as { __speechStudio?: SpeechStudioEngine };
export const speechStudio = (globalScope.__speechStudio ??= new SpeechStudioEngine());
