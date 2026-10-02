import type { LessonExtractionJob } from '../lesson-batch-extractor.js';

export function buildLessonExtractionPrompt(job: LessonExtractionJob, toolNames: readonly string[], correction?: string): string {
  return [
    '根据本章实际内容整理可直接学习的材料，视情况选择知识点、词汇、练习、文章、句子或整理材料；有则提交，无则省略，不为凑齐类别生成内容。课内小标题仅作参考。讲解与例句按各自字段填写，文章和会话保留完整语境。',
    `可用工具：${toolNames.join('、')}。可多次新增、查询、修改和删除；只填写内容，修改或删除使用工具回执的本任务短引用，不填写数据库 ID 或页码。`,
    job.allowAiExercises ? '可按本章知识点补充练习，如实标注 AI 来源。' : '本次不新增 AI 练习，保留原书习题。',
    `语种: ${job.language}\n章节: ${job.title}`,
    `本课标题结构（仅供内容参考，不需逐项对应）：\n${job.tocEntries.map(entry => {
      let depth = 0;
      let parentId = entry.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = job.tocEntries.find(node => node.id === parentId);
        if (!parent) break;
        depth++; parentId = parent.parentId;
      }
      return `${'  '.repeat(depth)}- ${entry.title}`;
    }).join('\n')}`,
    ...(job.tocPath.length
      ? [`本节位置（仅定位参考，不需逐项对应）：${job.tocPath.map(entry => entry.title).join(' > ')}`]
      : []),
    ...(correction ? [`上次未完成的原因：${correction}`] : []),
    ...(job.source?.parser === 'local-ocr' ? ['以下材料来自逐页本地 OCR，可能有错字、注音混入或词表断行。结合本课语境整理，不把页码或编号猜成音调；无法确认的音调省略。'] : []),
    job.source ? `章节材料:\n${JSON.stringify(job.source.blocks.map(block => ({ kind: block.kind, ...(block.text && !block.rows?.length ? { text: block.text } : {}), ...(block.rows?.length ? { rows: block.rows } : {}) })))}` : `本章内容:\n${job.text}`,
  ].join('\n\n');
}
