import { lessonContentFieldIssues, type LessonContent, type ChapterSourceBlock, type TocEntry } from '@study-studio/document-model';

export interface LessonValidationIssue {
  code: string;
  path: string;
  message: string;
  expected?: unknown;
  received?: unknown;
}
/** 已通过结构校验才进入这里；汇总可检查问题，不推断正文语义正确性。 */
export function validateLessonContent(content: LessonContent, task: {
  tocEntries: readonly TocEntry[]; sourceBlocks?: readonly ChapterSourceBlock[]; allowAiExercises: boolean;
}, initial: LessonValidationIssue[] = []): LessonValidationIssue[] {
  const issues = [...initial];
  const items: Array<{ item: Pick<LessonContent['blocks'][number], 'source' | 'tocId' | 'sourceRefs'>; path: string }> = (['blocks', 'vocabularies', 'knowledgePoints', 'exercises'] as const).flatMap(collection =>
    content[collection].map((item, index) => ({ item, path: `content.${collection}.${index}` })));
  for (const collection of ['vocabularies', 'knowledgePoints'] as const) {
    content[collection].forEach((item, index) => item.examples.forEach((example, position) => items.push({ item: example, path: `content.${collection}.${index}.examples.${position}` })));
  }
  const ids = new Set(task.tocEntries.map(entry => entry.id));
  for (const { item, path } of [...items, ...content.coverage.map((item, index) => ({ item, path: `content.coverage.${index}` }))]) {
    if (!item.tocId || !ids.has(item.tocId)) issues.push({ code: item.tocId ? 'E_TOC_SLOT_NOT_FOUND' : 'E_LLM_SCHEMA_INVALID', path: `${path}.tocId`, message: '必须关联当前目录 ID', expected: [...ids], received: item.tocId ?? null });
  }
  if (task.sourceBlocks) {
    const blocks = new Map(task.sourceBlocks.map(block => [block.id, block]));
    for (const { item, path } of items) {
      if (item.source === 'TEXTBOOK' && !item.sourceRefs?.length && !initial.some(issue => issue.path.startsWith(`${path}.sourceRefs`))) {
        issues.push({ code: 'E_SOURCE_REFERENCE_INVALID', path: `${path}.sourceRefs`, message: '原书内容必须引用当前材料块', expected: [...blocks.keys()] });
      }
      item.sourceRefs?.forEach((ref, index) => {
        const block = blocks.get(ref.blockId);
        if (!block || block.page !== ref.page || (ref.row !== undefined && (block.kind !== 'TABLE' || !block.rows || ref.row >= block.rows.length))) {
          issues.push({ code: 'E_SOURCE_REFERENCE_INVALID', path: `${path}.sourceRefs.${index}`, message: '来源引用不属于当前章节材料或表格行无效', received: ref,
            expected: block ? { blockId: block.id, page: block.page, rowCount: block.rows?.length ?? 0 } : [...blocks.keys()] });
        }
      });
    }
  }
  const reported = new Map(content.coverage.map(item => [item.tocId, item.status]));
  for (const entry of task.tocEntries) {
    if (reported.get(entry.id) !== 'EXTRACTED') issues.push({ code: 'E_TOC_COVERAGE_INCOMPLETE', path: 'content.coverage', message: '当前部分或子目录未逐项提取；无法辨认的内容不能标记已完成', expected: { tocId: entry.id, title: entry.title, status: 'EXTRACTED' }, received: reported.get(entry.id) ?? null });
    if ((entry.level === 'lesson' || entry.level === 'section') && !items.some(({ item }) => item.source === 'TEXTBOOK' && item.tocId === entry.id)) {
      issues.push({ code: 'E_TOC_COVERAGE_INCOMPLETE', path: 'content', message: '目录没有关联的原书内容', expected: { tocId: entry.id, title: entry.title, source: 'TEXTBOOK' } });
    }
  }
  if (!items.some(({ item }) => item.source === 'TEXTBOOK')) issues.push({ code: 'E_TOC_COVERAGE_INCOMPLETE', path: 'content', message: '章节只有 AI 新增内容，不能据此声明原书已提取' });
  content.exercises.forEach((item, index) => {
    if (!task.allowAiExercises && item.source === 'AI') issues.push({ code: 'E_LLM_SCHEMA_INVALID', path: `content.exercises.${index}.source`, message: '当前配置不允许新增 AI 习题', expected: 'TEXTBOOK', received: item.source });
  });
  issues.push(...lessonContentFieldIssues(content).map(issue => ({ ...issue, code: 'E_LLM_SCHEMA_INVALID', path: issue.path.replace('.knowledgePointIds', '.knowledgePointIndexes') })));
  return issues;
}
