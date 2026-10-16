/**
 * M7-2 自 learner-core 迁入（C5 起归属 flashcards/render；字节一致，行为不变）。
 *
 * Anki 卡片双层模板（纯函数，无 IO，可被 Gateway / Web / 未来 Agent Tool 复用）。
 *
 * 设计（Yomitan 实仓验证，clean-room 自研，未复制其源码与默认模板）：
 * - 字段模板 `{marker}`：词典数据 → Anki 字段值（单大括号，自研标记集）；
 * - 卡片模板 `{{Field}}`：字段值 → 正面/背面 HTML（Anki 原生 Mustache 子集）。
 * 两层绝不合并：同一份 Note Fields 既可在应用内预览，也可导出到 Anki。
 */

import { buildPitchGraphSvg } from './pitch-graph.js';

/** v1 字段标记清单（白名单；未知标记原样保留并由校验上报）。 */
export const FIELD_MARKERS = [
  'expression',
  'reading',
  'glossary',
  'sentence',
  'audio',
  'tags',
  'url',
  'pitch-accent',
  'pitch-graph',
  'frequency',
  'furigana',
] as const;

export type FieldMarker = (typeof FIELD_MARKERS)[number];

const FIELD_MARKER_SET: ReadonlySet<string> = new Set<string>(FIELD_MARKERS);

/** 卡片渲染的统一输入；由词典条目 / AI 生成结果 / 导入笔记组装而来。 */
export interface CardContext {
  expression: string;
  reading?: string | undefined;
  /** 释义 HTML（调用方组装，渲染侧原样插入不转义）。 */
  glossary: string;
  glossaryPlain?: string | undefined;
  sentence?: string | undefined;
  /** 音频引用（如 `[sound:x.mp3]`）；TTS 合成场景可为空。 */
  audio?: string | undefined;
  tags?: string[] | undefined;
  url?: string | undefined;
  /** 声调 HTML（调用方组装，原样插入不转义）。 */
  pitchAccent?: string | undefined;
  /** 声调阶梯 SVG（buildCardContext 由 reading+pitchPositions 自动生成，原样插入）。 */
  pitchGraph?: string | undefined;
  /** 词频（数字越小越常用）。 */
  frequency?: number | undefined;
  /** 带读音的词面（如振假名 HTML）；缺省回退 expression。 */
  furigana?: string | undefined;
  deckName?: string | undefined;
}

/** 组装 CardContext 的最小条目形状（网关侧 LocalDictionaryEntry / AI 结果均可映射）。 */
export interface CardSourceEntry {
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  pitchLabel?: string | undefined;
  /** 声调核位置（0=平板，1=头高，k=第 k 拍后降；供声调阶梯图）。 */
  pitchPositions?: number[] | undefined;
  frequency?: number | undefined;
  sentence?: string | undefined;
  sourceUrl?: string | undefined;
  tags?: string[] | undefined;
}

/** 统一模板包（交换格式；`.apkg`/JSON/手工模板均先转成它再入库）。 */
export interface AnkiCardFormat {
  id: string;
  name: string;
  entryType: string;
  deckName?: string | undefined;
  modelName?: string | undefined;
  /** Anki 字段名 → 字段模板（含 `{marker}`）。 */
  fields: Record<string, string>;
  frontTemplate: string;
  backTemplate: string;
  css: string;
  templateVersion: number;
  userModified: boolean;
}

export interface RenderedCard {
  fields: Record<string, string>;
  frontHtml: string;
  backHtml: string;
}

/** HTML 转义（纯文本标记输出用；glossary / pitch-accent 为预组装 HTML，不经过它）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 条目 → CardContext（纯组装；不读库、不调网）。 */
export function buildCardContext(entry: CardSourceEntry): CardContext {
  const meanings = entry.meanings.filter((m) => m.trim().length > 0);
  const glossary = meanings.map((m) => `<div>${escapeHtml(m)}</div>`).join('');
  const ctx: CardContext = {
    expression: entry.headword,
    glossary: glossary || `<div>${escapeHtml(entry.headword)}</div>`,
  };
  if (entry.reading) ctx.reading = entry.reading;
  if (meanings.length > 0) ctx.glossaryPlain = meanings.join('；');
  if (entry.sentence) ctx.sentence = entry.sentence;
  if (entry.tags && entry.tags.length > 0) ctx.tags = [...entry.tags];
  if (entry.sourceUrl) ctx.url = entry.sourceUrl;
  if (entry.pitchLabel) ctx.pitchAccent = entry.pitchLabel;
  if (typeof entry.frequency === 'number') ctx.frequency = entry.frequency;
  if (entry.reading && entry.pitchPositions && entry.pitchPositions.length > 0) {
    const graph = buildPitchGraphSvg(entry.reading, entry.pitchPositions, {
      ...(entry.pitchLabel ? { label: entry.pitchLabel } : {}),
    });
    if (graph) ctx.pitchGraph = graph;
  }
  return ctx;
}

/** 标记 → 上下文取值（纯文本类已转义；glossary/pitch-accent 为 HTML 原样输出）。 */
function resolveMarker(marker: string, ctx: CardContext): string | undefined {
  switch (marker) {
    case 'expression':
      return escapeHtml(ctx.expression);
    case 'reading':
      return ctx.reading ? escapeHtml(ctx.reading) : undefined;
    case 'glossary':
      return ctx.glossary;
    case 'sentence':
      return ctx.sentence ? escapeHtml(ctx.sentence) : undefined;
    case 'audio':
      return ctx.audio ? escapeHtml(ctx.audio) : undefined;
    case 'tags':
      return ctx.tags && ctx.tags.length > 0
        ? ctx.tags.map((t) => escapeHtml(t)).join(' ')
        : undefined;
    case 'url':
      return ctx.url ? escapeHtml(ctx.url) : undefined;
    case 'pitch-accent':
      return ctx.pitchAccent;
    case 'pitch-graph':
      return ctx.pitchGraph;
    case 'frequency':
      return typeof ctx.frequency === 'number' ? `#${ctx.frequency}` : undefined;
    case 'furigana':
      return escapeHtml(ctx.furigana ?? ctx.expression);
    default:
      return undefined;
  }
}

/**
 * 渲染字段模板：`{marker}` 替换为上下文值。
 * 未知标记原样保留（由 validateFieldTemplate 上报，不静默吞掉）。
 */
export function renderFieldTemplate(template: string, ctx: CardContext): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9-]*)\}/g, (match, marker: string) => {
    if (!FIELD_MARKER_SET.has(marker)) return match;
    return resolveMarker(marker, ctx) ?? '';
  });
}

/** 字段模板中出现的标记（含未知，用于校验与 UI 字段菜单提示）。 */
export function extractFieldMarkers(template: string): string[] {
  const seen = new Set<string>();
  const markerPattern = /\{([A-Za-z][A-Za-z0-9-]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = markerPattern.exec(template)) !== null) {
    const name = m[1];
    if (name) seen.add(name);
  }
  return [...seen];
}

/** 字段模板校验：返回中文问题描述（空数组 = 通过）。 */
export function validateFieldTemplate(template: string): string[] {
  const issues: string[] = [];
  for (const marker of extractFieldMarkers(template)) {
    if (!FIELD_MARKER_SET.has(marker)) {
      issues.push(`未知字段标记 {${marker}}（v1 支持：${FIELD_MARKERS.join(' / ')})`);
    }
  }
  return issues;
}

/** 卡片模板引用的 `{{Field}}` 名（含 FrontSide/Tags 等特殊名，原样返回供调用方判断）。 */
export function extractCardFields(template: string): string[] {
  const seen = new Set<string>();
  const fieldPattern = /\{\{\s*([#^/]?)\s*([A-Za-z][A-Za-z0-9_:]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = fieldPattern.exec(template)) !== null) {
    const name = m[2];
    if (name) seen.add(name.split(':')[0] ?? name);
  }
  return [...seen];
}

/** 渲染期附加上下文（牌组/标签；ctx 自带 tags/deckName 时 renderCard 自动透传）。 */
export interface CardRenderExtra {
  tags?: string[] | undefined;
  deckName?: string | undefined;
  /** 正面渲染中（决定 cloze 遮住还是揭示；缺省按 frontHtml 是否为空判定）。 */
  isFront?: boolean | undefined;
}

/** `{{c1::正文::提示}}` 挖空：正面显示提示或 […]，背面显示正文（基础支持，无多卡 ord 语义）。 */
export function renderClozeText(text: string, reveal: boolean): string {
  return text.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_m, inner: string) => {
    // inner 已不含 cN:: 前缀：parts[0]=正文，parts[1]=提示（可选）。
    const parts = inner.split('::');
    const body = parts[0] ?? '';
    const hint = parts[1] ?? '';
    if (reveal) return body;
    return hint || '[...]';
  });
}

function stripTagsInline(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 渲染卡片模板（Anki Mustache 子集 v1+S4）：
 * - `{{Field}}`：字段 HTML 原样插入（Anki 语义：字段值本身就是 HTML，不转义）；
 * - `{{FrontSide}}`：正面渲染结果（背面模板用；正面模板中为空）；
 * - `{{Tags}}` / `{{Deck}}` / `{{Subdeck}}`：标签与牌组（extra 或 ctx 透传；缺省为空）；
 * - `{{hint:Field}}`：折叠揭示（Anki 原生是点击链接；预览降级为 details 元素，不跑 JS）；
 * - `{{text:Field}}`：去标签纯文本；`{{cloze:Field}}`：挖空（正面 […]，背面正文；无多卡 ord 语义）；
 * - `{{#F}}…{{/F}}`：字段非空才保留；`{{^F}}…{{/F}}`：字段为空才保留；
 * - 未知 `{{X}}`：按 Anki 行为置空（缺失字段不报错）。
 * 仍不支持（由校验上报）：`{{type:}}` 答案输入（需交互判分，预览/导出均不渲染）。
 * 模板内 JS 不在此处理——预览层负责沙箱隔离。
 */
export function renderCardTemplate(
  template: string,
  fields: Record<string, string>,
  frontHtml = '',
  extra: CardRenderExtra = {}
): string {
  const tags = extra.tags ?? [];
  const deckName = extra.deckName ?? '';
  const specialValue = (name: string): string | undefined => {
    if (name === 'FrontSide') return frontHtml;
    if (name === 'Tags') return tags.join(' ');
    if (name === 'Deck') return deckName;
    if (name === 'Subdeck') return deckName.split('::').pop() ?? '';
    return undefined;
  };
  const isTruthy = (name: string): boolean => {
    const special = specialValue(name);
    if (special !== undefined) return special.trim().length > 0;
    return (fields[name] ?? '').trim().length > 0;
  };
  // 条件块（支持一层嵌套判定：由内向外多次规约，最多 8 轮防病态输入）。
  let out = template;
  const sectionPattern = /\{\{\s*([#^])\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/g;
  for (let round = 0; round < 8; round += 1) {
    sectionPattern.lastIndex = 0;
    if (!sectionPattern.test(out)) break;
    sectionPattern.lastIndex = 0;
    out = out.replace(sectionPattern, (_m, kind: string, name: string, inner: string) => {
      const hit = isTruthy(name);
      const keep = kind === '#' ? hit : !hit;
      return keep ? inner : '';
    });
  }
  // 普通占位（含过滤器与特殊名）
  out = out.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_:]*)\s*\}\}/g, (_m, raw: string) => {
    const parts = raw.split(':');
    const head = parts[0] ?? raw;
    if (!raw.includes(':')) {
      const special = specialValue(head);
      if (special !== undefined) return special;
      return fields[head] ?? '';
    }
    const field = parts.slice(1).join(':');
    const value = fields[field] ?? '';
    if (head === 'hint') {
      if (!value.trim()) return '';
      return `<details class="anki-hint"><summary>${escapeHtml(field)}</summary>${value}</details>`;
    }
    if (head === 'text') return escapeHtml(stripTagsInline(value));
    if (head === 'cloze') {
      const isFront = extra.isFront ?? frontHtml.trim().length === 0;
      return renderClozeText(value, !isFront);
    }
    return '';
  });
  return out;
}

/** 卡片模板校验：未闭合条件块 / 超集过滤器。字段名缺失不报错（Anki 语义置空）。 */
export function validateCardTemplate(template: string): string[] {
  const issues: string[] = [];
  const openPattern = /\{\{\s*[#^]\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
  const closePattern = /\{\{\s*\/\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
  const opens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = openPattern.exec(template)) !== null) {
    if (m[1]) opens.push(m[1]);
  }
  const closes: string[] = [];
  while ((m = closePattern.exec(template)) !== null) {
    if (m[1]) closes.push(m[1]);
  }
  if (opens.length !== closes.length) {
    issues.push(`条件块未闭合（{{#}}/{{^}} 共 ${opens.length} 个，{{/}} 共 ${closes.length} 个）`);
  }
  const filterPattern = /\{\{\s*(type|furigana|kanji|kana|romaji)\s*:/g;
  if (filterPattern.test(template)) {
    issues.push('使用了尚不支持的 Anki 过滤器（如 {{type:}} 答案输入 / 日语注音系），将原样输出不渲染');
  }
  return issues;
}

/** 整包渲染：字段 → 正面 → 背面（含 FrontSide）；ctx 的 tags/deckName 自动透传特殊占位。 */
export function renderCard(format: AnkiCardFormat, ctx: CardContext): RenderedCard {
  const fields: Record<string, string> = {};
  for (const [name, fieldTemplate] of Object.entries(format.fields)) {
    fields[name] = renderFieldTemplate(fieldTemplate, ctx);
  }
  const extra: CardRenderExtra = {
    ...(ctx.tags ? { tags: ctx.tags } : {}),
    ...(ctx.deckName ? { deckName: ctx.deckName } : {}),
  };
  const frontHtml = renderCardTemplate(format.frontTemplate, fields, '', { ...extra, isFront: true });
  const backHtml = renderCardTemplate(format.backTemplate, fields, frontHtml, { ...extra, isFront: false });
  return { fields, frontHtml, backHtml };
}

/** 整包校验（字段模板 + 正反面模板 + 空正面）；空数组 = 通过。 */
export function validateCardFormat(format: AnkiCardFormat): string[] {
  const issues: string[] = [];
  if (Object.keys(format.fields).length === 0) issues.push('字段映射为空：至少需要一个 Anki 字段');
  for (const [name, fieldTemplate] of Object.entries(format.fields)) {
    for (const issue of validateFieldTemplate(fieldTemplate)) {
      issues.push(`字段 ${name}：${issue}`);
    }
  }
  issues.push(...validateCardTemplate(format.frontTemplate).map((i) => `正面模板：${i}`));
  issues.push(...validateCardTemplate(format.backTemplate).map((i) => `背面模板：${i}`));
  const probe = renderCard(format, {
    expression: '検証',
    reading: 'けんしょう',
    glossary: '<div>验证</div>',
  });
  if (probe.frontHtml.trim().length === 0) {
    issues.push('正面模板渲染为空：示例词条下正面没有任何内容');
  }
  return issues;
}

const BUILTIN_CSS = [
  '.card {',
  '  --card-ink: #292524;',
  '  --card-surface: #fff;',
  '  --card-reading-ink: #78716c;',
  '  --card-pitch-accent: #d97706;',
  '  --card-pitch-ink: #b45309;',
  '  --card-sentence-line: #d6d3d1;',
  '  --card-sentence-ink: #57534e;',
  '  --card-answer-line: #e7e5e4;',
  '  --card-tags-ink: #a8a29e;',
  '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;',
  '  font-size: 20px;',
  '  line-height: 1.6;',
  '  color: var(--card-ink);',
  '  background: var(--card-surface);',
  '  padding: 24px;',
  '  text-align: center;',
  '}',
  '.word { font-size: 2.2em; font-weight: 700; }',
  '.reading { margin-top: 0.4em; color: var(--card-reading-ink); }',
  '.pitch { margin-top: 0.4em; font-size: 0.85em; color: var(--card-pitch-ink); }',
  '.meaning { margin-top: 1em; text-align: left; }',
  '.sentence {',
  '  margin-top: 1em;',
  '  padding: 10px 12px;',
  '  border-left: 3px solid var(--card-sentence-line);',
  '  text-align: left;',
  '  color: var(--card-sentence-ink);',
  '}',
  '#answer { border: none; border-top: 1px solid var(--card-answer-line); margin: 1em 0; }',
  '.tags { margin-top: 1em; font-size: 0.75em; color: var(--card-tags-ink); }',
].join('\n');

/** 内置默认模板（自写，未复制 Yomitan 默认模板；STATIC-DATA-INVENTORY 登记）。 */
export const BUILTIN_CARD_FORMATS: AnkiCardFormat[] = [
  {
    id: 'study-basic',
    name: 'LexDistill 基础',
    entryType: 'term',
    deckName: 'LexDistill',
    modelName: 'LexDistill Basic',
    fields: {
      Expression: '{expression}',
      Reading: '{reading}',
      Meaning: '{glossary}',
      Sentence: '{sentence}',
      Pitch: '{pitch-accent} {pitch-graph}',
    },
    frontTemplate: '<div class="word">{{Expression}}</div>',
    backTemplate: [
      '{{FrontSide}}',
      '<hr id="answer">',
      '{{#Reading}}<div class="reading">{{Reading}}</div>{{/Reading}}',
      '{{#Pitch}}<div class="pitch">{{Pitch}}</div>{{/Pitch}}',
      '<div class="meaning">{{Meaning}}</div>',
      '{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}',
    ].join('\n'),
    css: BUILTIN_CSS,
    templateVersion: 4,
    userModified: false,
  },
];

/** 按 id 取内置模板（读侧永不抛；找不到返回 undefined）。 */
export function getBuiltinCardFormat(id: string): AnkiCardFormat | undefined {
  return BUILTIN_CARD_FORMATS.find((f) => f.id === id);
}

/** 网上模板字段名 → 我方标记的推测（归一化比对；猜不出返回 null，由导入 UI 请用户确认）。 */
const FIELD_GUESS_TABLE: Array<{ marker: FieldMarker; names: string[] }> = [
  { marker: 'expression', names: ['expression', 'word', 'front', 'vocab', 'vocabulary', 'term', 'question', 'kanji', 'hanzi', 'korean'] },
  { marker: 'reading', names: ['reading', 'yomi', 'kana', 'pronunciation', 'pinyin', 'romaja', 'romaji'] },
  { marker: 'glossary', names: ['meaning', 'meanings', 'definition', 'definitions', 'back', 'gloss', 'glossary', 'answer', 'explanation', 'translation', 'chinese', 'chinesemeaning'] },
  { marker: 'sentence', names: ['sentence', 'example', 'examples', 'context', 'passage'] },
  { marker: 'audio', names: ['audio', 'sound', 'pronunciationaudio', 'tts'] },
  { marker: 'tags', names: ['tags', 'tag'] },
  { marker: 'url', names: ['url', 'link', 'source'] },
  { marker: 'pitch-accent', names: ['pitch', 'accent', 'pitchaccent'] },
  { marker: 'frequency', names: ['frequency', 'freq'] },
  { marker: 'furigana', names: ['furigana'] },
];

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-]+/g, '');
}

/** Anki 字段名 → 标记推测（null = 猜不出，需用户确认；否则导入成功也是空白卡）。 */
export function guessFieldMapping(fieldNames: string[]): Record<string, FieldMarker | null> {
  const mapping: Record<string, FieldMarker | null> = {};
  for (const raw of fieldNames) {
    const norm = normalizeFieldName(raw);
    let hit: FieldMarker | null = null;
    for (const row of FIELD_GUESS_TABLE) {
      if (row.names.includes(norm)) {
        hit = row.marker;
        break;
      }
    }
    mapping[raw] = hit;
  }
  return mapping;
}

/**
 * 网上模板兼容性分析（v1 渲染能力对照；返回中文提示，调用方展示给用户确认）。
 * 在 validateCardTemplate 基础上追加：script 脚本（永不执行）、{{Card}}/{{Type}} 等特殊名
 * （仍置空）、<style> 内联样式（Anki 归 Styling 栏，建议移到 CSS）。
 */
export function analyzeTemplateCompat(front: string, back: string, css: string): string[] {
  const issues = [...validateCardTemplate(front).map((i) => `正面模板：${i}`)];
  issues.push(...validateCardTemplate(back).map((i) => `背面模板：${i}`));
  const combined = `${front}\n${back}`;
  if (/<script[\s>]/i.test(combined)) {
    issues.push('模板含 <script> 脚本：为安全起见永不执行，相关交互在 Anki 中将失效');
  }
  const specials = ['Card', 'Type'];
  const used = extractCardFields(combined).filter((f) => specials.includes(f));
  if (used.length > 0) {
    issues.push(`使用了 v1 不渲染的特殊占位（${used.map((f) => `{{${f}}}`).join('、')}），将显示为空`);
  }
  if (/<style[\s>]/i.test(combined)) {
    issues.push('模板内嵌 <style>：建议移到样式（CSS）栏，保持与 Anki 结构一致');
  }
  if (!css.trim()) {
    issues.push('样式（CSS）为空：卡片将使用 Anki 默认外观');
  }
  return issues;
}
