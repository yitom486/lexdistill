import { createHash } from 'node:crypto';
import { BusinessError, err, generateId, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import { canonicalizeTocEntries, type SaveTextbookOutlineRequest, type SaveTextbookOutlineResult } from '@lexdistill/document-model';
import type { ContentRepository } from '../ports.js';
import { readLocalPdfFile } from './pdf-import/local-file.js';
import { findTextbookByFingerprint } from './textbook-inspector.js';
import { ImportMonitor } from './import-monitor.js';

/** 独立保存已确认目录，不启动 OCR 或模型会话。 */
export async function saveTextbookOutline(
  repo: ContentRepository, userId: string, input: SaveTextbookOutlineRequest,
): Promise<Result<SaveTextbookOutlineResult, BusinessError>> {
  try {
    const file = await readLocalPdfFile(input.filePath);
    if (!file.ok) return file;
    const sourceFingerprint = createHash('sha256').update(file.value.bytes).digest('hex');
    const docs = await repo.listDocuments(userId);
    if (!docs.ok) return docs;
    const existing = findTextbookByFingerprint(docs.value, sourceFingerprint);
    const documentId = existing?.id ?? input.documentId ?? generateId();
    const slots = await repo.listTextbookLessonSlots(documentId);
    if (!slots.ok) return slots;
    // 再识别会生成新草稿 ID；同一本书、同标题和物理页的条目仍使用已保存身份。
    const savedEntries = slots.value.flatMap(slot => slot.tocEntries ?? [{ id: slot.lessonId, title: slot.title, startPage: slot.startPage }]);
    const ids = new Map(input.tocEntries.map(entry => [entry.id, savedEntries.find(saved =>
      saved.title === entry.title.trim() && saved.startPage === entry.startPage,
    )?.id ?? entry.id]));
    const entries = input.tocEntries.map(entry => ({
      ...entry, id: ids.get(entry.id)!,
      ...(entry.parentId ? { parentId: ids.get(entry.parentId) ?? entry.parentId } : {}),
    }));
    if (slots.value.some(slot => slot.status === 'ready' && !entries.some(entry => entry.id === slot.lessonId))) {
      return err(new BusinessError('E_TOC_SLOT_CONFLICT', '新目录缺少已有正文的课次，请核对目录，避免删除已保存内容', 'VALIDATION'));
    }
    const saved = await repo.seedTextbookTocSkeleton({
      documentId, userId, title: input.title, language: input.language,
      sourceFingerprint, entries, forceOverwrite: false,
    });
    if (!saved.ok) return saved;
    if (input.traceId) {
      const monitor = new ImportMonitor(repo, userId, input.traceId, { documentId });
      monitor.record('directory', 'confirmed_saved', { entries: canonicalizeTocEntries(entries), receipt: saved.value });
      await monitor.flush();
    }
    return ok({ ...saved.value, entries: canonicalizeTocEntries(entries) });
  } catch (cause) {
    return err(translateToBusinessError(cause, { category: 'DATABASE', action: 'saveTextbookOutline' }));
  }
}
