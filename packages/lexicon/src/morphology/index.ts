/**
 * C4 词典纯形态学公共入口（clean-room 自研，无外部词典文件；原 dictionary-core 已并入本目录）。
 *
 * 内容：英语词干、日语活用还原、韩语词尾还原、Hangul 音节编解码、
 * 词性归一化、三语形态注册表。零依赖（纯计算，不触存储/网络/Agent）。
 */
export * from './part-of-speech.js';
export * from './hangul.js';
export * from './en-stem.js';
export * from './deinflect.js';
export * from './ko-deinflect.js';
export * from './morphology.js';
