import { describe, expect, it } from 'bun:test';
import { parseOewnXml } from '../index.js';

describe('OEWN importer', () => {
  it('flattens lexical entries and resolves their synset definitions', () => {
    const entries = parseOewnXml(`
      <LexicalResource>
        <Lexicon>
          <LexicalEntry id="oewn-example-n">
            <Lemma writtenForm="example" partOfSpeech="n"/>
            <Sense id="oewn-example-n-01" synset="oewn-00000001-n"/>
          </LexicalEntry>
          <Synset id="oewn-00000001-n" partOfSpeech="n"><Definition>a representative form</Definition></Synset>
        </Lexicon>
      </LexicalResource>
    `);
    expect(entries).toEqual([
      expect.objectContaining({
        id: 'oewn-example-n',
        headword: 'example',
        partOfSpeech: 'n',
        meanings: ['a representative form'],
      }),
    ]);
  });

  it('畸形输入宽容：空串/垃圾/缺义项一律出空数组，不抛', () => {
    expect(parseOewnXml('')).toEqual([]);
    expect(parseOewnXml('not xml at all <<<')).toEqual([]);
    expect(
      parseOewnXml('<LexicalResource><Lexicon></Lexicon></LexicalResource>')
    ).toEqual([]);
    // 有词无义：meanings 为空整条跳过
    expect(
      parseOewnXml(`<LexicalResource><Lexicon>
        <LexicalEntry id="w1"><Lemma writtenForm="w1"/></LexicalEntry>
      </Lexicon></LexicalResource>`)
    ).toEqual([]);
    // 无 id 或无 headword 跳过该条
    expect(
      parseOewnXml(`<LexicalResource><Lexicon>
        <LexicalEntry><Lemma writtenForm="noid"/></LexicalEntry>
        <LexicalEntry id="nohead"><Lemma/></LexicalEntry>
      </Lexicon></LexicalResource>`)
    ).toEqual([]);
  });
});
