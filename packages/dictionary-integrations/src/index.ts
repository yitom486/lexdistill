/**
 * M5-2 第三方词典导入解析公共入口（纯解析，无 IO、无存储）。
 *
 * 当前覆盖：Yomitan bank v3（含标题 slug 规范化）、OEWN WN-LMF XML；
 * kengdic/jmdict 解析器仍在网关，后续任务再定。
 */
export * from './models.js';
export * from './yomitan.js';
export * from './oewn.js';
