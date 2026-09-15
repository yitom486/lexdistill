import { describe, expect, it } from 'bun:test';
import {
  toDomainHeadingCandidate,
  toProtocolStructureClass,
} from '../structure-classify-mapping.js';

describe('document structure application mapping', () => {
  it('maps protocol heading observations to the domain facts used for grounding', () => {
    expect(
      toDomainHeadingCandidate({
        page: 2,
        text: '第2課',
        level: 1,
        relSize: 1.5,
        bold: true,
      })
    ).toEqual({ page: 2, text: '第2課' });
  });

  it('maps a grounded domain class back to the protocol response shape', () => {
    expect(
      toProtocolStructureClass({
        text: '第2課',
        page: 2,
        kind: 'lesson',
        lessonNo: '2',
        skillId: null,
      })
    ).toEqual({
      text: '第2課',
      page: 2,
      kind: 'lesson',
      lessonNo: '2',
      skillId: null,
    });
  });
});
