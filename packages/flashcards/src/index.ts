/**
 * M7-5 卡片领域统一对外 facade（领域组合入口，不复制实现）。
 *
 * 转出 Gateway 当前实际使用的卡片模板渲染、AnkiConnect、端点校验与 APKG 解析
 * API，一律具名重导出（不用 `export *`，避免命名冲突与语义漂移）；规范源唯一：
 * 渲染只从 flashcard-core 出，外部集成只从 flashcard-integrations 出。
 * Gateway 继续负责卡片和媒体持久化、用户设置、事务、HTTP、Tool 与业务编排；
 * 本包不连业务数据库、不新增迁移。
 */

/** 卡片模板渲染、预览与校验（纯逻辑）。 */
export {
  buildCardContext,
  renderCard,
  validateCardFormat,
  BUILTIN_CARD_FORMATS,
  getBuiltinCardFormat,
  guessFieldMapping,
  analyzeTemplateCompat,
  type AnkiCardFormat,
  type CardSourceEntry,
  type RenderedCard,
  type FieldMarker,
} from '@study-studio/flashcard-core';

/** AnkiConnect 协议客户端、端点校验与 APKG 解析（纯传输/解析层）。 */
export {
  createAnkiClient,
  ensureAnkiDeck,
  ensureAnkiModel,
  storeAnkiMedia,
  addAnkiNote,
  getAnkiVersion,
  ANKI_CONNECT_DEFAULT_ENDPOINT,
  resolveAnkiEndpoint,
  parseApkgEntries,
  extractMediaRefs,
  type FetchImpl,
  type ParsedApkg,
} from '@study-studio/flashcard-integrations';

/** 卡片推送 Anki 应用用例（最小 port + 编排；设置/读取/合成由调用方实现）。 */
export {
  pushCardToAnki,
  type AnkiPushTts,
  type AnkiPushRequest,
  type AnkiPushResult,
  type AnkiPushSettings,
  type AnkiPushCard,
  type AnkiPushTtsRequest,
  type AnkiPushAudio,
  type AnkiPushPorts,
} from './anki-push.js';

/** 卡片预览应用用例（最小读取 port + 渲染链路；持久化仍归 Gateway）。 */
export {
  previewCard,
  narrowCardSourceEntry,
  type PreviewCardRequest,
  type PreviewCardResult,
  type CardPreviewPorts,
} from './card-preview.js';

/** 卡片来源解析用例（最小 port + 业务映射；查询由调用方实现）。 */
export {
  resolveCardSource,
  type ResolvableCard,
  type ResolvedCardSource,
  type CardSourceEntryRow,
  type CardSourcePorts,
} from './card-source.js';

/** APKG 只读分析用例（模型草稿/牌组统计/媒体计数/映射/兼容性；不写库）。 */
export {
  analyzeParsedApkg,
  type ApkgModelDraft,
  type ApkgDeckSummary,
  type ApkgAnalysis,
} from './apkg-analyze.js';

/** APKG 笔记导入用例（最小写 port + 编排；落库与媒体存储由调用方实现）。 */
export {
  importParsedApkgNotes,
  type ImportParsedApkgNotesOptions,
  type ApkgImportNotesResult,
  type ApkgImportCardInput,
  type ApkgImportPorts,
} from './apkg-import.js';
