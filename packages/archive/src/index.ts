/**
 * `@study-studio/archive` 唯一公共出口（白名单制）。
 *
 * 最小纯 TS 解包器（tar.gz/zip 子集＋300MB 防炸弹；只读内存，不写盘）。
 * E2b 起家于 gateway（前身 modules/library/application/pdf-import/archive.ts）。
 * 消费者：PDF 运行时构件解包、EPUB 解析、Yomitan/APKG 词典包解包。
 * 本包仅依赖 shared；解包能力禁第二实现（见包 README）。
 */
export {
  extractTarGz,
  extractZip,
  normalizeZipEntryPaths,
  type ArchiveEntry,
  type ExtractOptions,
} from './archive.js';
