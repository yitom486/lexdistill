import type { HeadingCandidate } from '@study-studio/protocol';
import type { PdfInspectorLike } from './pdf-runtime.js';
import { layoutItemsToCandidates } from '@study-studio/document-ingest-pdf';
import type { LayoutStructRole, LayoutTextItem } from '@study-studio/document-ingest-pdf';

/**
 * M8-6：纯规则（layoutItemsToCandidates / mergeHeadingCandidates 与所需
 * 类型/helper）已迁入 `@study-studio/document-ingest-pdf`，本文件保留防御性
 * 采集运行时实现（collectLayoutCandidates：版式接口缺席/异常/空信号一律降级
 * 为空数组），并具名重导出 canonical 纯规则，既有消费者行为不变。
 */
export {
  layoutItemsToCandidates,
  mergeHeadingCandidates,
  type LayoutHeadingsOptions,
  type LayoutStructRole,
  type LayoutTextItem,
} from '@study-studio/document-ingest-pdf';

/**
 * 防御性采集：解析器有版式接口才跑；任何异常/无信号都返回空数组，
 * 调用方降级为纯正则候选（版式是加分项，不是必选项）。
 */
export function collectLayoutCandidates(
  inspector: PdfInspectorLike,
  pdf: Uint8Array,
  pages: number[]
): HeadingCandidate[] {
  try {
    if (typeof inspector.extractTextWithPositions !== 'function') return [];
    const raw: unknown = inspector.extractTextWithPositions(pdf, pages);
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const items: LayoutTextItem[] = [];
    for (const it of raw) {
      if (!it || typeof it !== 'object') continue;
      const r = it as Record<string, unknown>;
      if (
        typeof r.text !== 'string' ||
        typeof r.page !== 'number' ||
        typeof r.x !== 'number' ||
        typeof r.y !== 'number' ||
        typeof r.width !== 'number' ||
        typeof r.height !== 'number' ||
        typeof r.fontSize !== 'number' ||
        typeof r.isBold !== 'boolean'
      ) {
        continue;
      }
      items.push({
        text: r.text,
        page: Math.trunc(r.page),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        fontSize: r.fontSize,
        isBold: r.isBold,
        ...(typeof r.mcid === 'number' ? { mcid: Math.trunc(r.mcid) } : {}),
      });
    }
    if (items.length === 0) return [];
    let roles: LayoutStructRole[] = [];
    if (typeof inspector.extractStructureElements === 'function') {
      const rawRoles: unknown = inspector.extractStructureElements(pdf, pages);
      if (Array.isArray(rawRoles)) {
        for (const rr of rawRoles) {
          if (!rr || typeof rr !== 'object') continue;
          const q = rr as Record<string, unknown>;
          if (typeof q.page !== 'number' || typeof q.mcid !== 'number' || typeof q.role !== 'string') {
            continue;
          }
          roles.push({ page: Math.trunc(q.page), mcid: Math.trunc(q.mcid), role: q.role });
        }
      }
    }
    return layoutItemsToCandidates(items, roles);
  } catch {
    return [];
  }
}
