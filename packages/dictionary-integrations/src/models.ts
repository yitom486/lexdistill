/**
 * M5-2 第三方词典可导入数据模型（纯结构，无存储语义）。
 *
 * `ParsedEntry` 从网关 dictionary-packages 原样迁入（调用方：Yomitan /
 * OEWN 解析器与网关安装链）；形状冻结，改字段即破坏已发布包升级。
 */
export type ParsedEntry = {
  id: string;
  headword: string;
  /** 日语包：假名读音（kana reading），写入 reading 列供读音检索；其他包可空 */
  reading?: string | undefined;
  partOfSpeech?: string;
  pronunciation?: string;
  meanings: string[];
};
