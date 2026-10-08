import type { AcpConfigOption } from '@yitom/acp-client';

/**
 * 思考档发现（规则移植自下游 Inkdown 桌面端 `acp-model-thinking.ts`＋`acp-config-menu.ts`
 * 的纯函数核心；SDK 未提供，网关自实现，行为对齐：只认下发原值，不手编档位）。
 *
 * 三条路（互斥，优先级自上而下）：
 * 1. 独立思考选项（id/分类/名命中 thought|reason|effort，或分类 thought_level）→ 直设；
 * 2. 方括号变体（当前模型值尾缀含思考类 key，同 base listed 候选≥2）→ 模型 id 改写；
 * 3. 都没有 → 不可设（如下游一致：绝不发明档位；`-fast` 等横杠是速度/子型号，不是思考档）。
 */

export const MODEL_THINKING_KEYS = [
  'reasoning_effort',
  'effort',
  'reasoning',
  'thinking',
] as const;

const THINKING_SET = new Set<string>(MODEL_THINKING_KEYS);

export interface ModelVariant {
  base: string;
  params: Record<string, string>;
}

export function parseModelVariant(value: unknown): ModelVariant {
  if (typeof value !== 'string') return { base: '', params: {} };
  const text = value.trim();
  if (!text) return { base: '', params: {} };
  const match = /\[(.*)\]$/.exec(text);
  if (!match) return { base: text, params: {} };
  const base = text.slice(0, match.index).trim();
  const params: Record<string, string> = {};
  const raw = (match[1] ?? '').trim();
  if (raw) {
    for (const part of raw.split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const eq = seg.indexOf('=');
      if (eq < 0) continue;
      const key = seg.slice(0, eq).trim();
      const val = seg.slice(eq + 1).trim();
      if (key) params[key] = val;
    }
  }
  return { base, params };
}

export function findVariantThinkingKey(params: Record<string, string>): string | null {
  for (const key of Object.keys(params)) {
    if (THINKING_SET.has(key)) return key;
  }
  return null;
}

/** 独立思考选项（rank2 规则移植，与楷模逐字一致；注：裸 `thinking` 不命中 `thought`，
 * 楷模测试亦只覆盖 effort/reasoning 系——有真实数据再扩，不预判）。 */
export function findThinkingConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  return options.find((option) => {
    const id = `${option.configId} ${option.category ?? ''} ${option.name}`.toLowerCase();
    return /thought|reason|effort/.test(id) || option.category === 'thought_level';
  });
}

function listedValues(model: AcpConfigOption): string[] {
  return (model.options ?? [])
    .map((item) => item.value)
    .filter((value): value is string => typeof value === 'string');
}

function collectCandidates(currentBase: string, allValues: readonly string[]): string[] {
  const base = currentBase.trim();
  if (!base) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of allValues) {
    const parsed = parseModelVariant(item);
    if (parsed.base !== base) continue;
    for (const key of Object.keys(parsed.params)) {
      if (!THINKING_SET.has(key)) continue;
      const value = parsed.params[key]?.trim() ?? '';
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * 保守改写门槛：listed 里找同 base、除目标 key 外其余 param 全等的 variant，
 * 只返回 listed 原值；找不到返回 null（调用方不得发起 set）。
 */
export function findListedVariantId(
  allValues: readonly string[],
  current: Pick<ModelVariant, 'base' | 'params'>,
  patch: { key: string; value: string },
): string | null {
  const base = current.base.trim();
  const targetKey = patch.key.trim();
  const targetValue = patch.value.trim();
  if (!base || !targetKey || !targetValue) return null;
  for (const item of allValues) {
    const parsed = parseModelVariant(item);
    if (parsed.base !== base) continue;
    const listedTarget = parsed.params[targetKey];
    if (listedTarget == null || listedTarget.trim() !== targetValue) continue;
    const currentKeys = Object.keys(current.params).filter((key) => key !== targetKey);
    const listedKeys = Object.keys(parsed.params).filter((key) => key !== targetKey);
    if (currentKeys.length !== listedKeys.length) continue;
    let equal = true;
    for (const key of currentKeys) {
      const a = (current.params[key] ?? '').trim();
      const b = (parsed.params[key] ?? '').trim();
      if (!(key in parsed.params) || a !== b) {
        equal = false;
        break;
      }
    }
    if (equal) return item;
  }
  return null;
}

export interface ModelThinkingControl {
  configId: string;
  base: string;
  key: string;
  current: string;
  params: Record<string, string>;
  candidates: string[];
}

/**
 * 变体思考下拉判定（model 选项＋当前值）：候选过滤后≥2 才可设，否则 null。
 * current 兜底并入候选首位，保证下拉 value 始终合法。
 */
export function selectModelThinkingControl(
  model: AcpConfigOption | undefined,
): ModelThinkingControl | null {
  if (!model || typeof model.currentValue !== 'string') return null;
  const parsed = parseModelVariant(model.currentValue);
  if (!parsed.base) return null;
  const key = findVariantThinkingKey(parsed.params);
  if (!key) return null;
  const current = (parsed.params[key] ?? '').trim();
  if (!current) return null;
  const values = listedValues(model);
  let candidates = collectCandidates(parsed.base, values);
  if (!candidates.includes(current)) candidates = [current, ...candidates];
  candidates = candidates.filter(
    (candidate) =>
      candidate === current ||
      findListedVariantId(values, { base: parsed.base, params: parsed.params }, { key, value: candidate }) != null,
  );
  if (candidates.length < 2) return null;
  return { configId: model.configId, base: parsed.base, key, current, params: parsed.params, candidates };
}

export interface ThinkingDiscovery {
  /** 独立选项 id（直设）；变体路为 null */
  effortConfigId: string | null;
  /** 下拉候选项（独立选项值，或变体候选） */
  efforts: string[];
  /** true=变体路（应用=模型 id 改写；探针无法为其他 base 背书） */
  variant: boolean;
  /** 变体路的落点（model 选项 id＋当前解析），应用时复用 */
  control?: ModelThinkingControl;
}

/** 思考档发现总入口（探针＋建会话共用同一实现）。 */
export function discoverThinking(
  parsed: AcpConfigOption[],
  model: AcpConfigOption | undefined,
): ThinkingDiscovery {
  const independent = findThinkingConfigOption(parsed);
  if (independent) {
    return {
      effortConfigId: independent.configId,
      efforts: (independent.options ?? []).map((item) => item.value),
      variant: false,
    };
  }
  const control = selectModelThinkingControl(model);
  if (control) {
    return { effortConfigId: null, efforts: control.candidates, variant: true, control };
  }
  return { effortConfigId: null, efforts: [], variant: false };
}

export interface ThinkingModelResolution {
  configId: string;
  value: string;
}

/**
 * 变体应用解析：把（模型，档位）翻成 listed 模型 id（方括号门槛；横杠不发明）。
 * requestedModel 缺席时按当前值 base 解析。
 */
export function resolveThinkingModelId(
  model: AcpConfigOption,
  effort: string,
  requestedModel?: string,
): ThinkingModelResolution | null {
  const target = (effort ?? '').trim();
  if (!target) return null;
  const anchor = (requestedModel ?? '').trim() || (typeof model.currentValue === 'string' ? model.currentValue : '');
  const parsed = parseModelVariant(anchor);
  if (!parsed.base) return null;
  const values = listedValues(model);
  // 首选：锚点自带思考 key（已选变体 id 或方括号当前值）→ 同 base 改写
  const anchorKey = findVariantThinkingKey(parsed.params);
  if (anchorKey) {
    const listed = findListedVariantId(values, { base: parsed.base, params: parsed.params }, { key: anchorKey, value: target });
    if (listed) return { configId: model.configId, value: listed };
    return null;
  }
  // 裸 base：当前值若有思考 key 则以其为准（同会话改档），否则无 variant 概念 → null
  if (typeof model.currentValue !== 'string') return null;
  const current = parseModelVariant(model.currentValue);
  const currentKey = findVariantThinkingKey(current.params);
  if (!currentKey || current.base !== parsed.base) return null;
  const listed = findListedVariantId(values, { base: current.base, params: current.params }, { key: currentKey, value: target });
  if (listed) return { configId: model.configId, value: listed };
  return null;
}
