import { describe, expect, it } from 'bun:test';
import { createDictionaryRoutes } from '../modules/dictionary/http/public.js';
import {
  createCardFormatRoutes,
  createCardDraftRoutes,
  createMediaRoutes,
} from '../modules/flashcards/http/public.js';
import { createLearningProgressRoutes } from '../modules/learning-progress/http/public.js';
import {
  createPracticeRoutes,
  createPlacementRoutes,
} from '../modules/practice/http/public.js';
import { createReviewRoutes } from '../modules/review/http/public.js';
import {
  createLibraryRoutes,
  createDocumentImportRoutes,
  createDocumentEnrichRoutes,
  createEnrichJobRoutes,
  createTextbookQuizRoutes,
} from '../modules/library/http/public.js';
import { createCurriculumRoutes } from '../modules/curriculum/http/public.js';

/**
 * E4a：14 个标准 `(deps: GatewayDeps)` route factory 存在性锁定。
 * 各域经 `http/public.ts` 转出，create-app 只从 public surface 取；
 * 断言存在性（签名/行为由各域单测与全局 app 集成覆盖）。
 * 异形除外：`createPdfImportRoutes`（可选第二参）、`createTtsRoutes`（零参留守
 * transport）、`createDocumentStructureRoutes`（structure 区 owner 交接敏感带，
 * 存在性由既有集成覆盖，不在此单列）。
 */
describe('E4a domain route factory surface', () => {
  it('14 个标准 factory 均为函数', () => {
    for (const [name, fn] of [
      ['createDictionaryRoutes', createDictionaryRoutes],
      ['createCardFormatRoutes', createCardFormatRoutes],
      ['createCardDraftRoutes', createCardDraftRoutes],
      ['createMediaRoutes', createMediaRoutes],
      ['createLearningProgressRoutes', createLearningProgressRoutes],
      ['createPracticeRoutes', createPracticeRoutes],
      ['createPlacementRoutes', createPlacementRoutes],
      ['createReviewRoutes', createReviewRoutes],
      ['createLibraryRoutes', createLibraryRoutes],
      ['createDocumentImportRoutes', createDocumentImportRoutes],
      ['createDocumentEnrichRoutes', createDocumentEnrichRoutes],
      ['createEnrichJobRoutes', createEnrichJobRoutes],
      ['createTextbookQuizRoutes', createTextbookQuizRoutes],
      ['createCurriculumRoutes', createCurriculumRoutes],
    ] as const) {
      expect(typeof fn, name).toBe('function');
    }
  });
});
