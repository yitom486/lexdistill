import { describe, expect, it } from 'bun:test';
import {
  getMorphAnalyzer as analyzerViaFacade,
  deinflectJa as deinflectJaViaFacade,
  parseOewnXml as oewnViaFacade,
  parseYomitanDictionary as yomitanViaFacade,
} from '../index.js';
import { getMorphAnalyzer as analyzerViaCore, deinflectJa as deinflectJaViaCore } from '../morphology/index.js';
import {
  parseOewnXml as oewnViaCore,
  parseYomitanDictionary as yomitanViaCore,
} from '../sources/index.js';

/** C4 lexicon 表面锁：具名导出即本包子目录的实现本身，不漂移、不包装。 */
describe('lexicon 入口', () => {
  it('形态与解析入口与规范包同一实现', () => {
    expect(analyzerViaFacade).toBe(analyzerViaCore);
    expect(deinflectJaViaFacade).toBe(deinflectJaViaCore);
    expect(oewnViaFacade).toBe(oewnViaCore);
    expect(yomitanViaFacade).toBe(yomitanViaCore);
  });
});
