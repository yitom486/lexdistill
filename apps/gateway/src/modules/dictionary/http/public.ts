/**
 * E4a 字典域 HTTP 公共表面：只转出 route factory，供 Gateway composition（create-app）挂载。
 * 业务实现与仓储契约走 ports.ts / persistence；本文件禁业务逻辑。
 */
export { createDictionaryRoutes } from './dictionary-routes.js';
