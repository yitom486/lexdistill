import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Loader2, Sparkles, Wrench } from 'lucide-react';
import { BorderBeam } from './magicui/index.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.js';
import { readCssDurationMilliseconds, readCssDurationSeconds } from '../lib/css-tokens.js';
import {
  formatToolArguments,
  type ToolCallTrace,
} from '../lib/chat-transcript.js';

interface ChatTurnActivityProps {
  streaming: boolean;
  reasoning?: string;
  effortLabel: string;
  toolCalls?: ToolCallTrace[];
}

function ToolCallCard({
  call,
  defaultOpen,
}: {
  call: ToolCallTrace;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
    else setOpen(false);
  }, [defaultOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`relative overflow-hidden rounded-xl border px-2.5 py-1.5 ${
        call.status === 'running'
          ? 'border-tone-sky-500o40 bg-wash-sky-500o10'
          : 'border-line bg-surface-stone-100-stone-900'
      }`}
    >
      {call.status === 'running' ? (
        <BorderBeam
          size={90}
          duration="var(--motion-border-beam-agent-tool-duration)"
          colorFrom="var(--visual-agent-beam-from)"
          colorTo="var(--visual-agent-beam-to)"
        />
      ) : null}
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
        {call.status === 'running' ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-ink-sky-900-sky-200" />
        ) : (
          <Wrench className="size-3 shrink-0 text-ink-ghost" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
          {call.toolName}
        </span>
        <span className="shrink-0 text-[10px] text-ink-ghost">
          {call.status === 'running' ? '调用中' : '已完成'}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-ink-ghost transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-stone-100-stone-900 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-ink-soft">
          {formatToolArguments(call.arguments)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChatTurnActivity({
  streaming,
  reasoning,
  effortLabel,
  toolCalls = [],
}: ChatTurnActivityProps) {
  const hasReasoning = Boolean(reasoning?.trim());
  const hasTools = toolCalls.length > 0;
  const hasActivity = hasReasoning || hasTools;
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  if (!hasActivity) return null;

  const summary = [
    hasReasoning ? '思考' : null,
    hasTools ? `${toolCalls.length} 个工具` : streaming && !hasTools ? '生成中' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className="space-y-1.5">
      {hasReasoning ? (
        <div className="rounded-xl border border-line-violet-500o25 bg-wash-violet-500o8 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-ink-violet-900-violet-200">
            <Sparkles className="size-3" />
            思考 · {effortLabel}
            {streaming ? (
              <span className="ml-auto inline-flex gap-0.5">
                <span className="size-1 animate-bounce rounded-full bg-tint-violet-300 [animation-delay:var(--motion-chat-tool-dot-delay-first)]" />
                <span className="size-1 animate-bounce rounded-full bg-tint-violet-300 [animation-delay:var(--motion-chat-tool-dot-delay-second)]" />
                <span className="size-1 animate-bounce rounded-full bg-tint-violet-300" />
              </span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-soft">
            {reasoning}
          </p>
        </div>
      ) : null}
      {toolCalls.map((call) => (
        <ToolCallCard key={call.id} call={call} defaultOpen={streaming} />
      ))}
    </div>
  );

  if (streaming) {
    return <div className="mb-2 space-y-1.5">{body}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-[11px] text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink">
        <ChevronDown
          className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <Sparkles className="size-3 text-ink-violet-900-violet-200" />
        <span className="min-w-0 truncate">{summary || '思考与工具'}</span>
        <span className="ml-auto shrink-0 text-[10px] text-ink-ghost">
          {open ? '收起' : '查看过程'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">{body}</CollapsibleContent>
    </Collapsible>
  );
}

const STREAMING_HINTS = [
  '正在等待回复',
  '正在整理思路',
  '马上开始书写',
  '仍在生成中',
] as const;

export function StreamingReplyPlaceholder() {
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHintIndex((i) => (i + 1) % STREAMING_HINTS.length);
    }, readCssDurationMilliseconds('--motion-reply-hint-rotation-interval'));
    return () => window.clearInterval(timer);
  }, []);

  const hint = STREAMING_HINTS[hintIndex] ?? STREAMING_HINTS[0];
  const hintFadeDuration = readCssDurationSeconds('--motion-reply-hint-fade-duration');
  const replyCharStagger = readCssDurationMilliseconds('--motion-reply-char-stagger');

  return (
    <p
      className="flex items-center overflow-visible py-0.5 text-[12px] leading-6 text-ink-ghost"
      aria-live="polite"
      aria-busy="true"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={hint}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: hintFadeDuration }}
          className="inline-flex"
        >
          {Array.from(hint).map((ch, i) => (
            <span
              key={`${hint}-${i}`}
              className="animate-reply-char"
              style={{ animationDelay: `${i * replyCharStagger}ms` }}
            >
              {ch}
            </span>
          ))}
        </motion.span>
      </AnimatePresence>
    </p>
  );
}
