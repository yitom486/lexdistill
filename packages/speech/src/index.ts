/**
 * C1 Speech 稳定公开入口（含 TTS 实现本体）。
 *
 * TTS 行为、配置、网络请求与客户端协议一律不动（M2-2 表面逐项一致）。
 * 不变量：本包不得依赖 Agent 侧包或厂商 SDK；
 * TTS 是独立能力，不归 Agent（单测锁定）。
 */
export {
  voiceNameHints,
  scoreVoiceName,
  pickBestVoiceName,
} from './voice-match.js';
export type {
  TtsGender,
  TtsPurpose,
  TtsTrackLanguage,
  TtsNeuralOptions,
  TtsSpeakHandle,
  TtsSpeakInput,
  TtsSpeakRequest,
  TtsVoiceDescriptor,
  TtsVoicePreference,
} from './types.js';
export {
  TTS_STYLE_PROMPTS,
  bcp47ForTrack,
  normalizeTtsTrackLanguage,
  resolveTtsSpeakRequest,
} from './request.js';
export {
  __resetTtsEnginesForTest,
  getActiveTtsEngine,
  listTtsEngines,
  registerTtsEngine,
  setActiveTtsEngine,
} from './engine.js';
export type { TtsEngine } from './engine.js';
export { TTS_PREVIEW_TEXTS, previewTextForTrack } from './preview-texts.js';
export {
  buildOpenAiSpeechPayload,
  isHttpEndpoint,
  openAiSpeechHeaders,
} from './plugin.js';
export type { OpenAiSpeechPayloadOptions } from './plugin.js';
export {
  AZURE_DEFAULT_VOICES,
  AZURE_VOICE_LANG,
  azureTtsEndpoint,
  azureTtsHeaders,
  azureVoicesEndpoint,
  buildAzureSsml,
  escapeXmlText,
  mapAzureVoiceList,
} from './azure.js';
export type {
  AzureVoiceListItem,
  AzureVoiceOption,
} from './azure.js';
export { StubTtsEngine } from './stub.js';
