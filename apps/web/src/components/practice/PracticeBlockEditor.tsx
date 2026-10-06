import React from 'react';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import type { PracticeBlockSpec, PracticeBlockKind, GradingMode } from '@study-studio/protocol';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select.js';
import { Slider } from '../ui/slider.js';
import { Button } from '../ui/button.js';
import { BLOCK_KINDS, BLOCK_KIND_LABELS, GRADING_MODES, GRADING_MODE_LABELS, TRANSLATION_LANG_OPTIONS, VOCAB_KINDS } from './practice-plan-editor-options.js';

interface BlockRowProps {
  block: PracticeBlockSpec;
  index: number;
  onUpdate: (patch: Partial<PracticeBlockSpec>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}

export function BlockRow({ block, index, onUpdate, onRemove, onUp, onDown }: BlockRowProps) {
  const isVocab = VOCAB_KINDS.has(block.kind);
  return (
    <div className="rounded-md border border-line-slate-200-slate-700 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-slate-500">第 {index + 1} 块 · {block.title ?? BLOCK_KIND_LABELS[block.kind]}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" title="上移" aria-label="上移练习块" onClick={onUp}><ArrowUp className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" title="下移" aria-label="下移练习块" onClick={onDown}><ArrowDown className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" title="移除" aria-label="移除练习块" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={block.kind} onValueChange={(v) => v && onUpdate({ kind: v as PracticeBlockKind, title: BLOCK_KIND_LABELS[v as PracticeBlockKind] })}>
          <SelectTrigger aria-label="练习类型" className="w-[8.5rem]"><SelectValue>{BLOCK_KIND_LABELS[block.kind]}</SelectValue></SelectTrigger>
          <SelectContent>
            {BLOCK_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{BLOCK_KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={block.gradingMode} onValueChange={(v) => v && onUpdate({ gradingMode: v as GradingMode })}>
          <SelectTrigger aria-label="批改方式" className="w-[8.5rem]"><SelectValue>{GRADING_MODE_LABELS[block.gradingMode]}</SelectValue></SelectTrigger>
          <SelectContent>
            {GRADING_MODES.map((g) => (
              <SelectItem key={g} value={g}>{GRADING_MODE_LABELS[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(block.difficulty ?? 3)}
          onValueChange={(v) => v && onUpdate({ difficulty: Number(v) })}
        >
          <SelectTrigger aria-label="题目难度" className="w-[6rem]"><SelectValue>难度 {block.difficulty ?? 3}</SelectValue></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((d) => (
              <SelectItem key={d} value={String(d)}>难度 {d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-ink-slate-500">题量 {block.count}</span>
        <Slider
          value={[block.count]}
          aria-label="题量"
          min={1}
          max={20}
          step={1}
          onValueChange={(val) => {
            const n = Array.isArray(val) ? val[0] : typeof val === 'number' ? val : undefined;
            if (typeof n === 'number') onUpdate({ count: n });
          }}
          className="flex-1"
        />
      </div>
      {isVocab && (
        <div className="mt-2">
          <Select
            value={block.vocabularySource ?? 'DUE_CARDS'}
            onValueChange={(v) => v && onUpdate({ vocabularySource: v as PracticeBlockSpec['vocabularySource'] })}
          >
            <SelectTrigger aria-label="词汇来源" className="w-[12rem]"><SelectValue>{block.vocabularySource === 'COLLECTED_WORDS' ? '已收集生词' : block.vocabularySource === 'TOPIC_WORDS' ? '指定主题新词' : '到期卡片'}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="DUE_CARDS">到期卡片</SelectItem>
              <SelectItem value="COLLECTED_WORDS">已收集生词</SelectItem>
              <SelectItem value="TOPIC_WORDS">指定主题新词</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {block.kind === 'TRANSLATION' && (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={block.translationDirection?.sourceLanguage ?? 'zh'}
            onValueChange={(v) =>
              v &&
              onUpdate({
                translationDirection: {
                  sourceLanguage: v,
                  targetLanguage: block.translationDirection?.targetLanguage ?? 'en',
                },
              })
            }
          >
            <SelectTrigger className="w-[7rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSLATION_LANG_OPTIONS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
              {TRANSLATION_LANG_OPTIONS.every((l) => l.value !== (block.translationDirection?.sourceLanguage ?? 'zh')) && (
                <SelectItem value={block.translationDirection?.sourceLanguage ?? 'zh'}>
                  {block.translationDirection?.sourceLanguage ?? 'zh'}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <span className="self-center text-ink-slate-400">→</span>
          <Select
            value={block.translationDirection?.targetLanguage ?? 'en'}
            onValueChange={(v) =>
              v &&
              onUpdate({
                translationDirection: {
                  sourceLanguage: block.translationDirection?.sourceLanguage ?? 'zh',
                  targetLanguage: v,
                },
              })
            }
          >
            <SelectTrigger className="w-[7rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSLATION_LANG_OPTIONS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
              {TRANSLATION_LANG_OPTIONS.every((l) => l.value !== (block.translationDirection?.targetLanguage ?? 'en')) && (
                <SelectItem value={block.translationDirection?.targetLanguage ?? 'en'}>
                  {block.translationDirection?.targetLanguage ?? 'en'}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
