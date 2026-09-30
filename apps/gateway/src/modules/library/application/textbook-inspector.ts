import { createHash } from 'node:crypto';
import { ok, err, isOk, type Result, BusinessError, translateToBusinessError } from '@study-studio/shared';
import { TextbookASTSchema } from '@study-studio/document-model';
import type { DocumentItem, TextbookInspectionDocSummary, TextbookInspectionResult } from '@study-studio/protocol';
import type { ContentRepository } from '../ports.js';
import { readLocalPdfFile } from './pdf-import/local-file.js';

export interface TextbookInspectionInput {
  userId: string;
  filename: string;
  filePath: string;
}

export function findTextbookByFingerprint(docs: readonly DocumentItem[], fingerprint: string) {
  return docs.find(doc => {
    if (!doc.astJson) return false;
    try {
      const ast = TextbookASTSchema.safeParse(JSON.parse(doc.astJson));
      return ast.success && ast.data.sourceFingerprint === fingerprint;
    } catch { return false; }
  });
}

/** 只按当前 PDF 的文件指纹匹配；内容与进度读取实际数据库记录。 */
export async function inspectTextbookImport(
  repo: ContentRepository,
  input: TextbookInspectionInput
): Promise<Result<TextbookInspectionResult, BusinessError>> {
  if (!input.userId?.trim() || !input.filename?.trim() || !input.filePath?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '请先选择本地 PDF 教材', 'VALIDATION'));
  }
  try {
    const file = await readLocalPdfFile(input.filePath);
    if (!file.ok) return file;
    const fingerprint = createHash('sha256').update(file.value.bytes).digest('hex');
    const docs = await repo.listDocuments(input.userId);
    if (!docs.ok) return docs;
    const doc = findTextbookByFingerprint(docs.value, fingerprint);
    if (doc) {
      const ast = TextbookASTSchema.safeParse(JSON.parse(doc.astJson!));
      if (!ast.success) return err(new BusinessError('E_INSPECT_FAILED', '教材目录数据不完整，请重新检测', 'DATABASE'));
      const stats = await repo.getTextbookAssetStats(doc.id);
      if (!isOk(stats)) return stats;
      const matched: TextbookInspectionDocSummary = {
        documentId: doc.id, title: doc.title, displayTitle: doc.title, sourceKind: doc.sourceKind,
        lessonCount: stats.value.lessons, readyLessonCount: stats.value.readyLessons,
        lineCount: stats.value.lines, vocabCount: stats.value.vocab, grammarCount: stats.value.grammar,
        exerciseCount: stats.value.exercises, updatedAt: doc.updatedAt,
        hasShreddedAssets: stats.value.passageLessons > 0 || stats.value.vocab > 0 || stats.value.grammar > 0 || stats.value.exercises > 0,
        matchKind: 'file', outlineConfirmed: ast.data.outlineConfirmed === true,
        passageLessonCount: stats.value.passageLessons, lessonDetails: stats.value.lessonDetails,
      };
      const ready = matched.outlineConfirmed && matched.lessonCount > 0 && matched.readyLessonCount === matched.lessonCount;
      return ok({
        status: ready ? 'ready' : 'partial', canDirectlyUse: matched.hasShreddedAssets,
        matchedDocument: matched,
        summary: matched.outlineConfirmed && !matched.hasShreddedAssets
          ? `《${matched.title}》的目录已保存，共 ${matched.lessonCount} 个提取部分；正文尚未提取。`
          : `已导入《${matched.title}》：${matched.readyLessonCount}/${matched.lessonCount} 个部分就绪，${matched.passageLessonCount} 个部分有正文、${matched.vocabCount} 个生词、${matched.grammarCount} 项语法、${matched.exerciseCount} 道习题。`,
      });
    }
    return ok({ status: 'not_imported', canDirectlyUse: false, summary: '这份 PDF 尚未导入。' });
  } catch (cause) {
    return err(translateToBusinessError(cause, { category: 'DATABASE', action: 'inspectTextbookImport' }));
  }
}
