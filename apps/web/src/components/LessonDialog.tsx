import React, { useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, CheckCircle2, Volume2, Zap, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { sound } from '../utils/audio.js';
import { useLessonStore } from '../stores/useLessonStore.js';
import { useLessonsQuery, useCompleteLessonMutation, type LessonItem } from '../queries/lessons.js';
import { useGenerateAdaptiveQuizMutation } from '../queries/useAgentMutations.js';
import { usePrependQuestionMutation } from '../queries/useLearnerQueries.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { toUiQuizType } from '@study-studio/protocol';
import type { QuizQuestionItem } from '../models/learning.js';

/**
 * 语法讲义弹窗（先讲后测的学习端）：
 * - 列表模式（openSkill=null）：NEED_LESSON 指路进来，先选一篇学；
 * - 阅读模式：讲解 → 例句（跟读）→ 易错 → 学完打卡 → 课内小测（显式考点出题，不受锁限制）。
 */
export function LessonDialog() {
  const open = useLessonStore((s) => s.open);
  const openSkill = useLessonStore((s) => s.openSkill);
  const closeLesson = useLessonStore((s) => s.closeLesson);
  const openLesson = useLessonStore((s) => s.openLesson);
  const { data: lessons = [], isLoading } = useLessonsQuery();
  const complete = useCompleteLessonMutation();
  const generateAdaptive = useGenerateAdaptiveQuizMutation();
  const prependQuestion = usePrependQuestionMutation();
  const isGatewayConnected = useGatewayStore((s) => s.isConnected);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);
  const [quizzing, setQuizzing] = useState(false);

  const active: LessonItem | undefined = openSkill
    ? lessons.find((l) => l.skillId === openSkill)
    : undefined;

  // 课内小测：显式点名考点（用户明确意图，不受讲义锁限制），题目推进公共题库后切 QUIZ。
  const startLessonQuiz = async (lesson: LessonItem) => {
    if (!isGatewayConnected) {
      toast.error('网关未连接，先连上再出题');
      return;
    }
    sound.playClick();
    setQuizzing(true);
    try {
      const reply = (await generateAdaptive.mutateAsync({
        weaknessSkillId: lesson.skillId,
        count: 2,
      })) as { questions?: Array<Record<string, unknown>> };
      const raw = reply?.questions?.[0] as Record<string, unknown> | undefined;
      if (!raw) {
        toast.error('出题失败，请重试');
        return;
      }
      const rawStr = (v: unknown): string => (typeof v === 'string' ? v : '');
      const rawOptions = Array.isArray(raw.options)
        ? raw.options.map((text: unknown, i: number) => ({
            key: String.fromCharCode(65 + i),
            text: rawStr(text),
          }))
        : undefined;
      const item: QuizQuestionItem = {
        id: rawStr(raw.id),
        type: toUiQuizType(rawStr(raw.type) || 'MULTIPLE_CHOICE'),
        category: `课内小测 · ${lesson.title}`,
        prompt: rawStr(raw.prompt),
        content: rawStr(raw.content),
        ...(rawOptions ? { options: rawOptions } : {}),
        correctAnswer: rawStr(raw.correctAnswer),
        explanation: rawStr(raw.explanation),
        testedSkill: rawStr(raw.testedSkillId),
      };
      prependQuestion.mutate(item);
      setQuestionIndex(0);
      closeLesson();
      setActiveTab('QUIZ');
      toast.success(`已出【${lesson.title}】小测，去做题吧`);
    } catch {
      toast.error('出题请求失败，请重试');
    } finally {
      setQuizzing(false);
    }
  };

  const markCompleted = (lesson: LessonItem) => {
    sound.playClick();
    complete.mutate(lesson.skillId, {
      onSuccess: () => {
        sound.playSuccess();
        toast.success(`「${lesson.title}」学完，这类题已解锁`);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : '打卡失败'),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeLesson();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-tone-amber-600" />
            {active ? active.title : '语法讲义'}
          </DialogTitle>
          <DialogDescription>
            {active
              ? active.summary
              : '先学讲义再做题：学完一篇，自动解锁对应考点的练习题。'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-xs text-ink-stone-500 py-6 text-center">讲义加载中…</p>
        ) : !active ? (
          <div className="space-y-2 py-2">
            {lessons.length === 0 && (
              <p className="text-xs text-ink-stone-500 py-6 text-center">
                当前轨道暂无讲义，直接做题即可。
              </p>
            )}
            {lessons.map((l) => (
              <button
                key={l.skillId}
                type="button"
                onClick={() => {
                  sound.playClick();
                  openLesson(l.skillId);
                }}
                className="w-full rounded-xl border border-line p-3 text-left hover:border-tone-amber-500o50 transition-colors"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink">
                    {l.title}
                  </span>
                  {l.completed ? (
                    <Badge variant="emerald" className="text-[10px]">
                      已学完
                    </Badge>
                  ) : (
                    <Badge variant="amber" className="text-[10px]">
                      待学
                    </Badge>
                  )}
                </span>
                <span className="block text-[11px] text-ink-stone-500 mt-1">{l.summary}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {active.sections.map((s) => (
              <section key={s.heading} className="space-y-1.5">
                <h4 className="text-sm font-bold text-ink">
                  {s.heading}
                </h4>
                {s.body.map((p, i) => (
                  <p key={i} className="text-[13px] leading-relaxed text-ink-mute">
                    {p}
                  </p>
                ))}
              </section>
            ))}

            {active.examples.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold text-ink">例句跟读</h4>
                {active.examples.map((e, i) => (
                  <div
                    key={i}
                    className="rounded-xl bg-veil-stone-100o70-stone-800o60 p-3 space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {e.ja}
                      </p>
                      <UnifiedTtsPlayer text={e.ja} lang="JA" variant="inline" />
                    </div>
                    {e.reading && (
                      <p className="text-[11px] text-ink-stone-500 flex items-center gap-1">
                        <Volume2 className="w-3 h-3" />
                        {e.reading}
                      </p>
                    )}
                    <p className="text-xs text-ink-faint-soft">{e.zh}</p>
                  </div>
                ))}
              </section>
            )}

            {active.pitfall && (
              <div className="rounded-xl border border-line-red-500o25 bg-wash-red-500o5 p-3">
                <p className="text-xs font-bold text-ink-red-700-red-300">易错</p>
                <p className="text-[13px] text-ink-mute mt-1">
                  {active.pitfall}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {active.completed ? (
                <Badge variant="emerald" className="text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  已学完 · 这类题已解锁
                </Badge>
              ) : (
                <Button size="sm" onClick={() => markCompleted(active)} disabled={complete.isPending}>
                  {complete.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  )}
                  学完了，解锁这类题
                </Button>
              )}
              <Button
                size="sm"
                variant={active.completed ? 'default' : 'outline'}
                onClick={() => void startLessonQuiz(active)}
                disabled={quizzing}
              >
                {quizzing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 mr-1" />
                )}
                课内小测
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openLesson(null)}>
                返回列表
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
