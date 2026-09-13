import { describe, expect, it } from 'bun:test';
import {
  renderCard as renderViaFacade,
  getBuiltinCardFormat as formatViaFacade,
  createAnkiClient as clientViaFacade,
  resolveAnkiEndpoint as endpointViaFacade,
  parseApkgEntries as parseViaFacade,
} from '../index.js';
import { renderCard as renderViaCore, getBuiltinCardFormat as formatViaCore } from '@study-studio/flashcard-core';
import {
  createAnkiClient as clientViaCore,
  resolveAnkiEndpoint as endpointViaCore,
  parseApkgEntries as parseViaCore,
} from '@study-studio/flashcard-integrations';

/** M7-5 facade 表面锁：具名导出即规范包的实现本身，不漂移、不包装。 */
describe('flashcards facade', () => {
  it('渲染与集成入口与规范包同一实现', () => {
    expect(renderViaFacade).toBe(renderViaCore);
    expect(formatViaFacade).toBe(formatViaCore);
    expect(clientViaFacade).toBe(clientViaCore);
    expect(endpointViaFacade).toBe(endpointViaCore);
    expect(parseViaFacade).toBe(parseViaCore);
  });
});
