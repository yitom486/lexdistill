import { stat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { isOk } from '@study-studio/shared';
import {
  mapPdfPages,
  MAX_MAP_PAGES,
  type PdfMapOutput,
} from '../modules/library/application/pdf-import/pdf-import-service.js';

/**
 * 本机私人教材结构预览探针（只读 opt-in）。
 * - 只认环境变量 STUDY_STUDIO_LIVE_PDF；未设置 → 打印用法并 exit 0（CI 安全，不碰磁盘）；
 * - 文件缺失/非法 → 友好错误，非 0 退出，不抛底层栈；
 * - 只调现有 mapPdfPages（窗口默认 ≤ MAX_MAP_PAGES=30），只打印摘要，不 dump 全文；
 * - 禁止 saveCanonicalAst、不写默认生产 study-studio.db（本脚本无任何写库代码）。
 * 验收剧本见 docs/pdf-live-corpus-playbook.md。
 */
export const LIVE_PDF_ENV = 'STUDY_STUDIO_LIVE_PDF';

export function usageText(): string {
  return [
    '用法：设置本机私人 PDF 绝对路径后运行结构预览（只读，不写库）：',
    `  $env:${LIVE_PDF_ENV} = '<本机 PDF 绝对路径>'`,
    '  bun src/scripts/live-corpus-map.ts   # 在 apps/gateway 下执行',
    `语料规则见 .cursor/rules/local-textbook-corpus.mdc；一次只看前 ${MAX_MAP_PAGES} 页窗口。`,
  ].join('\n');
}

export interface LiveMapResult {
  exitCode: number;
  output: string;
}

/** map 结果摘要（text + page；标题/目录过长截断列表，不 dump 全文 markdown）。 */
export function formatMapSummary(result: PdfMapOutput, target: string): string {
  const lines: string[] = [];
  lines.push(`库：${target}`);
  lines.push(`pageCount=${result.classification.pageCount} ocrPages=${result.classification.pagesNeedingOcr.length} window=[${result.window.join(',')}]`);
  const heads = result.headings.slice(0, 30);
  lines.push(`headings(${result.headings.length}):`);
  for (const h of heads) lines.push(`  p${h.page} ${h.text}`);
  if (result.headings.length > heads.length) lines.push(`  …等 ${result.headings.length - heads.length} 条`);
  const toc = result.tocEntries.slice(0, 50);
  lines.push(`toc(${result.tocEntries.length}):`);
  for (const e of toc) lines.push(`  ${e.lessonNo} -> p${e.printedPage}`);
  if (result.tocEntries.length > toc.length) lines.push(`  …等 ${result.tocEntries.length - toc.length} 条`);
  return lines.join('\n');
}

export async function runLiveCorpusMap(envValue: string | undefined): Promise<LiveMapResult> {
  const target = (envValue ?? '').trim();
  if (!target) return { exitCode: 0, output: usageText() };
  try {
    const st = await stat(target);
    if (!st.isFile()) return { exitCode: 2, output: `不是文件：${target}（请给本机 PDF 绝对路径）` };
  } catch {
    return { exitCode: 2, output: `找不到私人 PDF：${target}（请检查路径；本探针不读写其他位置）` };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(target));
  } catch {
    return { exitCode: 2, output: `私人 PDF 无权读取：${target}` };
  }
  try {
    const res = await mapPdfPages({}, { userId: 'live-probe', filename: basename(target), bytes });
    if (!isOk(res)) return { exitCode: 1, output: `结构预览失败：${res.error.userMessage}` };
    return { exitCode: 0, output: formatMapSummary(res.value, target) };
  } catch {
    return { exitCode: 1, output: '结构预览失败：PDF 解析运行时异常，请稍后重试' };
  }
}

if (import.meta.main) {
  const result = await runLiveCorpusMap(process.env[LIVE_PDF_ENV]);
  console.log(result.output);
  process.exitCode = result.exitCode;
}
