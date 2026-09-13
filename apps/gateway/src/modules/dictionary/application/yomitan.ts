import type { Database } from 'bun:sqlite';
import {
  BusinessError,
  err,
  ok,
  type Result,
  translateToBusinessError,
} from '@study-studio/shared';
import {
  backfillPitchPronunciation,
  insertEntries,
  listDictionaryPackages,
  recordDictionarySource,
  type DictionaryPackage,
  type DictionaryPackageManifest,
  type ParsedEntry,
} from './dictionary-packages.js';
import { extractZip } from '../../library/public.js';

/**
 * Yomitan 词典包导入（clean-room 实现，未复制 Yomitan GPL 代码）。
 *
 * 支持格式：Yomitan dictionary bank v3（index.json + term_bank_*.json +
 * term_meta_bank_*.json + kanji_bank_*.json + tag_bank_*.json，打包为 zip）。
 * - term bank 条目：[term, reading, definitionTags, rules, score, glossary, sequence, termTags]
 * - term meta bank 条目：[term, mode, data]，mode='pitch' 收声调，'freq' 收词频
 * - kanji bank 条目：[character, onyomi, kunyomi, tags, meanings]
 * glossary 支持 string / {type:'text'} / {type:'structured-content'}，image 类型跳过并计数。
 * 词条 id 在包内按 bank 序号 deterministic 生成，入库时再拼 sourceId 前缀。
 */

export interface YomitanIndex {
  title: string;
  format: number;
  revision: string;
  sequenced?: boolean;
}

export interface YomitanParseStats {
  terms: number;
  pitchMeta: number;
  freqMeta: number;
  kanji: number;
  mediaSkipped: number;
  dropped: number;
}

const MAX_GLOSSARY_MEANINGS = 4;

const CIRCLED_DIGITS = ['⓪', '①', '②', '③', '④', '⑤', '⑥'];

/** 声调位置 → 圈号标签（0=平板⓪；>⑥ 保留数字，不臆造圈号）。 */
export function pitchPositionsLabel(positions: unknown): string {
  if (!Array.isArray(positions) || positions.length === 0) return '？';
  return positions
    .map((p) => {
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return '？';
      return p <= 6 ? (CIRCLED_DIGITS[p] as string) : String(p);
    })
    .join('/');
}

/** Yomitan 词性 tag → 中文标签（高频子集；未收录回退原文。静态配置，见 STATIC 清单登记。） */
export const YOMITAN_POS_LABELS: Record<string, string> = {
  n: '名词',
  'adj-na': '形容动词',
  'adj-no': '连体词',
  'adj-i': '形容词',
  'adj-pn': '连体词',
  adv: '副词',
  conj: '接续词',
  interj: '感叹词',
  pn: '代词',
  prt: '助词',
  pref: '接头词',
  suf: '接尾词',
  exp: '惯用句',
  v1: '一段动词',
  'v1-s': '一段动词（特）',
  v5aru: '五段动词',
  v5b: '五段·バ行',
  v5g: '五段·ガ行',
  v5k: '五段·カ行',
  v5m: '五段·マ行',
  v5n: '五段·ナ行',
  v5r: '五段·ラ行',
  v5s: '五段·サ行',
  v5t: '五段·タ行',
  v5u: '五段·ウ行',
  vk: 'カ变动词',
  vs: 'サ变动词',
  'vs-s': 'サ变动词',
  vz: 'ザ变动词',
  vi: '自动词',
  vt: '他动词',
  aux: '助动词',
  'aux-v': '助动词',
  'aux-adj': '助动词（形容词型）',
  ctr: '量词',
  num: '数词',
  cop: '判断助动词',
};

function posLabel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return YOMITAN_POS_LABELS[t] ?? t;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** structured-content / text 节点拍平成纯文本；image 节点计数后跳过。 */
function flattenGlossaryNode(node: unknown, out: string[], skipped: { media: number }): void {
  if (typeof node === 'string') {
    const t = node.trim();
    if (t) out.push(t);
    return;
  }
  if (!isRecord(node)) return;
  const type = node['type'];
  if (type === 'text' && typeof node['text'] === 'string') {
    const t = (node['text'] as string).trim();
    if (t) out.push(t);
    return;
  }
  if (type === 'image') {
    skipped.media++;
    return;
  }
  if (type === 'structured-content' && Array.isArray(node['content'])) {
    for (const child of node['content'] as unknown[]) flattenGlossaryNode(child, out, skipped);
    return;
  }
  // 未知对象：尝试 content 数组
  if (Array.isArray(node['content'])) {
    for (const child of node['content'] as unknown[]) flattenGlossaryNode(child, out, skipped);
  }
}

function glossaryToMeanings(glossary: unknown, skipped: { media: number }): string[] {
  const out: string[] = [];
  if (!Array.isArray(glossary)) return out;
  for (const item of glossary) {
    flattenGlossaryNode(item, out, skipped);
    if (out.length >= MAX_GLOSSARY_MEANINGS) break;
  }
  return [...new Set(out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(
    0,
    MAX_GLOSSARY_MEANINGS
  );
}

type TermRow = {
  term: string;
  reading: string;
  tags: string;
  meanings: string[];
};

function parseTermBank(raw: unknown, skipped: { media: number }): TermRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: TermRow[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 6) continue;
    const [term, reading, , , , glossary] = entry as unknown[];
    if (typeof term !== 'string' || !term) continue;
    const meanings = glossaryToMeanings(glossary, skipped);
    if (meanings.length === 0) continue;
    rows.push({
      term,
      reading: typeof reading === 'string' ? reading : '',
      tags: typeof entry[7] === 'string' ? (entry[7] as string) : '',
      meanings,
    });
  }
  return rows;
}

type PitchMeta = { reading: string; pitches: unknown };
type FreqMeta = { reading: string; frequency: number };

/** 词频归一化：数字 / {reading, frequency} / 数字字符串；其余丢弃 */
function extractFrequency(data: unknown): FreqMeta | null {
  if (typeof data === 'number' && Number.isFinite(data)) {
    return { reading: '', frequency: data };
  }
  if (!isRecord(data)) return null;
  const reading = typeof data['reading'] === 'string' ? (data['reading'] as string) : '';
  const f = data['frequency'];
  if (typeof f === 'number' && Number.isFinite(f)) return { reading, frequency: f };
  if (typeof f === 'string' && f.trim() !== '' && Number.isFinite(Number(f))) {
    return { reading, frequency: Number(f) };
  }
  return null;
}

function parseTermMetaBank(
  raw: unknown
): { pitch: Map<string, PitchMeta[]>; freq: Map<string, FreqMeta[]>; freqCount: number } {
  const pitch = new Map<string, PitchMeta[]>();
  const freq = new Map<string, FreqMeta[]>();
  let freqCount = 0;
  if (!Array.isArray(raw)) return { pitch, freq, freqCount };
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [term, mode, data] = entry as unknown[];
    if (typeof term !== 'string' || !term) continue;
    if (mode === 'freq') {
      const parsed = extractFrequency(data);
      if (!parsed) continue;
      freqCount++;
      freq.set(term, [...(freq.get(term) ?? []), parsed]);
      continue;
    }
    if (mode !== 'pitch' || !isRecord(data)) continue;
    const reading = typeof data['reading'] === 'string' ? (data['reading'] as string) : '';
    const pitches = data['pitches'];
    if (!Array.isArray(pitches)) continue;
    const list = pitch.get(term) ?? [];
    list.push({ reading, pitches });
    pitch.set(term, list);
  }
  return { pitch, freq, freqCount };
}

type KanjiRow = { character: string; reading: string; meanings: string[] };

function parseKanjiBank(raw: unknown): KanjiRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: KanjiRow[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 5) continue;
    const [character, , kunyomi, , meanings] = entry as unknown[];
    if (typeof character !== 'string' || !character) continue;
    const list = Array.isArray(meanings)
      ? meanings.filter((m): m is string => typeof m === 'string' && Boolean(m.trim())).slice(0, 4)
      : [];
    if (list.length === 0) continue;
    const reading =
      typeof kunyomi === 'string'
        ? kunyomi.split(' ').filter(Boolean)[0] ?? ''
        : '';
    rows.push({ character, reading: reading ?? '', meanings: list });
  }
  return rows;
}

function parseIndex(raw: unknown): YomitanIndex | null {
  if (!isRecord(raw)) return null;
  const { title, format, revision } = raw as { title?: unknown; format?: unknown; revision?: unknown };
  if (typeof title !== 'string' || !title || typeof revision !== 'string') return null;
  // format 可能是数字 3 或字符串 '3'
  const formatNum = typeof format === 'number' ? format : Number(format);
  if (!Number.isFinite(formatNum)) return null;
  return { title, format: formatNum, revision };
}

export interface YomitanPitchRow {
  term: string;
  reading: string;
  /** 声调 JSON（无则 null；与词频同行共存） */
  pitchJson: string | null;
  /** 词频 JSON（无则 null） */
  freqJson: string | null;
  /** 词频数值（专供排序；无则 null） */
  freqValue: number | null;
}

export interface YomitanParsed {
  index: YomitanIndex;
  entries: ParsedEntry[];
  /** 声调覆盖行（meta-only 包如 Kanjium 即全靠它回填已有词条） */
  pitchRows: YomitanPitchRow[];
  stats: YomitanParseStats;
}

/** 解析 Yomitan 词典 zip 全量文件（index + 各 bank）。仅支持 format 3。 */
export function parseYomitanDictionary(
  files: Array<{ path: string; data: Uint8Array }>,
  entryIdPrefix: string
): YomitanParsed {
  const byName = new Map(files.map((f) => [f.path.split('/').pop() ?? f.path, f.data]));
  const indexRaw = byName.get('index.json');
  if (!indexRaw) {
    throw new BusinessError('E_DICTIONARY_PACKAGE_INVALID', 'Yomitan 包缺少 index.json', 'VALIDATION');
  }
  let indexJson: unknown;
  try {
    indexJson = JSON.parse(new TextDecoder().decode(indexRaw));
  } catch {
    throw new BusinessError('E_DICTIONARY_PACKAGE_INVALID', 'Yomitan 包 index.json 损坏', 'VALIDATION');
  }
  const index = parseIndex(indexJson);
  if (!index) {
    throw new BusinessError('E_DICTIONARY_PACKAGE_INVALID', 'Yomitan 包 index.json 缺少标题或版本', 'VALIDATION');
  }
  if (index.format !== 3) {
    throw new BusinessError(
      'E_DICTIONARY_PACKAGE_INVALID',
      `仅支持 Yomitan bank v3 格式（当前 format=${index.format}），请换 v3 包后重试`,
      'VALIDATION'
    );
  }

  const decodeBank = (name: string): unknown => {
    const data = byName.get(name);
    if (!data) return [];
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch {
      throw new BusinessError(
        'E_DICTIONARY_PACKAGE_INVALID',
        `Yomitan 包文件损坏：${name}`,
        'VALIDATION'
      );
    }
  };

  const termFiles = [...byName.keys()]
    .filter((n) => /^term_bank_\d+\.json$/.test(n))
    .sort();
  const metaFiles = [...byName.keys()]
    .filter((n) => /^term_meta_bank_\d+\.json$/.test(n))
    .sort();
  const kanjiFiles = [...byName.keys()]
    .filter((n) => /^kanji_bank_\d+\.json$/.test(n))
    .sort();

  const skipped = { media: 0 };
  const entries: ParsedEntry[] = [];
  const pitchByTerm = new Map<string, PitchMeta[]>();
  const freqByTerm = new Map<string, FreqMeta[]>();
  let freqCount = 0;

  for (const name of metaFiles) {
    const parsed = parseTermMetaBank(decodeBank(name));
    freqCount += parsed.freqCount;
    for (const [term, list] of parsed.pitch) {
      pitchByTerm.set(term, [...(pitchByTerm.get(term) ?? []), ...list]);
    }
    for (const [term, list] of parsed.freq) {
      freqByTerm.set(term, [...(freqByTerm.get(term) ?? []), ...list]);
    }
  }

  let bankIdx = 0;
  for (const name of termFiles) {
    const rows = parseTermBank(decodeBank(name), skipped);
    let rowIdx = 0;
    for (const row of rows) {
      const firstTag = row.tags.split(' ').filter(Boolean)[0];
      // 声调不内联：统一走 pitchRows + backfill（同一事务），保证 JSON 形状唯一
      entries.push({
        id: `${entryIdPrefix}-t${bankIdx}-${rowIdx}`,
        headword: row.term,
        ...(row.reading && row.reading !== row.term ? { reading: row.reading } : {}),
        ...(firstTag ? { partOfSpeech: posLabel(firstTag) ?? firstTag } : {}),
        meanings: row.meanings,
      });
      rowIdx++;
    }
    bankIdx++;
  }

  let kanjiCount = 0;
  for (const name of kanjiFiles) {
    for (const row of parseKanjiBank(decodeBank(name))) {
      entries.push({
        id: `${entryIdPrefix}-k${kanjiCount}`,
        headword: row.character,
        ...(row.reading ? { reading: row.reading } : {}),
        partOfSpeech: 'kanji',
        meanings: row.meanings,
      });
      kanjiCount++;
    }
  }

  // 元数据覆盖行：声调 + 词频按 (term, reading) 合并为一行
  // （同一读音多条取首个；不同 source 互不覆盖，PK 含 source_id）
  const pitchRows: YomitanPitchRow[] = [];
  const terms = new Set([...pitchByTerm.keys(), ...freqByTerm.keys()]);
  for (const term of terms) {
    const byReading = new Map<string, { pitch: PitchMeta[]; freq: FreqMeta[] }>();
    for (const p of pitchByTerm.get(term) ?? []) {
      const slot = byReading.get(p.reading) ?? { pitch: [], freq: [] };
      slot.pitch.push(p);
      byReading.set(p.reading, slot);
    }
    for (const f of freqByTerm.get(term) ?? []) {
      const slot = byReading.get(f.reading) ?? { pitch: [], freq: [] };
      slot.freq.push(f);
      byReading.set(f.reading, slot);
    }
    for (const [reading, slot] of byReading) {
      let pitchJson: string | null = null;
      for (const p of slot.pitch) {
        const positions = (Array.isArray(p.pitches) ? p.pitches : [])
          .map((item) =>
            typeof item === 'number'
              ? item
              : isRecord(item) && typeof item['position'] === 'number'
                ? (item['position'] as number)
                : null
          )
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0);
        if (positions.length > 0) {
          pitchJson = JSON.stringify({
            pitch: { reading: p.reading, positions, label: pitchPositionsLabel(positions) },
          });
          break;
        }
      }
      const freq = slot.freq[0];
      pitchRows.push({
        term,
        reading,
        pitchJson,
        freqJson: freq ? JSON.stringify({ reading: freq.reading, frequency: freq.frequency }) : null,
        freqValue: freq ? freq.frequency : null,
      });
    }
  }

  return {
    index,
    entries,
    pitchRows,
    stats: {
      terms: entries.length - kanjiCount,
      pitchMeta: [...pitchByTerm.values()].reduce((a, l) => a + l.length, 0),
      freqMeta: freqCount,
      kanji: kanjiCount,
      mediaSkipped: skipped.media,
      dropped: 0,
    },
  };
}

export interface YomitanInstallMeta {
  /** 包 id（catalog 条目或 yomitan-custom-<slug>） */
  id: string;
  language: 'en' | 'ja' | 'ko';
  provider: string;
  version: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  minEntryCount: number;
}

function buildManifest(meta: YomitanInstallMeta): DictionaryPackageManifest {
  return {
    id: meta.id,
    language: meta.language,
    provider: meta.provider,
    version: meta.version,
    sourceUrl: meta.sourceUrl,
    licenseName: meta.licenseName,
    licenseUrl: meta.licenseUrl,
    attribution: meta.attribution,
    description: `Yomitan bank v3 词典（${meta.provider}）。`,
    parser: 'yomitan-zip',
    minEntryCount: meta.minEntryCount,
    installerReady: true,
  };
}

/**
 * 声调覆盖层写入：同 source 全量替换（DELETE + INSERT），随后回填已有词条。
 * 与词条表分离存储，词条包后装也能通过“重装覆盖层/装包时自动回填”拿到声调。
 */
export function upsertPitchRows(
  sqlite: Database,
  manifest: DictionaryPackageManifest,
  rows: YomitanPitchRow[],
  now: string
): { pitchRows: number; backfilled: number } {
  sqlite.prepare('DELETE FROM dictionary_term_meta WHERE source_id = ?').run(manifest.id);
  const insert = sqlite.prepare(`
    INSERT OR REPLACE INTO dictionary_term_meta
      (term, reading, language, pitch_json, freq_json, freq_value, source_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.term,
      row.reading,
      manifest.language,
      row.pitchJson,
      row.freqJson,
      row.freqValue,
      manifest.id,
      now
    );
  }
  const backfilled = backfillPitchPronunciation(sqlite, manifest.language);
  return { pitchRows: rows.length, backfilled };
}

/**
 * catalog 流：由 sourceUrl 下载 zip 后安装（供 installDictionaryPackage 派发）。
 */
export async function installYomitanFromUrl(
  sqlite: Database,
  manifest: DictionaryPackageManifest,
  fetcher: typeof fetch = fetch
): Promise<Result<DictionaryPackage, BusinessError>> {
  try {
    const response = await fetcher(manifest.sourceUrl);
    if (!response.ok) {
      throw new BusinessError(
        'E_DICTIONARY_PACKAGE_INVALID',
        `${manifest.provider} 词典包下载失败（HTTP ${response.status}）`,
        'NETWORK'
      );
    }
    const zipBytes = new Uint8Array(await response.arrayBuffer());
    return installYomitanFromBytes(sqlite, manifestToMeta(manifest), zipBytes);
  } catch (error) {
    if (error instanceof BusinessError) return err(error);
    return err(
      translateToBusinessError(error, { category: 'NETWORK', action: 'installYomitanDictionary', entityId: manifest.id })
    );
  }
}

function manifestToMeta(manifest: DictionaryPackageManifest): YomitanInstallMeta {
  return {
    id: manifest.id,
    language: manifest.language,
    provider: manifest.provider,
    version: manifest.version,
    sourceUrl: manifest.sourceUrl,
    licenseName: manifest.licenseName,
    licenseUrl: manifest.licenseUrl,
    attribution: manifest.attribution,
    minEntryCount: manifest.minEntryCount,
  };
}

/** 自定义包 id：标题 slug（同一标题重复导入则覆盖同一行，符合事务替换语义）。 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'dict';
}

export interface YomitanCustomMeta {
  language: 'en' | 'ja' | 'ko';
  title?: string;
  version?: string;
  sourceUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  attribution?: string;
  minEntryCount?: number;
}

/** 由 zip 字节 + 用户声明元数据构造安装元数据（读 index.json 取标题/版本）。 */
export function buildCustomMeta(
  zipBytes: Uint8Array,
  custom: YomitanCustomMeta
): YomitanInstallMeta {
  let title = (custom.title ?? '').trim();
  let revision = (custom.version ?? '').trim() || 'custom';
  try {
    const files = extractZip(zipBytes).map((e) => ({ path: e.path, data: e.data }));
    const idxFile = files.find((f) => (f.path.split('/').pop() ?? f.path) === 'index.json');
    if (idxFile) {
      const parsed = parseIndex(JSON.parse(new TextDecoder().decode(idxFile.data)));
      if (parsed) {
        if (!title) title = parsed.title;
        if (!custom.version) revision = parsed.revision;
      }
    }
  } catch {
    // index 读取失败留给安装阶段报错，这里不拦
  }
  if (!title) title = '自备 Yomitan 词典';
  return {
    id: `yomitan-custom-${slugifyTitle(title)}`,
    language: custom.language,
    provider: title,
    version: revision,
    sourceUrl: custom.sourceUrl ?? 'local-file',
    licenseName: custom.licenseName ?? '用户自备（未验证）',
    licenseUrl: custom.licenseUrl ?? '',
    attribution: custom.attribution ?? `用户自备词典「${title}」，许可证未验证，请确认有权使用。`,
    minEntryCount: custom.minEntryCount ?? 1,
  };
}

/**
 * 由 zip 字节安装 Yomitan 词典（事务替换，失败不改库；与 installFromManifest 同语义）。
 * manifest 由调用方构造：catalog 条目走登记元数据，自定义文件走用户声明元数据。
 */
export async function installYomitanFromBytes(
  sqlite: Database,
  meta: YomitanInstallMeta,
  zipBytes: Uint8Array
): Promise<Result<DictionaryPackage, BusinessError>> {
  try {
    const manifest = buildManifest(meta);
    const files = extractZip(zipBytes).map((e) => ({ path: e.path, data: e.data }));
    const parsed = parseYomitanDictionary(files, 'yt');
    // 有效载荷：词条；纯 meta 包（Kanjium 类）按声调行计数
    const payloadCount = parsed.entries.length > 0 ? parsed.entries.length : parsed.pitchRows.length;
    if (payloadCount < manifest.minEntryCount) {
      return err(
        new BusinessError(
          'E_DICTIONARY_PACKAGE_INVALID',
          `${manifest.provider} 词典包内容不完整（仅 ${payloadCount} 条，预期至少 ${manifest.minEntryCount} 条），已取消安装，现有词典不会被修改。`,
          'VALIDATION'
        )
      );
    }
    const now = new Date().toISOString();
    sqlite.run('BEGIN IMMEDIATE');
    try {
      if (parsed.entries.length > 0) {
        insertEntries(sqlite, manifest, parsed.entries, now);
      } else {
        // meta-only 包：无词条可写，但来源行必须登记（否则装完查无此包）
        recordDictionarySource(sqlite, manifest, parsed.pitchRows.length, now);
      }
      if (parsed.pitchRows.length > 0) {
        upsertPitchRows(sqlite, manifest, parsed.pitchRows, now);
      }
      sqlite.run('COMMIT');
    } catch (error) {
      sqlite.run('ROLLBACK');
      throw error;
    }
    const known = listDictionaryPackages(sqlite).find((p) => p.id === manifest.id);
    if (known) return ok(known);
    return ok({
      id: manifest.id,
      language: manifest.language,
      provider: manifest.provider,
      version: manifest.version,
      sourceUrl: manifest.sourceUrl,
      licenseName: manifest.licenseName,
      licenseUrl: manifest.licenseUrl,
      attribution: manifest.attribution,
      description: manifest.description,
      installMode: 'on_demand',
      installed: true,
      installerReady: true,
      entryCount: payloadCount,
      installedAt: now,
    });
  } catch (error) {
    if (error instanceof BusinessError) return err(error);
    return err(
      translateToBusinessError(error, {
        category: 'NETWORK',
        action: 'installYomitanDictionary',
        entityId: meta.id,
      })
    );
  }
}
