/** UI 音效与流式语音播放入口（全站唯一合成通道：网关 SSE 流）。 */

import { BusinessError, translateToBusinessError } from '@study-studio/shared';
import type { TtsPurpose } from '@study-studio/speech';
import { bcp47ForTrack, normalizeTtsTrackLanguage } from '@study-studio/speech';
import { createTTSClient } from 'gemini-tts-studio/client';
import { toast } from 'sonner';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { buildAudioCacheKey, getAudioCache, saveAudioCache, updateAudioCacheLastPlayed } from '../lib/audio-cache.js';
import { audioChunksToBlob, isRawPcmMime, PcmStreamPlayer } from '../lib/pcm-audio.js';
import { buildTtsStreamBody, fetchTtsStream, matchTtsRequest, TtsStreamError, type TtsRequestDescriptor } from '../lib/tts-stream.js';
import { detectSpeakerGender } from '../components/textbook/preview/dialogue-parser.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';

/**
 * R10：界面音效总开关（用户偏好，Zustand persist）。关闭时 click/success/
 * mistake/fanfare 等短音一律静默；学习朗读（speechStudio）与录音不受影响。
 */
function soundEffectsAllowed(): boolean {
  try {
    return usePreferencesStore.getState().soundEffectsEnabled !== false;
  } catch {
    return true;
  }
}

export type { TtsRequestDescriptor };

export interface SpeechStudioConfig {
  rate: number;
  preferredService: string;
  providerApiKeys: Record<string, string>;
  backupApiKeys: Record<string, string>;
  azureRegion: string;
  localBaseUrl: string;
  voiceId: string;
  voiceIdMale: string;
  voiceIdFemale: string;
  modelId: string;
  saveAudioCache: boolean;
}

export interface LastTtsAudio {
  mimeType: string;
  provider: string;
  voice: string;
  model?: string | undefined;
  text: string;
  sizeBytes: number;
}

export type SupportedLanguage = 'JA' | 'EN' | 'KO';

/**
 * 学习轨道 → BCP47（领域包 SSOT，前端不复刻映射表）。
 * 调用方不传轨道一律回落自动识别（与参考站“自动跟随文本”一致）。
 */
function resolveTrackLanguageTag(track?: SupportedLanguage): string | undefined {
  if (!track) return undefined;
  return bcp47ForTrack(normalizeTtsTrackLanguage(track.toLowerCase()));
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private voices = new Map<OscillatorNode, GainNode>();

  private track(osc: OscillatorNode, gain: GainNode): void {
    this.voices.set(osc, gain);
    osc.onended = () => {
      this.voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }

  public stopEffects(): void {
    for (const [osc, gain] of this.voices) {
      osc.onended = null;
      try { osc.stop(); } catch {}
      osc.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
    const context = this.ctx;
    this.ctx = null;
    if (context) void context.close().catch(() => {});
  }

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
    if (!soundEffectsAllowed()) return;
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

      this.track(osc, gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.04);
    } catch {}
  }

  // 2. 答对 / 记忆掌握时的温润和弦 (类似木琴 / 卡林巴琴声)
  public playSuccess() {
    if (!soundEffectsAllowed()) return;
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

        this.track(osc, gain);
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
    if (!soundEffectsAllowed()) return;
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

      this.track(osc, gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.14);
    } catch {}
  }

  public playError() {
    this.playMistake();
  }

  // 4. 每日打卡达成 / 连击突破时的庆祝和弦 (Fanfare)
  public playFanfare() {
    if (!soundEffectsAllowed()) return;
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

        this.track(osc, gain);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.45);
      });
    } catch {}
  }
}

const soundEngine = new SoundEngine();
export const sound = soundEngine;
const unsubscribeSound = usePreferencesStore.subscribe((state, previous) => {
  if (!state.soundEffectsEnabled && previous.soundEffectsEnabled) soundEngine.stopEffects();
});
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribeSound();
  soundEngine.stopEffects();
});

/** 流式语音引擎：唯一合成通道为网关 SSE，首包即播，无一次性兜底。 */
class SpeechStudioEngine {
  private listeners = new Set<() => void>();
  private config: SpeechStudioConfig = {
    rate: 0.9, preferredService: '',
    providerApiKeys: {}, backupApiKeys: {}, azureRegion: '', localBaseUrl: '', voiceId: '', voiceIdMale: '', voiceIdFemale: '', modelId: '',
    saveAudioCache: true,
  };
  private cooldowns = new Map<string, number>();
  private isSpeaking = false;
  private isStreaming = false;
  private streamedSeconds = 0;
  private streamedChunks = 0;
  private currentText = '';
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private streamPlayer: PcmStreamPlayer | null = null;
  private lastAudio: LastTtsAudio | null = null;
  private lastAudioUrl: string | null = null;
  private lastRequest: TtsRequestDescriptor | null = null;
  private cachedDefaultProvider = '';
  private cachedDefaultAt = 0;
  private abortController: AbortController | null = null;
  private sequence = 0;
  private stopEpoch = 0;

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

  /** 查询服务商主用 Key 是否处于 1 分钟冷却期 */
  public isProviderInCooldown(provider: string): boolean {
    const until = this.cooldowns.get(provider.toLowerCase());
    return until ? until > Date.now() : false;
  }

  /** 获取服务商冷却期剩余秒数 */
  public getCooldownRemainingSeconds(provider: string): number {
    const until = this.cooldowns.get(provider.toLowerCase());
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  /** stop() 专属代际：自然播完不加，外部停止才加，供连播区分“播完推进”与“被停住”。 */
  public getStopEpoch(): number { return this.stopEpoch; }
  public getIsStreaming(): boolean { return this.isStreaming; }
  public getStreamedSeconds(): number { return this.streamedSeconds; }
  public getStreamedChunks(): number { return this.streamedChunks; }
  public getCurrentText(): string { return this.currentText; }
  public getLastAudio(): LastTtsAudio | null { return this.lastAudio; }
  public getLastAudioUrl(): string | null { return this.lastAudioUrl; }
  public getLastRequest(): TtsRequestDescriptor | null { return this.lastRequest; }

  /**
   * 当前组合是否有本地缓存可直接重播（免费，不发请求）。
   * 与 speak() 共用同一套归一化规则：任一条件变化即返回 false，调用方走合成。
   */
  public canReplay(
    text: string,
    options?: {
      lang?: SupportedLanguage;
      rate?: number;
      purpose?: TtsPurpose;
      modelId?: string;
      voiceId?: string;
      neural?: { voiceId?: string; stylePrompt?: string; modelId?: string };
    },
  ): boolean {
    if (!this.lastRequest || !this.lastAudioUrl) return false;
    return matchTtsRequest(this.lastRequest, this.describeRequest(text, options));
  }

  /** 播放本地/内置音频文件（假名打包音频）：复用同一套播放状态，停止键同样生效。 */
  public async playLocalFile(
    url: string,
    label: string,
    options?: {
      onEnd?: () => void;
      onError?: (error?: unknown) => void;
    },
  ): Promise<void> {
    this.stop();
    const sequence = ++this.sequence;
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentAudioUrl = url;
    this.isSpeaking = true;
    this.isStreaming = false;
    this.currentText = label;
    this.notify();
    audio.onended = () => {
      if (sequence !== this.sequence) return;
      this.finishPlayback();
      options?.onEnd?.();
    };
    audio.onerror = () => {
      if (sequence !== this.sequence) return;
      const error = new BusinessError('E_TTS_AUDIO', '本地音频播放失败。', 'TOOL_EXECUTION', false);
      this.finishPlayback();
      toast.error(error.userMessage);
      options?.onError?.(error);
    };
    try {
      await audio.play();
    } catch (error) {
      if (sequence !== this.sequence) return;
      const userError = translateToBusinessError(error, 'TTS_LOCAL_CLIENT');
      this.finishPlayback();
      toast.error(userError.userMessage);
      options?.onError?.(userError);
    }
  }

  /** 重播本地缓存（免费）：复用同一套播放状态，停止键同样生效。无缓存返回 false。 */
  public async replayLast(options?: {
    onEnd?: () => void;
    onError?: (error?: unknown) => void;
  }): Promise<boolean> {
    const url = this.lastAudioUrl;
    const last = this.lastAudio;
    if (!url || !last) return false;
    this.stop();
    const sequence = ++this.sequence;
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentAudioUrl = url;
    this.isSpeaking = true;
    this.currentText = last.text;
    this.notify();
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
    try {
      await audio.play();
    } catch (error) {
      if (sequence !== this.sequence) return true;
      const userError = translateToBusinessError(error, 'TTS_REPLAY_CLIENT');
      this.finishPlayback();
      toast.error(userError.userMessage);
      options?.onError?.(userError);
    }
    return true;
  }

  /**
   * 默认服务（用户未锁定时）：运行时取网关包注册表首项并缓存 5 分钟，
   * 包端增减/重排厂商时前端自动跟随；同步路径取不到时返回 ''，
   * 调用方按不匹配处理（重播失效、合成前先异步解析）。
   */
  private syncDefaultProvider(): string {
    return this.cachedDefaultProvider || this.lastRequest?.provider || '';
  }

  private async fetchDefaultProvider(headers: Record<string, string>, signal: AbortSignal): Promise<string> {
    const now = Date.now();
    if (this.cachedDefaultProvider && now - this.cachedDefaultAt < 5 * 60_000) {
      return this.cachedDefaultProvider;
    }
    const client = createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio', headers });
    const providers = await client.getProviders();
    if (signal.aborted) throw new Error('调用方已取消合成');
    const first = providers[0]?.id?.trim().toLowerCase();
    if (!first) throw new TtsStreamError('网关未注册任何 TTS 服务。', 'E_TTS_PROVIDER', true);
    this.cachedDefaultProvider = first;
    this.cachedDefaultAt = now;
    return first;
  }

  private describeRequest(
    text: string,
    options?: {
      lang?: SupportedLanguage;
      rate?: number;
      purpose?: TtsPurpose;
      modelId?: string;
      voiceId?: string;
      neural?: { voiceId?: string; stylePrompt?: string; modelId?: string };
    },
  ): TtsRequestDescriptor {
    const config = this.config;
    const provider = (config.preferredService || '').toLowerCase() || this.syncDefaultProvider();
    const wantedVoice = options?.voiceId || options?.neural?.voiceId || config.voiceId;
    const wantedModel = options?.modelId || options?.neural?.modelId || config.modelId;
    return {
      text,
      provider,
      voice: wantedVoice,
      voiceAuto: !wantedVoice,
      // 非 gemini 不消费模型：归一为空，避免切服务/选模型造成无谓的缓存失效。
      model: provider === 'gemini' ? wantedModel : '',
      modelAuto: provider === 'gemini' ? !wantedModel : true,
      lang: resolveTrackLanguageTag(options?.lang) ?? '',
      rate: options?.rate ?? config.rate,
      purpose: options?.purpose ?? '',
    };
  }

  /** 生成可下载文件名：tts-<provider>-<voice>-<timestamp>.<ext>，只保留安全字符。 */
  public buildLastAudioFileName(): string {
    const safe = (value: string): string => value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'voice';
    const info = this.lastAudio;
    const ext = (info?.mimeType ?? '').includes('mpeg') || (info?.mimeType ?? '').includes('mp3') ? 'mp3' : 'wav';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `tts-${safe(info?.provider ?? 'local')}-${safe(info?.voice ?? 'preview')}-${stamp}.${ext}`;
  }

  /** 将末次合成音频触发为浏览器下载；无音频时返回 false。 */
  public downloadLastAudio(): boolean {
    if (typeof document === 'undefined' || !this.lastAudio || !this.lastAudioUrl) return false;
    const anchor = document.createElement('a');
    anchor.href = this.lastAudioUrl;
    anchor.download = this.buildLastAudioFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  /**
   * 解析流式必需的模型与音色：已选直接用；未选则经网关实时发现
   *（模型取首个 TTS 分类，音色取首个），调用方永远不用填厂商默认值。
   */
  private async resolveStreamVoice(
    provider: string,
    headers: Record<string, string>,
    model: string,
    voice: string,
    signal: AbortSignal,
  ): Promise<{ model: string; voice: string }> {
    if (provider === 'gemini' && model && voice) return { model, voice };
    if (provider !== 'gemini' && voice) return { model, voice };
    const client = createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio', headers });
    const region = provider === 'azure' ? this.config.azureRegion || undefined
      : provider === 'local' ? this.config.localBaseUrl || undefined
      : undefined;
    let resolvedModel = model;
    if (provider !== 'azure' && !resolvedModel) {
      const { models } = await client.getModels(provider, region);
      if (signal.aborted) throw new Error('调用方已取消合成');
      const top = models.find((m) => m.category === 'tts') ?? models[0];
      if (!top) throw new TtsStreamError('网关未返回任何可用 TTS 模型。', 'E_TTS_MODEL', true);
      resolvedModel = top.id;
    }
    let resolvedVoice = voice;
    if (!resolvedVoice) {
      const voices = await client.getVoices(provider, region);
      if (signal.aborted) throw new Error('调用方已取消合成');
      if (voices.length === 0) throw new TtsStreamError('网关未返回任何可用音色。', 'E_TTS_VOICE', true);
      resolvedVoice = voices[0]?.id ?? '';
      if (!resolvedVoice) throw new TtsStreamError('网关未返回任何可用音色。', 'E_TTS_VOICE', true);
    }
    return { model: resolvedModel, voice: resolvedVoice };
  }

  public async speak(
    text: string,
    options?: {
      lang?: SupportedLanguage;
      rate?: number;
      purpose?: TtsPurpose;
      personaName?: string;
      modelId?: string;
      voiceId?: string;
      speaker?: string | undefined;
      gender?: 'male' | 'female' | 'neutral' | undefined;
      neural?: { voiceId?: string; stylePrompt?: string; modelId?: string };
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
    this.isStreaming = true;
    this.streamedSeconds = 0;
    this.streamedChunks = 0;
    this.currentText = text;
    this.notify();
    options?.onStart?.();
    try {
      const config = this.config;
      // Gateway 地址可能在 Tauri 启动后变更，因此每次调用读取 live binding。
      const credentialHeaders = Object.fromEntries(
        Object.entries(config.providerApiKeys)
          .filter(([name, key]) => /^[a-z0-9-]+$/.test(name) && Boolean(key))
          .map(([name, key]) => [`x-${name}-api-key`, key]),
      );
      // 默认服务运行时解析（网关注册表首项），此处必须拿到实值才发请求。
      const provider = (config.preferredService || '').toLowerCase()
        || await this.fetchDefaultProvider(credentialHeaders, controller.signal);
      const language = resolveTrackLanguageTag(options?.lang);
      let wantedVoice = options?.voiceId || options?.neural?.voiceId;
      if (!wantedVoice) {
        if (options?.gender === 'male' && config.voiceIdMale) {
          wantedVoice = config.voiceIdMale;
        } else if (options?.gender === 'female' && config.voiceIdFemale) {
          wantedVoice = config.voiceIdFemale;
        } else if (options?.speaker) {
          const detected = detectSpeakerGender(options.speaker);
          if (detected === 'male' && config.voiceIdMale) {
            wantedVoice = config.voiceIdMale;
          } else if (detected === 'female' && config.voiceIdFemale) {
            wantedVoice = config.voiceIdFemale;
          }
        }
      }
      if (!wantedVoice) {
        wantedVoice = config.voiceId;
      }
      const wantedModel = options?.modelId || options?.neural?.modelId || config.modelId;
      const { model, voice } = await this.resolveStreamVoice(
        provider, credentialHeaders, wantedModel, wantedVoice, controller.signal,
      );
      if (sequence !== this.sequence) return;
      const rate = options?.rate ?? config.rate;
      const cacheKey = buildAudioCacheKey({
        text,
        provider,
        voice,
        model,
        rate,
        lang: language,
        purpose: options?.purpose,
      });

      if (config.saveAudioCache) {
        const cached = await getAudioCache(cacheKey);
        if (cached && sequence === this.sequence) {
          const audioUrl = URL.createObjectURL(cached.blob);
          if (this.lastAudioUrl && this.lastAudioUrl !== audioUrl) {
            URL.revokeObjectURL(this.lastAudioUrl);
          }
          this.lastAudio = {
            mimeType: cached.mimeType,
            provider: cached.provider,
            voice: cached.voice,
            model: cached.model,
            text: cached.text,
            sizeBytes: cached.sizeBytes,
          };
          this.lastAudioUrl = audioUrl;
          this.lastRequest = {
            text,
            provider,
            voice,
            voiceAuto: !wantedVoice,
            model: provider === 'gemini' ? model : '',
            modelAuto: provider === 'gemini' ? !wantedModel : true,
            lang: language ?? '',
            rate,
            purpose: options?.purpose ?? '',
          };
          this.isStreaming = false;
          this.notify();

          const audio = new Audio(audioUrl);
          this.currentAudio = audio;
          this.currentAudioUrl = audioUrl;
          audio.onended = () => {
            if (sequence !== this.sequence) return;
            this.finishPlayback();
            options?.onEnd?.();
          };
          audio.onerror = () => {
            if (sequence !== this.sequence) return;
            const error = new BusinessError('E_TTS_AUDIO', '缓存音频播放失败。', 'TOOL_EXECUTION', false);
            this.finishPlayback();
            toast.error(error.userMessage);
            options?.onError?.(error);
          };
          await audio.play();
          void updateAudioCacheLastPlayed(cacheKey);
          return;
        }
      }

      const body = buildTtsStreamBody({
        provider,
        text,
        voiceName: voice,
        ...(provider === 'gemini' ? { model } : {}),
        // 不再透传 speechMetadata：上游 gemini-tts-studio 会把它拼成
        // `Say in a <purpose> style: <正文>` 发给模型，导致读出英文前奏。
        // purpose 只留在本地 lastRequest/缓存键，不进合成正文。
        // 未传轨道语种时省略 languageCode，网关按自动识别处理（参考站默认行为）。
        ...(provider === 'gemini' && language ? { languageCode: language } : {}),
        ...(provider === 'azure' && config.azureRegion ? { region: config.azureRegion } : {}),
        ...(provider === 'local' && config.localBaseUrl ? { endpoint: config.localBaseUrl } : {}),
        ...(Number.isFinite(rate) ? { speed: rate } : {}),
      });

      const inCooldown = (this.cooldowns.get(provider) ?? 0) > Date.now();
      const primaryKey = config.providerApiKeys[provider]?.trim() || '';
      const backupKey = config.backupApiKeys?.[provider]?.trim() || '';
      // 若当前在 1 分钟冷却期且存在备用 Key，直接启用备用 Key 兜底；否则优先主用 Key
      const activeKey = inCooldown && backupKey ? backupKey : primaryKey;
      const activeHeaders = { ...credentialHeaders };
      if (activeKey) {
        activeHeaders[`x-${provider}-api-key`] = activeKey;
      }

      const isRateLimitOrQuotaError = (err: unknown): boolean => {
        if (!err) return false;
        if (err instanceof TtsStreamError) {
          if (['E_TTS_QUOTA', 'E_TTS_RATE_LIMIT', 'E_TTS_USAGE_LIMIT'].includes(err.code)) return true;
        }
        const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
        if (['E_TTS_QUOTA', 'E_TTS_RATE_LIMIT', 'E_TTS_USAGE_LIMIT'].includes(code)) return true;
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate limit');
      };

      let livePlayer: PcmStreamPlayer | null = null;
      let firstChunkAt = 0;

      const executeStream = async (headersToUse: Record<string, string>) => {
        return await fetchTtsStream(body, {
          headers: headersToUse,
          signal: controller.signal,
          onChunk: async (chunk) => {
            if (sequence !== this.sequence) return;
            this.streamedChunks += 1;
            // 非 PCM 单包（Azure/本地降级）不是可续播的帧，硬塞只会放出噪声，只计数。
            if (!isRawPcmMime(chunk.mimeType)) return;
            if (!livePlayer) {
              livePlayer = new PcmStreamPlayer(chunk.sampleRate);
              this.streamPlayer = livePlayer;
              await livePlayer.resume();
              firstChunkAt = Date.now();
            }
            livePlayer.pushChunk(chunk.bytes);
            this.streamedSeconds = livePlayer.playedSeconds;
            this.notify();
          },
        });
      };

      let streamResult: Awaited<ReturnType<typeof fetchTtsStream>>;
      try {
        streamResult = await executeStream(activeHeaders);
        // 主用 Key 成功时清除之前记录的冷却
        if (!inCooldown && this.cooldowns.has(provider)) {
          this.cooldowns.delete(provider);
        }
      } catch (firstErr) {
        if (sequence !== this.sequence || controller.signal.aborted) return;
        // 如果主用 Key 触发了 429 / 配额限制，且配了备用 Key，则触发 1 分钟冷却并自动兜底
        if (!inCooldown && backupKey && isRateLimitOrQuotaError(firstErr)) {
          this.cooldowns.set(provider, Date.now() + 60_000);
          toast.info('免费 API 触发频率限制（15 RPM/429），已自动切换备用 Key（60 秒后恢复优先免费）');
          if (this.streamPlayer) {
            await this.streamPlayer.close().catch(() => {});
            this.streamPlayer = null;
            livePlayer = null;
            this.streamedChunks = 0;
            this.streamedSeconds = 0;
          }
          const backupHeaders = { ...activeHeaders, [`x-${provider}-api-key`]: backupKey };
          streamResult = await executeStream(backupHeaders);
        } else {
          throw firstErr;
        }
      }

      if (sequence !== this.sequence) return;
      const { chunks, sampleRate, mimeType } = streamResult;
      // 按 mime 拼装：PCM 包 WAV 头，完整文件直接拼接，绝不二次封装。
      const blob = audioChunksToBlob(chunks, mimeType, sampleRate);
      if (config.saveAudioCache) {
        void saveAudioCache({
          id: cacheKey,
          text,
          provider,
          voice,
          model: provider === 'gemini' ? model : '',
          rate,
          lang: language ?? '',
          purpose: options?.purpose ?? '',
          mimeType: blob.type || mimeType,
          sizeBytes: blob.size,
          blob,
        });
      }
      if (this.lastAudioUrl) URL.revokeObjectURL(this.lastAudioUrl);
      const audioUrl = URL.createObjectURL(blob);
      // 末次音频保留为可下载/重播入口：finishPlayback 只清当前播放，不清 lastAudioUrl。
      this.lastAudio = {
        mimeType: blob.type || mimeType,
        provider,
        voice,
        ...(provider === 'gemini' ? { model } : {}),
        text,
        sizeBytes: blob.size,
      };
      this.lastAudioUrl = audioUrl;
      this.lastRequest = {
        text,
        provider,
        voice,
        voiceAuto: !wantedVoice,
        model: provider === 'gemini' ? model : '',
        modelAuto: provider === 'gemini' ? !wantedModel : true,
        lang: language ?? '',
        rate,
        purpose: options?.purpose ?? '',
      };
      this.isStreaming = false;
      this.notify();
      if (!livePlayer) {
        // 非 PCM 单包：没有实时流可播，直接播拼好的完整文件。
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;
        this.currentAudioUrl = audioUrl;
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
        return;
      }
      // PCM 直播已在播：按剩余时长自动结算，拼好的 Blob 留作重播/下载。
      const totalSec = chunks.reduce((n, c) => n + c.length, 0) / 2 / sampleRate;
      const elapsedSec = firstChunkAt > 0 ? (Date.now() - firstChunkAt) / 1000 : 0;
      const remainMs = Math.max(0, totalSec - elapsedSec) * 1000 + 300;
      const onEnd = options?.onEnd;
      window.setTimeout(() => {
        if (sequence !== this.sequence) return;
        this.finishPlayback();
        onEnd?.();
      }, remainMs);
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      const userError = error instanceof TtsStreamError
        ? new BusinessError(error.code, error.message, 'TOOL_EXECUTION', error.retryable)
        : translateToBusinessError(error, 'TTS_STREAM_CLIENT');
      this.finishPlayback();
      if (['E_TTS_QUOTA', 'E_TTS_RATE_LIMIT', 'E_TTS_USAGE_LIMIT'].includes(userError.code)) {
        toast.warning(userError.userMessage);
      } else {
        toast.error(userError.userMessage);
      }
      options?.onError?.(userError);
    }
  }
  private finishPlayback(): void {
    this.sequence++;
    if (this.currentAudioUrl && this.currentAudioUrl !== this.lastAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = null;
    this.currentAudio = null;
    const player = this.streamPlayer;
    this.streamPlayer = null;
    if (player) player.close().catch(() => {});
    this.abortController = null;
    this.isSpeaking = false;
    this.isStreaming = false;
    this.currentText = '';
    this.notify();
  }
  public stop(): void {
    this.sequence++;
    this.stopEpoch++;
    this.abortController?.abort();
    this.currentAudio?.pause();
    if (this.currentAudioUrl && this.currentAudioUrl !== this.lastAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = null;
    this.currentAudio = null;
    const player = this.streamPlayer;
    this.streamPlayer = null;
    if (player) player.close().catch(() => {});
    this.abortController = null;
    this.isSpeaking = false;
    this.isStreaming = false;
    this.currentText = '';
    this.notify();
  }
}

// 模块单例跨 HMR 保留当前播放与用户偏好。
const globalScope = globalThis as unknown as { __speechStudio?: SpeechStudioEngine };
export const speechStudio = (globalScope.__speechStudio ??= new SpeechStudioEngine());
