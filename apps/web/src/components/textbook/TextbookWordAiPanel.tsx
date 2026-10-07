import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LessonContent } from '@study-studio/document-model';
import { WordTutorPanel } from '../WordTutorPanel.js';
import { QUERY_KEYS } from '../../queries/query-keys.js';

type TextbookWordRow = LessonContent['vocabularies'][number];

/** 教材行生成讲解指令：行 ID 进提示词，模型经 textbookVocabularyId 绑定到该课行（后端强制校验归属）。 */
function buildTextbookGeneratePrompt(row: TextbookWordRow): string {
  return `请讲透教材生词「${row.surface}」（${row.reading || '无读音'}，教材行ID ${row.id}）并保存讲解：先调用 vocabulary.learning.context（textbookVocabularyId 填 ${row.id}）读取本课依据与任务，再生成讲解并调用 vocabulary.learning.submit 提交保存。`;
}

/** 教材行内嵌 AI 面板：长在生词行下；保存后刷新词汇库与教材词表查询即时呈现。 */
export function TextbookWordAiPanel({ row }: { row: TextbookWordRow }) {
  const client = useQueryClient();
  const target = useMemo(() => ({
    word: row.surface,
    reading: row.reading ?? '',
    meaning: row.gloss ?? '',
    usage: [row.gloss, ...(row.examples ?? []).map(e => e.text)].filter((text): text is string => !!text).join('；'),
  }), [row]);
  const handleComplete = useCallback(() => {
    void client.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY });
    void client.invalidateQueries({ queryKey: QUERY_KEYS.WORDLISTS });
  }, [client]);
  return <WordTutorPanel
    target={target}
    generatePrompt={buildTextbookGeneratePrompt(row)}
    showGenerate
    ariaLabel={`AI 讲透：${row.surface}`}
    inputPlaceholder={`继续追问「${row.surface}」…`}
    onComplete={handleComplete}
  />;
}
