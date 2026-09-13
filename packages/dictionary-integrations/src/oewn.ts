import type { ParsedEntry } from './models.js';

/**
 * M5-2 OEWN WN-LMF XML 解析（纯函数；XML 字符串进、扁平词条出）。
 *
 * 从网关 dictionary-packages 原样迁入；XML 小工具（decodeXml/readAttribute）
 * 系 jmdict 解析器共用的 1:1 副本（网关侧保留原件供 kengdic/jmdict 使用，
 * 两边互不同步，有改动以网关侧为准并同步）。
 */
function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAttribute(tag: string, attribute: string): string | undefined {
  const match = new RegExp(`${attribute}="([^"]*)"`).exec(tag);
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// OEWN（英语）解析器
// ---------------------------------------------------------------------------

/** 将 OEWN 的稳定 WN-LMF XML 发布包解析为可导入的扁平词条。 */
export function parseOewnXml(xml: string): ParsedEntry[] {
  const definitions = new Map<string, string>();
  for (const match of xml.matchAll(/<Synset\b([^>]*)>([\s\S]*?)<\/Synset>/g)) {
    const id = readAttribute(match[1]!, 'id');
    const definitionMatch = /<Definition\b[^>]*>([\s\S]*?)<\/Definition>/.exec(match[2]!);
    if (id && definitionMatch) definitions.set(id, decodeXml(definitionMatch[1]!));
  }

  const entries: ParsedEntry[] = [];
  for (const match of xml.matchAll(/<LexicalEntry\b([^>]*)>([\s\S]*?)<\/LexicalEntry>/g)) {
    const id = readAttribute(match[1]!, 'id');
    const body = match[2]!;
    const lemmaTag = /<Lemma\b([^>]*?)(?:\/>|>)/.exec(body)?.[1];
    const headword = lemmaTag ? readAttribute(lemmaTag, 'writtenForm') : undefined;
    if (!id || !headword) continue;

    const meanings = [...body.matchAll(/<Sense\b[^>]*\bsynset="([^"]+)"[^>]*\/?>(?:<\/Sense>)?/g)]
      .map((sense) => definitions.get(sense[1]!))
      .filter((definition): definition is string => Boolean(definition));
    if (meanings.length === 0) continue;

    const entry: ParsedEntry = {
      id,
      headword,
      meanings: [...new Set(meanings)].slice(0, 4),
    };
    const partOfSpeech = readAttribute(lemmaTag!, 'partOfSpeech');
    const pronunciation = /<Pronunciation\b[^>]*>([\s\S]*?)<\/Pronunciation>/.exec(body)?.[1];
    if (partOfSpeech) entry.partOfSpeech = partOfSpeech;
    if (pronunciation) entry.pronunciation = decodeXml(pronunciation);
    entries.push(entry);
  }
  return entries;
}
