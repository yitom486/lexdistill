import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { BusinessError } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from './gateway-deps.js';
import { createHealthRoutes } from './health-routes.js';
import { createAgentRoutes } from './agent-routes.js';
import { createLearningCompatRoutes } from './learning-routes.js';
import { createDictionaryRoutes } from '../../modules/dictionary/http/dictionary-routes.js';
import { createCardFormatRoutes } from '../../modules/flashcards/http/card-format-routes.js';
import { createCardDraftRoutes } from '../../modules/flashcards/http/card-draft-routes.js';
import { createMediaRoutes } from '../../modules/flashcards/http/media-routes.js';
import { createLearningProgressRoutes } from '../../modules/learning-progress/http/learning-progress-routes.js';
import { createPracticeRoutes } from '../../modules/practice/http/practice-routes.js';
import { createPlacementRoutes } from '../../modules/practice/http/placement-routes.js';
import { createReviewRoutes } from '../../modules/review/http/review-routes.js';
import { createLibraryRoutes } from '../../modules/library/http/library-routes.js';
import { createDocumentImportRoutes } from '../../modules/library/http/document-import-routes.js';
import { createDocumentEnrichRoutes } from '../../modules/library/http/document-enrich-routes.js';
import { createEnrichJobRoutes } from '../../modules/library/http/enrich-job-routes.js';
import { createDocumentStructureRoutes } from '../../modules/library/http/document-structure-routes.js';
import { createTextbookQuizRoutes } from '../../modules/library/http/textbook-quiz-routes.js';
import { createPdfImportRoutes } from '../../modules/library/http/pdf-import-routes.js';
import { createCurriculumRoutes } from '../../modules/curriculum/http/curriculum-routes.js';
import { createTtsRoutes } from '../../modules/tts/http/tts-routes.js';

/**
 * 应用构建工厂（G2）：只组装路由，不创建 DB/Adapter/监听。
 * import 本模块不会打开真实数据库（依赖由调用方注入）。
 * 各域子应用经 Hono `.route('/', ...)` 挂载，完整保留路径与 RPC 类型。
 */
export function createApp(deps: GatewayDeps) {
  return new Hono()
    .use(
      '*',
      cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      }),
    )
    .onError((err, c) => {
      console.error('[Gateway Hono onError]', err);
      return formatBusinessErrorResponse(c, err, 'HONO_UNCAUGHT');
    })
    .notFound((c) => {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_NOT_FOUND', '请求的 API 资源不存在或已被迁移。', 'LEARNER_STATE'),
        'HONO_NOT_FOUND',
      );
    })
    .route('/', createHealthRoutes(deps))
    .route('/', createAgentRoutes(deps))
    .route('/', createDictionaryRoutes(deps))
    .route('/', createCardFormatRoutes(deps))
    .route('/', createCardDraftRoutes(deps))
    .route('/', createMediaRoutes(deps))
    .route('/', createLearningProgressRoutes(deps))
    .route('/', createPracticeRoutes(deps))
    .route('/', createPlacementRoutes(deps))
    .route('/', createReviewRoutes(deps))
    .route('/', createLibraryRoutes(deps))
    .route('/', createDocumentImportRoutes(deps))
    .route('/', createDocumentEnrichRoutes(deps))
    .route('/', createEnrichJobRoutes(deps))
    .route('/', createDocumentStructureRoutes(deps))
    .route('/', createTextbookQuizRoutes(deps))
    .route('/', createPdfImportRoutes(deps))
    .route('/', createCurriculumRoutes(deps))
    .route('/', createTtsRoutes())
    .route('/', createLearningCompatRoutes(deps));
}

export type CreatedApp = ReturnType<typeof createApp>;
