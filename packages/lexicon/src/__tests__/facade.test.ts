import { describe, expect, it } from 'bun:test';
import {
  getMorphAnalyzer as analyzerViaFacade,
  deinflectJa as deinflectJaViaFacade,
  parseOewnXml as oewnViaFacade,
  parseYomitanDictionary as yomitanViaFacade,
} from '../index.js';
import { getMorphAnalyzer as analyzerViaCore, deinflectJa as deinflectJaViaCore } from '@study-studio/dictionary-core';
import {
  parseOewnXml as oewnViaCore,
  parseYomitanDictionary as yomitanViaCore,
} from '@study-studio/dictionary-integrations';

/** M7-4 facade 表面锁：具名导出即规范包的实现本身，不漂移、不包装。 */
describe('lexicon facade', () => {
  it('形态与解析入口与规范包同一实现', () => {
    expect(analyzerViaFacade).toBe(analyzerViaCore);
    expect(deinflectJaViaFacade).toBe(deinflectJaViaCore);
    expect(oewnViaFacade).toBe(oewnViaCore);
    expect(yomitanViaFacade).toBe(yomitanViaCore);
  });
});
