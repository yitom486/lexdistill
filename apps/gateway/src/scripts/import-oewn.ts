import { createDrizzleDb } from '@study-studio/storage-sqlite';
import {
  installOewnPackage,
  OEWN_2025_URL,
} from '../modules/dictionary/application/dictionary-packages.js';
import { parseOewnXml } from '@study-studio/lexicon';

export { parseOewnXml } from '@study-studio/lexicon';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const response = await fetch(OEWN_2025_URL);
  if (!response.ok) throw new Error(`OEWN download failed: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const entries = parseOewnXml(new TextDecoder().decode(Bun.gunzipSync(compressed)));
  if (entries.length < 100_000) {
    throw new Error(`OEWN parse produced only ${entries.length} entries; refusing to import incomplete data.`);
  }
  console.info(`Parsed ${entries.length} OEWN 2025 entries.`);
  if (!apply) {
    console.info('Dry run only. Re-run with --apply to replace the OEWN 2025 package in SQLite.');
    return;
  }

  const dbPath = process.env.STUDY_STUDIO_DB ?? 'study-studio.db';
  const { sqlite } = createDrizzleDb(dbPath);
  try {
    const result = await installOewnPackage(sqlite);
    if (!result.ok) throw new Error(result.error.userMessage);
    console.info(`Imported ${result.value.entryCount ?? entries.length} OEWN entries into ${dbPath}.`);
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
