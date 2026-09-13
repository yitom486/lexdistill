/**
 * M7-4 词典领域统一对外 facade（领域组合入口，不复制实现）。
 *
 * 转出 Gateway 当前实际使用的形态学与词典导入解析 API，一律具名重导出
 * （不用 `export *`，避免命名冲突与语义漂移）；规范源唯一：
 * 形态学只从 dictionary-core 出，导入解析只从 dictionary-integrations 出。
 * Gateway 仍负责词典 SQLite、安装事务、下载、HTTP、Tool 与业务编排；
 * 本包不连业务数据库、不新增迁移。
 */

/** 纯形态学（活用还原、词性归一、按语种分析器）。 */
export {
  getMorphAnalyzer,
  coarsePosOfLabel,
  coarsePosName,
  deinflectJa,
  deinflectKo,
  type MorphCandidate,
  type MorphAnalyzer,
  type DictionaryLanguage,
} from '@study-studio/dictionary-core';

/** 词典导入解析（OEWN、Yomitan bank v3）。 */
export {
  parseOewnXml,
  parseIndex,
  parseYomitanDictionary,
  slugifyTitle,
  type ParsedEntry,
  type YomitanPitchRow,
} from '@study-studio/dictionary-integrations';
