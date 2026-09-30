import type { LessonExtractionJob } from '../lesson-batch-extractor.js';

export function buildLessonExtractionPrompt(job: LessonExtractionJob, assignmentId: string, toolName: string, correction?: string): string {
  return [
    `整理当前章节，纠正 OCR 错误；依据目录报告覆盖，区分原书内容与 AI 补充。调用 ${toolName} 提交。`,
    job.allowAiExercises ? '可按本章知识点补充练习，如实标注 AI 来源。' : '本次不新增 AI 练习，保留原书习题。',
    `documentId: ${job.documentId}\nlessonId: ${job.lessonId}\nassignmentId: ${assignmentId}\n语种: ${job.language}\n标题: ${job.title}`,
    `本章目录:\n${JSON.stringify(job.tocEntries.map(({ id, title, level, parentId }) => ({ id, title, level, parentId })))}`,
    ...(correction ? [`上次未完成的原因：${correction}`] : []),
    `本章内容:\n${job.ocrText}`,
  ].join('\n\n');
}
