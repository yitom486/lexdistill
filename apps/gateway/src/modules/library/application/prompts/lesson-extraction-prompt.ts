import type { LessonExtractionJob } from '../lesson-batch-extractor.js';

export function buildLessonExtractionPrompt(job: LessonExtractionJob, assignmentId: string, toolName: string, correction?: string): string {
  return [
    `按本章目录整理当前章节，结合解析材料与所附原页纠正识别错误；区分原书内容与 AI 补充。调用 ${toolName} 提交。`,
    job.allowAiExercises ? '可按本章知识点补充练习，如实标注 AI 来源。' : '本次不新增 AI 练习，保留原书习题。',
    `documentId: ${job.documentId}\nlessonId: ${job.lessonId}\nassignmentId: ${assignmentId}\n语种: ${job.language}\n标题: ${job.title}`,
    `目录路径（所属单元与章）：\n${JSON.stringify(job.tocPath)}`,
    `本章目录:\n${JSON.stringify(job.tocEntries)}`,
    ...(correction ? [`上次未完成的原因：${correction}`] : []),
    job.source ? `章节解析材料:\n${JSON.stringify({ parser: job.source.parser, blocks: job.source.blocks.map(block => block.kind === 'TABLE' && block.rows?.length ? { id: block.id, page: block.page, kind: block.kind, ...(block.bbox ? { bbox: block.bbox } : {}), rows: block.rows } : block) })}` : `本章内容:\n${job.text}`,
  ].join('\n\n');
}
