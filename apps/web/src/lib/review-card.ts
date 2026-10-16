import type { StudyCardItem } from '../models/learning.js';
import type { CardSourceEntry } from '@lexdistill/learner-core';

/**
 * 复习卡 → 模板条目映射（纯函数，可单测）。
 * 复习页只换“内容区”渲染为模板 HTML，外层徽标/TTS/评分 chrome 不动；
 * 模板 HTML 经沙箱 iframe 呈现，不在此做清洗（iframe sandbox 即边界）。
 */
export function studyCardToSourceEntry(card: StudyCardItem): CardSourceEntry {
  const meanings = card.backMeaning.trim() ? [card.backMeaning.trim()] : [card.frontWord];
  const entry: CardSourceEntry = {
    headword: card.frontWord,
    meanings,
    tags: [card.tag, card.pos].map((t) => t.trim()).filter((t) => t.length > 0),
  };
  if (card.reading.trim()) entry.reading = card.reading.trim();
  if (card.pos.trim()) entry.partOfSpeech = card.pos.trim();
  if (card.exampleJp.trim()) entry.sentence = card.exampleJp.trim();
  return entry;
}

/** 模板正/背面 + CSS 组装为沙箱预览文档（与工作台预览同结构）。 */
export function buildReviewCardDoc(css: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"><div class="card">${bodyHtml}</div></body></html>`;
}
