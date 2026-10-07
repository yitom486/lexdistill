import type { BankMaterial, BankQuestionRecord, GenerationPaperDetail } from '@study-studio/protocol';

export interface StudentBankQuestion {
  id: string; language: BankQuestionRecord['language']; category: BankQuestionRecord['category'];
  targetLevel: BankQuestionRecord['targetLevel']; difficultyTier: number; prompt: string;
  skillIds: string[]; materialId: string | null;
  answer: StudentAnswer; material: StudentMaterial | null;
}

type StudentAnswer =
  | { type: 'MULTIPLE_CHOICE'; options: Array<{ key: string; text: string }> }
  | { type: 'FILL_BLANK' }
  | { type: 'REORDER'; chunks: string[] }
  | { type: 'SHORT_ANSWER' }
  | { type: 'TRANSLATION'; targetLanguage: string }
  | { type: 'WRITING'; minWords: number; maxWords: number };

type StudentMaterial =
  | { type: 'READING'; title: string; text: string }
  | { type: 'LISTENING'; title: string; mode: 'DIALOGUE' | 'PASSAGE' | 'NEWS'; withTranscript: false }
  | { type: 'LISTENING'; title: string; mode: 'DIALOGUE' | 'PASSAGE' | 'NEWS'; withTranscript: true; turns: Array<{ speaker: string; text: string }> };

function stripAnswer(record: BankQuestionRecord): StudentAnswer {
  switch (record.answer.type) {
    case 'MULTIPLE_CHOICE': return { type: 'MULTIPLE_CHOICE', options: record.answer.options.map(o => ({ key: o.key, text: o.text })) };
    case 'FILL_BLANK': return { type: 'FILL_BLANK' };
    case 'REORDER': return { type: 'REORDER', chunks: record.answer.chunks };
    case 'SHORT_ANSWER': return { type: 'SHORT_ANSWER' };
    case 'TRANSLATION': return { type: 'TRANSLATION', targetLanguage: record.answer.targetLanguage };
    case 'WRITING': return { type: 'WRITING', minWords: record.answer.minWords, maxWords: record.answer.maxWords };
  }
}

/**
 * 学生读口：隐藏标准答案、参考答案、解释、rubric 与未开放的听力全文。
 * 阅读材料正文保留（做题必需）；听力台词默认隐藏，按复盘阶段显式释放。
 */
export function toStudentQuestion(record: BankQuestionRecord, material: BankMaterial | null, input?: { releaseTranscript?: boolean }): StudentBankQuestion {
  let studentMaterial: StudentMaterial | null = null;
  if (material?.type === 'READING') studentMaterial = { type: 'READING', title: material.title, text: material.text };
  else if (material?.type === 'LISTENING') {
    if (input?.releaseTranscript) studentMaterial = { type: 'LISTENING', title: material.title, mode: material.mode, withTranscript: true, turns: material.turns.map(t => ({ speaker: t.speaker, text: t.text })) };
    else studentMaterial = { type: 'LISTENING', title: material.title, mode: material.mode, withTranscript: false };
  }
  return { id: record.id, language: record.language, category: record.category, targetLevel: record.targetLevel,
    difficultyTier: record.difficultyTier, prompt: record.prompt, skillIds: record.skillIds,
    materialId: record.materialId, answer: stripAnswer(record), material: studentMaterial };
}

export function toStudentPaper(paper: GenerationPaperDetail, input?: { releaseTranscript?: boolean }): { paperId: string; title: string; items: StudentBankQuestion[] } {
  return { paperId: paper.paperId, title: paper.title,
    items: paper.items.map(item => toStudentQuestion(item, item.material, input)) };
}

export interface ReviewPaperItem { id: string; reviewed: boolean; question: unknown }
/**
 * 复盘视图：仅对同一事实表中有判分记录的题目释放完整快照（答案/解释/听力全文），
 * 未作答题目保持学生视图。释放资格由后端按 quiz_attempts 判定，不接受客户端断言。
 */
export function toReviewPaper(paper: GenerationPaperDetail, answeredIds: ReadonlySet<string>): { paperId: string; title: string; items: ReviewPaperItem[] } {
  return { paperId: paper.paperId, title: paper.title,
    items: paper.items.map(item => answeredIds.has(item.id)
      ? { id: item.id, reviewed: true as const, question: { ...item, material: item.material } }
      : { id: item.id, reviewed: false as const, question: toStudentQuestion(item, item.material) }) };
}
