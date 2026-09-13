/**
 * TTS 引擎抽象与注册表。
 *
 * - 具体引擎（Web Speech 真机、外挂神经端点、未来服务端引擎）实现 `TtsEngine` 并注册；
 *   调用方只认 `getActiveTtsEngine()`，不对具体引擎产生任何感知（Zero Provider Leak）。
 * - `StubTtsEngine` 另见 `./stub.js`，仅供单测。
 */
import type { Result, BusinessError } from '@study-studio/shared';
import type { TtsSpeakHandle, TtsSpeakRequest, TtsVoiceDescriptor, TtsTrackLanguage } from './types.js';

export interface TtsEngine {
  readonly id: string;
  readonly label: string;
  speak(request: TtsSpeakRequest): Promise<Result<TtsSpeakHandle, BusinessError>>;
  stopAll(): void;
  listVoices?(trackLanguage: TtsTrackLanguage): TtsVoiceDescriptor[];
}

const engines = new Map<string, TtsEngine>();
let activeEngineId: string | null = null;

/** 注册引擎；同 id 重复注册直接覆盖（以后注册者为准）。 */
export function registerTtsEngine(engine: TtsEngine): void {
  engines.set(engine.id, engine);
  if (activeEngineId === null) activeEngineId = engine.id;
}

export function setActiveTtsEngine(id: string): boolean {
  if (!engines.has(id)) return false;
  activeEngineId = id;
  return true;
}

export function getActiveTtsEngine(): TtsEngine | undefined {
  if (!activeEngineId) return undefined;
  return engines.get(activeEngineId);
}

export function listTtsEngines(): TtsEngine[] {
  return [...engines.values()];
}

/** 仅供单测隔离（生产代码禁止调用）。 */
export function __resetTtsEnginesForTest(): void {
  engines.clear();
  activeEngineId = null;
}
