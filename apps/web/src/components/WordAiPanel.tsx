import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { VocabularyEntry } from '@study-studio/protocol';
import { WordTutorPanel } from './WordTutorPanel.js';
import { QUERY_KEYS } from '../queries/query-keys.js';
import { getWordUsageList } from '../queries/vocabulary.js';

/** 生成讲解固定指令：关键词确保本轮可见 context＋submit；任务绑定由后端强制。 */
function buildGeneratePrompt(word: VocabularyEntry): string {
  return `请为「${word.word}」（${word.reading || '无读音'}）生成AI讲解并保存讲解：先调用 vocabulary.learning.context 读取词汇依据与任务，再按要求生成讲解内容并调用 vocabulary.learning.submit 提交保存。`;
}

/** 单词内嵌 AI 面板：对话直接长在详情里；模型工具写入后由调用方刷新查询即时呈现。 */
export function WordAiPanel({ word }: { word: VocabularyEntry }) {
  const client = useQueryClient();
  const usage = useMemo(() => getWordUsageList(word.sources).join('；'), [word]);
  const presets = useMemo(() => [`「${word.word}」在日常生活中到底该怎么用？`, `这个词有哪些最常用的搭配？`, `它和相近词有什么区别？`], [word.word]);
  const handleComplete = useCallback(() => { void client.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY }); }, [client]);
  return <WordTutorPanel
    target={{ word: word.word, reading: word.reading, meaning: word.meaning, usage }}
    generatePrompt={buildGeneratePrompt(word)}
    showGenerate={!word.learning}
    ariaLabel={`AI 追问：${word.word}`}
    inputPlaceholder="继续追问这个词…"
    presets={presets}
    onComplete={handleComplete}
  />;
}
