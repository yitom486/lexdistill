import type { Database } from 'bun:sqlite';
import {
  STARTER_SOURCE_ID,
  STARTER_SOURCE_LABEL,
  STARTER_LICENSE,
  STARTER_WORD_SEEDS,
} from './starter-words-seed.js';
import {
  N5_SOURCE_ID,
  N5_SOURCE_LABEL,
  N5_LICENSE,
  N5_WORD_SEEDS,
} from './n5-words-seed.js';

// 透传基础 id（调用方统一从契约模块拿，不再直引各种子文件拼 id）。
export { STARTER_SOURCE_ID, N5_SOURCE_ID };

/**
 * 种子词典源命名/元数据契约（P0.5/R1-B）。
 * - 源行 id = `${base}-${language}`；词条 source_id 必须与源行 id 逐字相等；
 * - bootstrap（seed-bootstrap.ts）与 repair（repair-apply.ts）共用 ensure，
 *   不各自拼 id、不调用整个 seedInitialData() 做修复。
 */
export function seedSourceRowId(base: string, language: string): string {
  return `${base}-${language}`;
}

export interface SeedSourceSpec {
  rowId: string;
  language: string;
  entryIds: Set<string>;
  provider: string;
  version: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
}

function starterSpec(language: 'ja' | 'ko' | 'en'): SeedSourceSpec {
  return {
    rowId: seedSourceRowId(STARTER_SOURCE_ID, language),
    language,
    entryIds: new Set(
      STARTER_WORD_SEEDS.filter((w) => w.language === language).map((w) => w.id)
    ),
    provider: 'LexDistill',
    version: 'v1',
    sourceUrl: 'https://lexdistill.local/curriculum/starter-words',
    licenseName: STARTER_LICENSE,
    licenseUrl: 'https://lexdistill.local/licenses',
    attribution: 'LexDistill starter vocabulary with original Chinese glosses.',
  };
}

const n5Spec: SeedSourceSpec = {
  rowId: seedSourceRowId(N5_SOURCE_ID, 'ja'),
  language: 'ja',
  entryIds: new Set(N5_WORD_SEEDS.map((w) => w.id)),
  provider: 'LexDistill',
  version: 'v1',
  sourceUrl: 'https://lexdistill.local/curriculum/n5-words',
  licenseName: N5_LICENSE,
  licenseUrl: 'https://lexdistill.local/licenses',
  attribution: 'LexDistill N5 core vocabulary with original Chinese glosses.',
};

export function seedSourceSpecs(): SeedSourceSpec[] {
  return [starterSpec('ja'), starterSpec('ko'), starterSpec('en'), n5Spec];
}

/**
 * 幂等确保 4 个种子源行存在（INSERT OR IGNORE；entry_count 取种子数组长度）。
 * 只动源行，不碰词条；老库/新库通用。
 */
export function ensureSeedDictionarySources(
  sqlite: Database,
  now: string = new Date().toISOString()
): { ensured: string[] } {
  const ensured: string[] = [];
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO dictionary_sources (
      id, language, provider, version, source_url, license_name, license_url, attribution, entry_count, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const spec of seedSourceSpecs()) {
    stmt.run(
      spec.rowId,
      spec.language,
      spec.provider,
      spec.version,
      spec.sourceUrl,
      spec.licenseName,
      spec.licenseUrl,
      spec.attribution,
      spec.entryIds.size,
      now
    );
    ensured.push(spec.rowId);
  }
  return { ensured };
}

/**
 * 种子词条 id 白名单（repair 仅允许更新这些 id 的 source_id，第三方不动）。
 * 返回 entryId → 应有 source 行 id。
 */
export function seedEntrySourceMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const spec of seedSourceSpecs()) {
    for (const id of spec.entryIds) map.set(id, spec.rowId);
  }
  return map;
}
