import { describe, expect, it } from 'bun:test';
import {
  renderCard as renderViaFacade,
  getBuiltinCardFormat as formatViaFacade,
  createAnkiClient as clientViaFacade,
  resolveAnkiEndpoint as endpointViaFacade,
  parseApkgEntries as parseViaFacade,
} from '../index.js';
import { renderCard as renderViaCore, getBuiltinCardFormat as formatViaCore } from '../render/index.js';
import {
  createAnkiClient as clientViaCore,
  resolveAnkiEndpoint as endpointViaCore,
  parseApkgEntries as parseViaCore,
} from '../integrations/index.js';

/** C5 flashcards 表面锁：具名导出即本包子目录的实现本身，不漂移、不包装。 */
describe('flashcards 入口', () => {
  it('渲染与集成入口与规范包同一实现', () => {
    expect(renderViaFacade).toBe(renderViaCore);
    expect(formatViaFacade).toBe(formatViaCore);
    expect(clientViaFacade).toBe(clientViaCore);
    expect(endpointViaFacade).toBe(endpointViaCore);
    expect(parseViaFacade).toBe(parseViaCore);
  });
});
