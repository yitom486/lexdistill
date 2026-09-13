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
} from './dictionary-packages.js';
import { extractZip } from '../../library/public.js';
import {
  parseIndex,
  parseYomitanDictionary,
  slugifyTitle,
  type YomitanPitchRow,
} from '@study-studio/dictionary-integrations';

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
