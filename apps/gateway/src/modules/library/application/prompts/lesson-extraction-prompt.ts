import type { LessonExtractionJob } from '../lesson-batch-extractor.js';

export function buildLessonExtractionPrompt(job: LessonExtractionJob, toolNames: readonly string[], correction?: string): string {
  return [
    '把本章教材整理为可直接学习的知识点、词汇、文章、句子和练习。有哪类内容就调用对应工具，不要求五类齐全。知识点按规则与例句分开，文章和会话保留完整语境，AI 补充讲解单独填写。',
    `可用工具：${toolNames.join('、')}。每次可保存多个同类条目。只填写内容，不填写系统身份或页码。`,
    job.allowAiExercises ? '可按本章知识点补充练习，如实标注 AI 来源。' : '本次不新增 AI 练习，保留原书习题。',
    `语种: ${job.language}\n章节: ${job.title}`,
    ...(correction ? [`上次未完成的原因：${correction}`] : []),
    job.source ? `章节材料:\n${JSON.stringify(job.source.blocks.map(block => ({ kind: block.kind, ...(block.text && !block.rows?.length ? { text: block.text } : {}), ...(block.rows?.length ? { rows: block.rows } : {}) })))}` : `本章内容:\n${job.text}`,
  ].join('\n\n');
}
