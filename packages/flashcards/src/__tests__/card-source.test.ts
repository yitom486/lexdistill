import { describe, expect, it } from 'bun:test';
import {
  resolveCardSource,
  type CardSourcePorts,
  type CardSourceEntryRow,
  type ResolvableCard,
} from '../index.js';

/** M7-11 来源解析用例测试（port 桩，不碰数据库）。 */
function row(overrides: Partial<CardSourceEntryRow> = {}): CardSourceEntryRow {
  return {
    headword: '食べる',
    reading: 'たべる',
    romanization: null,
    meaningsJson: JSON.stringify(['to eat', 'to consume']),
    partOfSpeech: '動詞',
    pronunciationJson: JSON.stringify({ pitch: { reading: 'たべる', positions: [0], label: '⓪' } }),
    sourceLabel: 'seed',
    ...overrides,
  };
}

function portsWith(entry: CardSourceEntryRow | undefined, freqs: number[] = []): CardSourcePorts {
  return {
    findEntryById: async () => entry,
    findFrequenciesByHeadword: async () => freqs,
  };
}

const CARD: ResolvableCard = { front: '食べる', back: 'to eat', phonetic: 'たべる' };

describe('resolveCardSource', () => {
  it('无来源词条 → 回退卡片自身前后端（无臆造、无 label）', async () => {
    const res = await resolveCardSource(portsWith(undefined), { front: 'F', back: 'B' });
    expect(res).toEqual({ source: { headword: 'F', meanings: ['B'] } });
  });

  it('词条不存在 → 同样回退', async () => {
    const res = await resolveCardSource(portsWith(undefined), { ...CARD, sourceEntryId: 'missing' });
    expect(res.source).toEqual({ headword: '食べる', meanings: ['to eat'] });
    expect(res.sourceLabel).toBeUndefined();
  });

  it('完整词条：reading/词性/声调/最小词频映射', async () => {
    const res = await resolveCardSource(
      portsWith(row(), [120, 30, 88]),
      { ...CARD, sourceEntryId: 'entry-1' }
    );
    expect(res.source.headword).toBe('食べる');
    expect(res.source.meanings).toEqual(['to eat', 'to consume']);
    expect(res.source.reading).toBe('たべる');
    expect(res.source.partOfSpeech).toBe('動詞');
    expect(res.source.pitchLabel).toBe('⓪');
    expect(res.source.pitchPositions).toEqual([0]);
    expect(res.source.frequency).toBe(30);
    expect(res.sourceLabel).toBe('seed');
  });

  it('reading 优先级：romanization 与卡片 phonetic 兜底', async () => {
    const viaRoman = await resolveCardSource(
      portsWith(row({ reading: null, romanization: 'taberu' })),
      { front: 'F', back: 'B', phonetic: null, sourceEntryId: 'e' }
    );
    expect(viaRoman.source.reading).toBe('taberu');
    const viaCard = await resolveCardSource(
      portsWith(row({ reading: null, romanization: null })),
      { front: 'F', back: 'B', phonetic: 'p', sourceEntryId: 'e' }
    );
    expect(viaCard.source.reading).toBe('p');
  });

  it('非法 meaningsJson 与空数组 → 回退卡片 back', async () => {
    const bad = await resolveCardSource(
      portsWith(row({ meaningsJson: 'not-json{{{' })),
      { ...CARD, sourceEntryId: 'e' }
    );
    expect(bad.source.meanings).toEqual(['to eat']);
    const empty = await resolveCardSource(
      portsWith(row({ meaningsJson: JSON.stringify([42, null]) })),
      { ...CARD, sourceEntryId: 'e' }
    );
    expect(empty.source.meanings).toEqual(['to eat']);
  });

  it('非法 pitch 数据 → 无声调字段；有 positions 无 reading → 不写 pitchPositions', async () => {
    const badPitch = await resolveCardSource(
      portsWith(row({ pronunciationJson: 'garbage' })),
      { ...CARD, sourceEntryId: 'e' }
    );
    expect(badPitch.source.pitchLabel).toBeUndefined();
    expect(badPitch.source.pitchPositions).toBeUndefined();
    const noReading = await resolveCardSource(
      portsWith(row({ reading: null, romanization: null })),
      { front: 'F', back: 'B', phonetic: null, sourceEntryId: 'e' }
    );
    expect(noReading.source.reading).toBeUndefined();
    expect(noReading.source.pitchPositions).toBeUndefined();
    // label 仍保留（仅 positions 需读音在场）
    expect(noReading.source.pitchLabel).toBe('⓪');
  });

  it('词频 port 失败 → 不影响正常来源解析', async () => {
    const ports: CardSourcePorts = {
      findEntryById: async () => row(),
      findFrequenciesByHeadword: async () => {
        throw new Error('freq store down');
      },
    };
    const res = await resolveCardSource(ports, { ...CARD, sourceEntryId: 'e' });
    expect(res.source.headword).toBe('食べる');
    expect(res.source.meanings).toEqual(['to eat', 'to consume']);
    expect(res.source.frequency).toBeUndefined();
    expect(res.sourceLabel).toBe('seed');
  });
});
