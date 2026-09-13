/**
 * M1-2 内容（content）领域公共表面。
 *
 * 跨模块只许 import 本文件（R5 allowlist 登记到 public.js，不再登记深路径）；
 * 本文件只转出已查证的跨域消费符号 + 本域仓储契约，不搬业务实现。
 */
export { extractZip, normalizeZipEntryPaths } from './application/pdf-import/archive.js';
export type { ContentRepository } from './ports.js';
