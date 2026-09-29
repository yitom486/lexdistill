import React, { useState, useEffect } from 'react';
import { Volume2, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { Button } from '../ui/button.js';
import { speechStudio } from '../../utils/audio.js';
import type { GeneratedQuestion } from '@study-studio/protocol';

/** 单题渲染器：按题型呈现；客观题即时判定由父组件处理；主观题按 gradingMode 分流。 */

type GradingMode = 'AUTO_IMMEDIATE' | 'AI_IMMEDIATE' | 'AI_BATCH';
type RunnerLanguage = 'en' | 'ja' | 'ko';

interface RendererProps {
  question: GeneratedQuestion;
  userAnswer: string;
  language?: RunnerLanguage | undefined;
  gradingMode?: GradingMode | undefined;
  onAnswerChange: (v: string) => void;
  onSubmitObjective: (answer: string) => void;
  /** P5-E5：AI_IMMEDIATE 主观题单题提交（提交后立即批改） */
  onSubmitSubjective?: ((answer: string) => void) | undefined;
  onSaveDraft: (answer: string) => void;
  disabled: boolean;
  busy: boolean;
  submittingSubjective?: boolean | undefined;
}

const TTS_LANG: Record<RunnerLanguage, 'EN' | 'JA' | 'KO'> = {
  en: 'EN',
  ja: 'JA',
  ko: 'KO',
};

export function QuestionRenderer({
  question: q,
  userAnswer,
  language = 'en',
  gradingMode = 'AUTO_IMMEDIATE',
  onAnswerChange,
  onSubmitObjective,
  onSubmitSubjective,
  onSaveDraft,
  disabled,
  busy,
  submittingSubjective,
}: RendererProps) {
  const [answer, setAnswer] = useState(userAnswer);
  useEffect(() => setAnswer(userAnswer), [userAnswer]);

  const update = (v: string) => {
    setAnswer(v);
    onAnswerChange(v);
  };

  if (q.type === 'MULTIPLE_CHOICE' && q.options) {
    return (
      <div className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const key = String.fromCharCode(65 + i);
          const selected = answer === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => update(key)}
              disabled={disabled}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${ selected ? 'border-ink-indigo-500 bg-tint-indigo-50 dark:bg-tint-indigo-950' : 'border-line-slate-200-slate-700 hover:border-line-indigo-300' }`}
            >
              <span className="mr-2 font-semibold">{key}.</span>
              {opt}
            </button>
          );
        })}
        <Button size="sm" className="mt-1 w-fit" disabled={!answer || disabled || busy} onClick={() => onSubmitObjective(answer)}>
          提交
        </Button>
      </div>
    );
  }

  if (q.type === 'FILL_IN_BLANK') {
    return (
      <div className="flex flex-col gap-2">
        <input
          value={answer}
          onChange={(e) => update(e.target.value)}
          disabled={disabled}
          placeholder="填入答案"
          className="rounded-md border border-line-slate-300 px-3 py-2 text-sm dark:border-ink-slate-600 transition-colors"
        />
        <Button size="sm" className="w-fit" disabled={!answer.trim() || disabled || busy} onClick={() => onSubmitObjective(answer)}>
          提交
        </Button>
      </div>
    );
  }

  if (q.type === 'SENTENCE_REORDER') {
    const chunks = q.content.split(/\s+/).filter(Boolean);
    const [picked, setPicked] = useState<string[]>([]);
    const toggle = (c: string) => {
      const next = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
      setPicked(next);
      update(next.join(' '));
    };
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {chunks.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              onClick={() => toggle(c)}
              disabled={disabled}
              className={`rounded-md border px-2 py-1 text-sm transition-colors ${ picked.includes(c) ? 'border-ink-indigo-500 bg-tint-indigo-50 dark:bg-tint-indigo-950' : 'border-line-slate-200-slate-700' }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="text-sm text-ink-slate-600-slate-300">当前顺序：{answer || '（点击上方词块排序）'}</div>
        <Button size="sm" className="w-fit" disabled={!answer.trim() || disabled || busy} onClick={() => onSubmitObjective(answer)}>
          提交
        </Button>
      </div>
    );
  }

  if (q.type === 'LISTENING_DICTATION') {
    return (
      <DictationSubjective
        question={q}
        language={language}
        gradingMode={gradingMode}
        answer={answer}
        onChange={update}
        onSubmitSubjective={onSubmitSubjective}
        onSaveDraft={onSaveDraft}
        disabled={disabled}
        submittingSubjective={submittingSubjective}
      />
    );
  }

  const readingPanel = q.reading ? <ReadingPassagePanel reading={q.reading} /> : null;

  if (q.type === 'MULTIPLE_CHOICE' && q.options) {
    return (
      <div className="flex flex-col gap-2">
        {readingPanel}
        {q.options.map((opt, i) => {
          const key = String.fromCharCode(65 + i);
          const selected = answer === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => update(key)}
              disabled={disabled}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${ selected ? 'border-ink-indigo-500 bg-tint-indigo-50 dark:bg-tint-indigo-950' : 'border-line-slate-200-slate-700 hover:border-line-indigo-300' }`}
            >
              <span className="mr-2 font-semibold">{key}.</span>
              {opt}
            </button>
          );
        })}
        <Button size="sm" className="mt-1 w-fit" disabled={!answer || disabled || busy} onClick={() => onSubmitObjective(answer)}>
          提交
        </Button>
      </div>
    );
  }
  const immediate = gradingMode === 'AI_IMMEDIATE' && Boolean(onSubmitSubjective);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={answer}
        onChange={(e) => update(e.target.value)}
        disabled={disabled}
        onBlur={() => answer.trim() && onSaveDraft(answer)}
        placeholder={q.type === 'TRANSLATION' ? '输入译文' : '输入写作内容'}
        rows={4}
        className="rounded-md border border-line-slate-300 px-3 py-2 text-sm dark:border-ink-slate-600 transition-colors"
      />
      {immediate ? (
        <>
          <Button
            size="sm"
            className="w-fit"
            disabled={!answer.trim() || disabled || submittingSubjective}
            onClick={() => onSubmitSubjective?.(answer)}
          >
            {submittingSubjective ? '批改中…' : '提交并即时批改'}
          </Button>
          <div className="text-xs text-ink-slate-500">提交后立即批改并写回错题信号；输入失焦自动保存草稿。</div>
        </>
      ) : (
        <div className="text-xs text-ink-slate-500">主观题在“批量提交主观题”时统一评测；输入失焦自动保存草稿。</div>
      )}
    </div>
  );
}

/** P5-E9：阅读题可折叠篇目面板（正文随题携带，展开即读，避免整页双栏抢占）。 */
function ReadingPassagePanel({ reading }: { reading: NonNullable<GeneratedQuestion['reading']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line-sky-500o25 bg-wash-sky-500o5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-ink-sky-800-sky-300 cursor-pointer"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <BookOpen className="h-3.5 w-3.5" />
        <span className="truncate flex-1">篇目 · {reading.title}</span>
        <span className="text-[10px] text-ink-sky-600o70-sky-400o70">{open ? '收起' : '展开阅读'}</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-line-sky-500o20 px-3 py-2.5 text-sm leading-relaxed text-ink-slate-700-slate-300">
          {reading.body}
        </div>
      )}
    </div>
  );
}

/** P5-E5：听写题——TTS 播放语料（不剧透正文，正文在 Runner 隐藏），按批改模式提交。 */
function DictationSubjective({
  question: q,
  language,
  gradingMode,
  answer,
  onChange,
  onSubmitSubjective,
  onSaveDraft,
  disabled,
  submittingSubjective,
}: {
  question: GeneratedQuestion;
  language: RunnerLanguage;
  gradingMode: GradingMode;
  answer: string;
  onChange: (v: string) => void;
  onSubmitSubjective?: ((answer: string) => void) | undefined;
  onSaveDraft: (answer: string) => void;
  disabled: boolean;
  submittingSubjective?: boolean | undefined;
}) {
  const [playing, setPlaying] = useState(false);

  // P5-E8：优先朗读完整原句（dictation.fullJapanese），无语料时退回挖空展示句
  const speakText = q.dictation?.fullJapanese || q.content;

  const play = () => {
    setPlaying(true);
    void speechStudio.speak(speakText, {
      lang: TTS_LANG[language],
      purpose: 'dictation',
      onEnd: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  };

  const immediate = gradingMode === 'AI_IMMEDIATE' && Boolean(onSubmitSubjective);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={play} disabled={playing}>
          <Volume2 className="mr-1 h-3.5 w-3.5" />
          {playing ? '播放中…' : '播放 / 重听音频'}
        </Button>
        <span className="text-xs text-ink-slate-500">听音频后写出空缺内容；答案不会以文字剧透。</span>
      </div>
      {q.dictation?.furiganaHint && (
        <div className="text-[11px] text-ink-slate-400">提示：{q.dictation.furiganaHint}</div>
      )}
      <textarea
        value={answer}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onBlur={() => answer.trim() && onSaveDraft(answer)}
        placeholder="输入你听到的句子或空缺词"
        rows={3}
        className="rounded-md border border-line-slate-300 px-3 py-2 text-sm dark:border-ink-slate-600 transition-colors"
      />
      {immediate ? (
        <Button
          size="sm"
          className="w-fit"
          disabled={!answer.trim() || disabled || submittingSubjective}
          onClick={() => onSubmitSubjective?.(answer)}
        >
          {submittingSubjective ? '批改中…' : '提交并即时批改'}
        </Button>
      ) : (
        <div className="text-xs text-ink-slate-500">听写题在“批量提交主观题”时统一评测。</div>
      )}
    </div>
  );
}
