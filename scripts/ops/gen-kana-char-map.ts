import { KANA_SEEDS } from '../../packages/storage-sqlite/src/seeds/kana-seed.js';
import { writeFile } from 'node:fs/promises';

const map: Record<string, string> = {};
for (const k of KANA_SEEDS) {
  for (const key of [k.hiragana, k.katakana, k.audioText]) {
    if (key && !map[key]) map[key] = k.id;
  }
}
const header = [
  '/**',
  ' * 假名字符 → 种子 id（由种子表生成）。',
  ' * 种子变更时重跑：bun scripts/ops/gen-kana-char-map.ts',
  ' */',
].join('\n');
await writeFile(
  new URL('../../apps/web/src/lib/kana-char-map.ts', import.meta.url),
  `${header}\nexport const KANA_CHAR_TO_ID: Record<string, string> = ${JSON.stringify(map, null, 2)};\n`,
);
console.log(`entries=${Object.keys(map).length}`);
