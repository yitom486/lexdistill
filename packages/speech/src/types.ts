/**
 * TTS 领域契约（@study-studio/tts-core，零厂商依赖）。
 *
 * 约定：
 * - 本包只定义抽象（引擎接口、请求规约、分语言提示词/上下文）与纯函数，
 *   不 import 任何具体 TTS 厂商 SDK，也不触碰 DOM / speechSynthesis。
 * - 具体引擎（Web Speech 真机、外挂神经端点）各自实现 `TtsEngine` 并注册；
 *   `StubTtsEngine` 仅供单测，生产代码禁止注册。
 */

export type TtsTrackLanguage = 'en' | 'ja' | 'ko';

export type TtsGender = 'FEMALE' | 'MALE';

/** 朗读用途：影响默认语速与上下文标记（听写更慢、预览稍快）。 */
export type TtsPurpose =
  | 'preview'
  | 'reading'
  | 'dictation'
  | 'tutor'
  | 'flashcard'
  | 'general';

export interface TtsVoicePreference {
  gender: TtsGender;
  rate?: number | undefined;
  pitch?: number | undefined;
  preferredVoiceURI?: string | null | undefined;
  /** 人设昵称（如 Jenny / 七海 / Yuna），用于音色名匹配与上下文记录。 */
  personaName?: string | undefined;
}

/** 神经引擎透传项（Web Speech 引擎忽略；外挂/服务端引擎消费）。 */
export interface TtsNeuralOptions {
  voiceId?: string | undefined;
  stylePrompt?: string | undefined;
  endpoint?: string | undefined;
}

export interface TtsSpeakInput {
  text: string;
  /** 目标语种轨道（大小写/常见变体均可，未知回退 en）。 */
  trackLanguage: string;
  purpose?: TtsPurpose | undefined;
  prefs?: TtsVoicePreference | undefined;
  neural?: TtsNeuralOptions | undefined;
}

/** 经 `resolveTtsSpeakRequest` 规约后的完整朗读请求：引擎只需照单执行。 */
export interface TtsSpeakRequest {
  utteranceText: string;
  /** BCP47（en-US / ja-JP / ko-KR），直接喂给引擎。 */
  bcp47: string;
  trackLanguage: TtsTrackLanguage;
  /** 已按用途回填并钳制（0.5–1.5）。 */
  rate: number;
  /** 性别基线（女 1.08 / 男 0.88）；引擎可按实际音色微调。 */
  pitch: number;
  /** 按优先级排列的音色名线索（人设名优先，其次语种性别表）。 */
  voiceMatchNames: string[];
  preferredVoiceURI?: string | undefined;
  personaName?: string | undefined;
  neural: {
    voiceId?: string | undefined;
    /** 分语言朗读风格提示（缺省按轨道回填，可被调用方覆盖）。 */
    stylePrompt: string;
  };
  /** 随请求透传的上下文（日志、服务端引擎 prompt 组装用）。 */
  context: {
    trackLanguage: TtsTrackLanguage;
    purpose: TtsPurpose;
    gender: TtsGender;
  };
}

/** 引擎可见的音色描述（与平台 API 解耦的可比子集）。 */
export interface TtsVoiceDescriptor {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI?: string | undefined;
}

/** 单次朗读句柄：调用方可随时打断，并等待自然结束。 */
export interface TtsSpeakHandle {
  stop(): void;
  readonly finished: Promise<void>;
}
