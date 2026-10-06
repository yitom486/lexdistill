/**
 * E4a 练习域 HTTP 公共表面：只转出 route factory，供 Gateway composition（create-app）挂载。
 * 业务实现与仓储契约走 ports.ts / persistence / application；本文件禁业务逻辑。
 */
export { createPracticeRoutes } from './practice-routes.js';
export { createAnswerRoutes } from './answer-routes.js';
export { createPlacementRoutes } from './placement-routes.js';
export { createTextbookPracticeRoutes } from './textbook-practice-routes.js';
