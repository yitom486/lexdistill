/**
 * E4a 文库域 HTTP 公共表面：只转出 route factory，供 Gateway composition（create-app）挂载。
 * 业务实现与仓储契约走 ports.ts / persistence / application；本文件禁业务逻辑。
 */
export { createLibraryRoutes } from './library-routes.js';
export { createDocumentImportRoutes } from './document-import-routes.js';
export { createDocumentEnrichRoutes } from './document-enrich-routes.js';
export { createEnrichJobRoutes } from './enrich-job-routes.js';
export { createDocumentStructureRoutes } from './document-structure-routes.js';
export { createTextbookQuizRoutes } from './textbook-quiz-routes.js';
export { createPdfImportRoutes } from './pdf-import-routes.js';
