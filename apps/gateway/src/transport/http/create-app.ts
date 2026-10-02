import { Hono } from 'hono';
import { createTtsRoutes } from './tts-routes.js';
import { cors } from 'hono/cors';
import { BusinessError } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../composition/gateway-deps.js';
import { createHealthRoutes } from './health-routes.js';
import { createTtsDefaultsRoutes } from './tts-defaults-routes.js';
import { createAgentRoutes } from './agent-routes.js';
import { createLearningCompatRoutes } from './learning-routes.js';
import { createDictionaryRoutes } from '../../modules/dictionary/http/public.js';
import {
  createCardFormatRoutes,
  createCardDraftRoutes,
  createMediaRoutes,
} from '../../modules/flashcards/http/public.js';
import { createLearningProgressRoutes } from '../../modules/learning-progress/http/public.js';
import {
  createPracticeRoutes,
  createTextbookPracticeRoutes,
  createPlacementRoutes,
} from '../../modules/practice/http/public.js';
import { createReviewRoutes } from '../../modules/review/http/public.js';
import {
  createLibraryRoutes,
  createDocumentImportRoutes,
  createDocumentEnrichRoutes,
  createEnrichJobRoutes,
  createDocumentStructureRoutes,
  createTextbookQuizRoutes,
  createPdfImportRoutes,
} from '../../modules/library/http/public.js';
import { createCurriculumRoutes } from '../../modules/curriculum/http/public.js';

/**
 * 应用构建工厂（G2）：只组装路由，不创建 DB/Adapter/监听。
 * import 本模块不会打开真实数据库（依赖由调用方注入）。
 * 各域子应用经 Hono `.route('/', ...)` 挂载，完整保留路径与 RPC 类型。
 */
export function createApp(deps: GatewayDeps) {
  return new Hono()
    // TTS Studio 使用由服务决定的凭证头，预检只在本路由反映请求头。
    .use('/api/tts-studio/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))
    .use(
      '*',
      cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Textbook-Trace'],
      }),
    )
    .onError((err, c) => {
      console.error('[Gateway Hono onError]', err);
      return formatBusinessErrorResponse(c, err, 'HONO_UNCAUGHT');
    })
    .notFound((c) => {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_NOT_FOUND', '请求的 API 资源不存在或已被迁移。', 'ROUTING'),
        'HONO_NOT_FOUND',
      );
    })
    .route('/', createHealthRoutes(deps))
    .route('/', createTtsDefaultsRoutes())
    .route('/', createAgentRoutes(deps))
    .route('/', createDictionaryRoutes(deps))
    .route('/', createCardFormatRoutes(deps))
    .route('/', createCardDraftRoutes(deps))
    .route('/', createMediaRoutes(deps))
    .route('/', createLearningProgressRoutes(deps))
    .route('/', createPracticeRoutes(deps))
    .route('/', createTextbookPracticeRoutes(deps))
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
