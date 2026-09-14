/**
 * E4a 学习进度域 HTTP 公共表面：只转出 route factory，供 Gateway composition（create-app）挂载。
 * 业务实现与仓储契约走 ports.ts / persistence / application；本文件禁业务逻辑。
 */
export { createLearningProgressRoutes } from './learning-progress-routes.js';
