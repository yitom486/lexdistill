import type { Database } from 'bun:sqlite';
import {
  BusinessError,
  err,
  ok,
  type Result,
  translateToBusinessError,
} from '@study-studio/shared';
import {
  parseOewnXml,
  type ParsedEntry,
} from '@study-studio/dictionary-integrations';

// ---------------------------------------------------------------------------
// P3-A：词典包 manifest/catalog（受类型约束的包元数据目录）
// 每个包声明来源、版本、许可证、署名与解析器种类；安装按 id 派发到对应安装器。
// 包本体不随应用预装，状态只以 SQLite 的 dictionary_sources 记录为准。
// ---------------------------------------------------------------------------

export const OEWN_2025_URL = 'https://en-word.net/static/english-wordnet-2025.xml.gz';
export const OEWN_2025_SOURCE_ID = 'oewn-2025';
export const JMDICT_E_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';
export const JMDICT_E_SOURCE_ID = 'jmdict-e';
export const KENGDIC_URL =
  'https://raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv';
export const KENGDIC_SOURCE_ID = 'kengdic-2021';
export const KANJIUM_PITCH_URL =
  'https://raw.githubusercontent.com/yomidevs/yomitan/dictionaries/kanjium_pitch_accents.zip';
export const KANJIUM_PITCH_SOURCE_ID = 'kanjium-pitch';

/** 解析器种类：决定 installDictionaryPackage 调用哪个安装器 */
export type DictionaryPackageParser = 'oewn-xml' | 'jmdict-xml' | 'kengdic-tsv' | 'yomitan-zip';

/** 受类型约束的包元数据 manifest */
export interface DictionaryPackageManifest {
  id: string;
  language: 'en' | 'ja' | 'ko';
  provider: string;
  version: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  description: string;
  parser: DictionaryPackageParser;
  /** 最小条目数校验：低于此值视为包损坏，取消安装 */
  minEntryCount: number;
  /** 是否已实现安装器；false 时仅 manifest 登记，install 返回友好错误 */
  installerReady: boolean;
}

/** 词典包目录：所有可安装包的权威 manifest 列表 */
export const DICTIONARY_PACKAGE_CATALOG: DictionaryPackageManifest[] = [
  {
    id: OEWN_2025_SOURCE_ID,
    language: 'en',
    provider: 'Open English WordNet',
    version: '2025',
    sourceUrl: OEWN_2025_URL,
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Contains data from Open English WordNet 2025 (CC BY 4.0) and Princeton WordNet; attribution is required.',
    description: '通用英语离线释义词典。安装后词条保存在本机 SQLite，可离线检索。',
    parser: 'oewn-xml',
    minEntryCount: 100_000,
    installerReady: true,
  },
  {
    id: JMDICT_E_SOURCE_ID,
    language: 'ja',
    provider: 'JMdict/EDICT (EDRDG, Jim Breen)',
    version: 'daily',
    sourceUrl: JMDICT_E_URL,
    licenseName: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution:
      'Contains data from JMdict/EDICT (CC BY-SA 4.0), © James William Breen and the EDRDG. See https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
    description:
      '日语-英语离线词典（EDRDG JMdict_e legacy 稳定版）。安装后词条保存在本机 SQLite，可离线检索；汉字表记可查，假名读音同步可检索。',
    parser: 'jmdict-xml',
    minEntryCount: 100_000,
    installerReady: true,
  },
  {
    id: KENGDIC_SOURCE_ID,
    language: 'ko',
    provider: 'Kengdic (Joe Speigle, maintained by garfieldnate)',
    version: '2021.9.20',
    sourceUrl: KENGDIC_URL,
    licenseName: 'CC BY-SA 3.0 / LGPL 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/legalcode',
    attribution:
      'Contains data from Kengdic by Joe Speigle (CC BY-SA 3.0 / LGPL 2.0), maintained by garfieldnate. See https://github.com/garfieldnate/kengdic',
    description: '韩语-英语离线词典（约 9 万词条）。安装后词条保存在本机 SQLite，可离线检索。',
    parser: 'kengdic-tsv',
    minEntryCount: 50_000,
    installerReady: true,
  },
  {
    id: KANJIUM_PITCH_SOURCE_ID,
    language: 'ja',
    provider: 'Kanjium 声调（Uros Ozvatic，经 Yomitan 打包）',
    version: 'pitch1',
    sourceUrl: KANJIUM_PITCH_URL,
    licenseName: '上游声明（Kanjium）',
    licenseUrl: 'https://github.com/mifunetoshiro/kanjium',
    attribution:
      '声调数据来自 Kanjium（Uros Ozvatic），经 Yomitan bank v3 打包；以声调覆盖层形式回填已有日语词条，不新增无释义词条。',
    description: '日语声调覆盖层（约 12 万条读音声调）。安装后已装词条自动带声调；后装词条自动回填。',
    parser: 'yomitan-zip',
    minEntryCount: 100_000,
    installerReady: true,
  },
];

export type DictionaryPackage = {
  id: string;
  language: 'en' | 'ja' | 'ko';
  provider: string;
  version: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  description: string;
  installMode: 'on_demand';
  installed: boolean;
  /** 解析器是否已实现（未实现时仅可查看元数据，不可安装） */
  installerReady: boolean;
  entryCount?: number | undefined;
  installedAt?: string | undefined;
  /** 用户开关（默认启用）；排序权重（越大越前，默认 0） */
  enabled?: boolean | undefined;
  priority?: number | undefined;
};



type InstalledSourceRow = {
  id: string;
  entry_count: number;
  imported_at: string;
  enabled: number | null;
  priority: number | null;
};

type Fetcher = typeof fetch;

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

async function loadOewnXml(fetcher: Fetcher): Promise<string> {
  const response = await fetcher(OEWN_2025_URL);
  if (!response.ok) throw new Error(`OEWN download failed: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder().decode(Bun.gunzipSync(compressed));
}

// ---------------------------------------------------------------------------
// Kengdic（韩语）解析器
// ---------------------------------------------------------------------------

export interface KengdicRow {
  id: number;
  surface: string;
  hanja: string;
  gloss: string;
  level: string;
  created: string;
  source: string;
}

/**
 * 将 Kengdic TSV（制表符分隔，列：id/surface/hanja/gloss/level/created/source）
 * 解析为可导入的扁平词条。空 surface 或空 gloss 的行跳过。
 */
export function parseKengdicTsv(tsv: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const lines = tsv.split(/\r?\n/);
  let headerSkipped = false;
  for (const line of lines) {
    if (!line) continue;
    if (!headerSkipped) {
      const firstCell = line.split('\t')[0];
      headerSkipped = true;
      if (firstCell === 'id') continue;
    }
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    const surface = cols[1]?.trim();
    const gloss = cols[3]?.trim();
    if (!surface || !gloss) continue;
    // gloss 可能含多条释义（以 ';' 或 '；' 分隔），拆分并去重
    const meanings = gloss
      .split(/[;；]/)
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (meanings.length === 0) continue;
    entries.push({
      id: `kengdic-${cols[0]}`,
      headword: surface,
      meanings,
    });
  }
  return entries;
}

async function loadKengdicTsv(fetcher: Fetcher): Promise<string> {
  const response = await fetcher(KENGDIC_URL);
  if (!response.ok) throw new Error(`Kengdic download failed: HTTP ${response.status}`);
  return new TextDecoder().decode(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// JMdict（日语）解析器：EDRDG JMdict_e legacy 版（entry/k_ele/r_ele/sense 结构）
// NG 版（lsrc/全新 schema）不在此解析器覆盖范围，见 DICTIONARY-SOURCING-REPORT。
// ---------------------------------------------------------------------------

/**
 * JMdict 词性实体 → 可读英文标签（高频子集；未收录实体回退为去 &; 后的原始名）。
 * 静态配置表：见 STATIC-DATA-INVENTORY 登记（P1 配置保留）。
 */
export const JMDICT_POS_LABELS: Record<string, string> = {
  n: 'noun',
  'adj-na': 'adjectival noun',
  'adj-no': 'pre-noun adjectival',
  'adj-i': 'i-adjective',
  'adj-pn': 'pre-noun adjectival (prenominal)',
  'adj-t': 'tari adjective',
  adv: 'adverb',
  'adv-to': 'adverb taking the to particle',
  aux: 'auxiliary',
  'aux-v': 'auxiliary verb',
  'aux-adj': 'auxiliary adjective',
  conj: 'conjunction',
  cop: 'copula',
  ctr: 'counter',
  exp: 'expression',
  int: 'interjection',
  'n-adv': 'adverbial noun',
  'n-suf': 'noun suffix',
  'n-pref': 'noun prefix',
  'n-t': 'noun (temporal)',
  num: 'numeric',
  pn: 'pronoun',
  pref: 'prefix',
  prt: 'particle',
  suf: 'suffix',
  unc: 'unclassified',
  v1: 'ichidan verb',
  'v1-s': 'ichidan verb (kureru special)',
  v5aru: 'godan verb (aru special)',
  v5b: 'godan verb (bu ending)',
  v5g: 'godan verb (gu ending)',
  v5k: 'godan verb (ku ending)',
  v5m: 'godan verb (mu ending)',
  v5n: 'godan verb (nu ending)',
  v5r: 'godan verb (ru ending)',
  v5s: 'godan verb (su ending)',
  v5t: 'godan verb (tsu ending)',
  v5u: 'godan verb (u ending)',
  vi: 'intransitive verb',
  vk: 'kuru verb (special)',
  vn: 'irregular nu verb',
  vs: 'suru verb (noun+する)',
  'vs-c': 'su verb (precursor to modern suru)',
  'vs-i': 'suru verb (included)',
  'vs-s': 'suru verb (special)',
  vt: 'transitive verb',
};

function jmdictPosLabel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.replace(/^&/, '').replace(/;$/, '');
  return JMDICT_POS_LABELS[name] ?? name;
}

/**
 * 将 JMdict_e XML 解析为可导入的扁平词条。
 * - headword 取首 keb（汉字表记），无 keb 时取首 reb（假名表记）；
 * - reading 取首 reb（与 headword 相同时置空，避免重复）；
 * - 仅收英文 gloss（无 xml:lang 或 xml:lang="en"/"eng"），聚合全部 sense，上限 4 条；
 * - partOfSpeech 取首 sense 的首个 pos 映射标签；
 * - 无 headword 或无英文释义的 entry 跳过。
 */
export function parseJmdictXml(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1]!;
    const entSeq = /<ent_seq>(\d+)<\/ent_seq>/.exec(body)?.[1];
    if (!entSeq) continue;

    const keb = /<k_ele>[\s\S]*?<keb>([\s\S]*?)<\/keb>/.exec(body)?.[1];
    const reb = /<r_ele>[\s\S]*?<reb>([\s\S]*?)<\/reb>/.exec(body)?.[1];
    const headword = keb ? decodeXml(keb) : reb ? decodeXml(reb) : undefined;
    if (!headword) continue;

    const meanings: string[] = [];
    let partOfSpeech: string | undefined;
    for (const senseMatch of body.matchAll(/<sense>([\s\S]*?)<\/sense>/g)) {
      const sense = senseMatch[1]!;
      if (!partOfSpeech) {
        const posRaw = /<pos>([^<]*)<\/pos>/.exec(sense)?.[1];
        if (posRaw) partOfSpeech = jmdictPosLabel(decodeXml(posRaw));
      }
      for (const glossMatch of sense.matchAll(/<gloss\b([^>]*)>([\s\S]*?)<\/gloss>/g)) {
        const lang = readAttribute(glossMatch[1]!, 'xml:lang')?.toLowerCase();
        if (lang && lang !== 'en' && lang !== 'eng') continue;
        const gloss = decodeXml(glossMatch[2]!);
        if (gloss && !meanings.includes(gloss)) meanings.push(gloss);
        if (meanings.length >= 4) break;
      }
      if (meanings.length >= 4) break;
    }
    if (meanings.length === 0) continue;

    const reading = reb ? decodeXml(reb) : undefined;
    entries.push({
      id: `jmdict-${entSeq}`,
      headword,
      ...(reading && reading !== headword ? { reading } : {}),
      ...(partOfSpeech ? { partOfSpeech } : {}),
      meanings,
    });
  }
  return entries;
}

async function loadJmdictXml(fetcher: Fetcher): Promise<string> {
  const response = await fetcher(JMDICT_E_URL);
  if (!response.ok) throw new Error(`JMdict download failed: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder().decode(Bun.gunzipSync(compressed));
}

// ---------------------------------------------------------------------------
// 通用安装：事务替换，失败不改库
// ---------------------------------------------------------------------------

export function insertEntries(
  sqlite: Database,
  manifest: DictionaryPackageManifest,
  entries: ParsedEntry[],
  now: string
): void {
  sqlite
    .prepare('DELETE FROM local_dictionary_entries WHERE source_id = ?')
    .run(manifest.id);
  const insert = sqlite.prepare(`
    INSERT INTO local_dictionary_entries (
      id, language, headword, reading, romanization, meanings_json,
      pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const entry of entries) {
    insert.run(
      `${manifest.id}:${entry.id}`,
      manifest.language,
      entry.headword,
      entry.reading ?? null,
      JSON.stringify(entry.meanings),
      entry.pronunciation ? JSON.stringify({ ipa: entry.pronunciation }) : null,
      entry.partOfSpeech ?? null,
      manifest.id,
      `${manifest.provider} ${manifest.version}`,
      `${manifest.licenseName}. ${manifest.attribution}`,
      now
    );
  }
  recordDictionarySource(sqlite, manifest, entries.length, now);
  // 词条入库后自动回填已安装的声调覆盖层（同一事务；无覆盖层时为 no-op）
  backfillPitchPronunciation(sqlite, manifest.language);
}

/**
 * 仅登记来源行（meta-only 包：无词条可写，但来源/数量必须可追溯）。
 * 调用方负责事务。
 */
export function recordDictionarySource(
  sqlite: Database,
  manifest: DictionaryPackageManifest,
  entryCount: number,
  now: string
): void {
  sqlite.prepare('DELETE FROM dictionary_sources WHERE id = ?').run(manifest.id);
  sqlite.prepare(`
    INSERT INTO dictionary_sources (
      id, language, provider, version, source_url, license_name, license_url, attribution, entry_count, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    manifest.id,
    manifest.language,
    manifest.provider,
    manifest.version,
    manifest.sourceUrl,
    manifest.licenseName,
    manifest.licenseUrl,
    manifest.attribution,
    entryCount,
    now
  );
}

/**
 * 声调回填：把 dictionary_term_meta 的声调写到尚无发音的词条 pronunciation_json。
 * 匹配规则（不猜）：词条读音非空时必须与 meta 读音一致；词条无读音时按“meta 读音 = 词面”匹配
 *（假名 luc词）；其余一律跳过。返回回填条数。
 */
export function backfillPitchPronunciation(sqlite: Database, language: string): number {
  const result = sqlite
    .prepare(
      `
      UPDATE local_dictionary_entries AS e SET pronunciation_json = (
        SELECT m.pitch_json FROM dictionary_term_meta AS m
        WHERE m.term = e.headword
          AND m.language = e.language
          AND m.reading = COALESCE(NULLIF(e.reading, ''), e.headword)
        LIMIT 1
      )
      WHERE e.language = ?
        AND (e.pronunciation_json IS NULL OR e.pronunciation_json = '')
        AND EXISTS (
          SELECT 1 FROM dictionary_term_meta AS m
          WHERE m.term = e.headword
            AND m.language = e.language
            AND m.reading = COALESCE(NULLIF(e.reading, ''), e.headword)
        )
      `
    )
    .run(language);
  return Number(result.changes ?? 0);
}

async function installFromManifest(
  sqlite: Database,
  manifest: DictionaryPackageManifest,
  fetcher: Fetcher,
  load: () => Promise<string>,
  parse: (raw: string) => ParsedEntry[]
): Promise<Result<DictionaryPackage, BusinessError>> {
  try {
    const raw = await load();
    const entries = parse(raw);
    if (entries.length < manifest.minEntryCount) {
      return err(
        new BusinessError(
          'E_DICTIONARY_PACKAGE_INVALID',
          `${manifest.provider} 词典包内容不完整（仅 ${entries.length} 条，预期至少 ${manifest.minEntryCount} 条），已取消安装，现有词典不会被修改。`,
          'VALIDATION'
        )
      );
    }

    const now = new Date().toISOString();
    sqlite.run('BEGIN IMMEDIATE');
    try {
      insertEntries(sqlite, manifest, entries, now);
      sqlite.run('COMMIT');
    } catch (error) {
      sqlite.run('ROLLBACK');
      throw error;
    }

    return ok(listDictionaryPackages(sqlite).find((p) => p.id === manifest.id)!);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'NETWORK',
        action: 'installDictionaryPackage',
        entityId: manifest.id,
      })
    );
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 列出可安装词典包；包本体不预装，状态只以 SQLite 的 dictionary_sources 为准。 */
export function listDictionaryPackages(sqlite: Database): DictionaryPackage[] {
  const installedRows = sqlite
    .query<InstalledSourceRow, []>(
      'SELECT id, entry_count, imported_at, enabled, priority FROM dictionary_sources'
    )
    .all();
  const installedMap = new Map(installedRows.map((r) => [r.id, r]));
  return DICTIONARY_PACKAGE_CATALOG.map((manifest) => {
    const installed = installedMap.get(manifest.id);
    const pkg: DictionaryPackage = {
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
      installed: Boolean(installed),
      installerReady: manifest.installerReady,
    };
    if (installed) {
      pkg.entryCount = installed.entry_count;
      pkg.installedAt = installed.imported_at;
      pkg.enabled = (installed.enabled ?? 1) !== 0;
      pkg.priority = installed.priority ?? 0;
    }
    return pkg;
  });
}

/** 下载并以单个 SQLite 事务替换指定词典包。下载失败或解析不完整时不写入部分数据。 */
export async function installDictionaryPackage(
  sqlite: Database,
  packageId: string,
  fetcher: Fetcher = fetch
): Promise<Result<DictionaryPackage, BusinessError>> {
  const manifest = DICTIONARY_PACKAGE_CATALOG.find((m) => m.id === packageId);
  if (!manifest) {
    return err(new BusinessError('E_NOT_FOUND', '请求的词典包不存在。', 'VALIDATION'));
  }
  if (!manifest.installerReady) {
    return err(
      new BusinessError(
        'E_DICTIONARY_PACKAGE_INSTALLER_NOT_READY',
        `词典包「${manifest.provider}」已登记元数据，但解析器尚在实现中，暂不可安装。请等待后续版本。`,
        'VALIDATION'
      )
    );
  }
  if (manifest.parser === 'oewn-xml') {
    return installFromManifest(sqlite, manifest, fetcher, () => loadOewnXml(fetcher), parseOewnXml);
  }
  if (manifest.parser === 'kengdic-tsv') {
    return installFromManifest(sqlite, manifest, fetcher, () => loadKengdicTsv(fetcher), parseKengdicTsv);
  }
  if (manifest.parser === 'jmdict-xml') {
    return installFromManifest(sqlite, manifest, fetcher, () => loadJmdictXml(fetcher), parseJmdictXml);
  }
  if (manifest.parser === 'yomitan-zip') {
    // 动态导入避免与 yomitan.ts 的静态循环（yomitan 单向静态依赖本模块）。
    const { installYomitanFromUrl } = await import('./yomitan.js');
    return installYomitanFromUrl(sqlite, manifest, fetcher);
  }
  return err(
    new BusinessError('E_UNSUPPORTED', `解析器「${manifest.parser}」尚未实现。`, 'AGENT_RUNTIME')
  );
}

/** 兼容旧 API：直接安装 OEWN 包。 */
export async function installOewnPackage(
  sqlite: Database,
  fetcher: Fetcher = fetch
): Promise<Result<DictionaryPackage, BusinessError>> {
  return installDictionaryPackage(sqlite, OEWN_2025_SOURCE_ID, fetcher);
}

