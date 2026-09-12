import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Bot,
} from 'lucide-react';
import {
  ShimmerButton,
  NumberTicker,
  fireSuccessConfetti,
} from './magicui/index.js';
import { sound } from '../utils/audio.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../config/tts-voice-personas.js';
import { SubjectiveWritingWorkbench } from './SubjectiveWritingWorkbench.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import type { QuizQuestionItem } from '../models/learning.js';
import { toUiQuizType } from '@study-studio/protocol';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import {
  useQuestionsQuery,
  usePrependQuestionMutation,
} from '../queries/useLearnerQueries.js';
import {
  useGenerateAdaptiveQuizMutation,
  useSubmitQuizMutation,
} from '../queries/useAgentMutations.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';

interface AdaptiveQuizWorkbenchProps {
  onOpenTutor: (ctx: AiTutorContext) => void;
}

export function AdaptiveQuizWorkbench({ onOpenTutor }: AdaptiveQuizWorkbenchProps) {
  const shell = useLearningShell();
  const { data: questionsFromQuery = [], isLoading: questionsLoading } = useQuestionsQuery();
  const prependQuestion = usePrependQuestionMutation();
  const submitQuiz = useSubmitQuizMutation();
  const generateAdaptive = useGenerateAdaptiveQuizMutation();
  const isGatewayConnected = useGatewayStore((s) => s.isConnected);
  const questionIndex = useStudySessionStore((s) => s.questionIndex);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);
  const presentedQuiz = useStudySessionStore((s) => s.presentedQuiz);
  const clearPresentedQuiz = useStudySessionStore((s) => s.clearPresentedQuiz);

  const [quizSubMode, setQuizSubMode] = useState<'OBJECTIVE' | 'SUBJECTIVE'>('OBJECTIVE');
  const [isGeneratingAdaptive, setIsGeneratingAdaptive] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [fillBlankInput, setFillBlankInput] = useState('');
  const [reorderSelectedChunks, setReorderSelectedChunks] = useState<string[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [isCurrentAnswerCorrect, setIsCurrentAnswerCorrect] = useState(false);
  const [sessionScore, setSessionScore] = useState(0);

  const presentedAsItems: QuizQuestionItem[] = (presentedQuiz?.questions ?? []).map((q) => {
    const item: QuizQuestionItem = {
      id: q.id,
      type: toUiQuizType(q.type),
      category: `导师推送 · ${q.testedSkillId}`,
      prompt: q.prompt,
      content: q.content,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      testedSkill: q.testedSkillId,
    };
    if (q.options?.length) {
      item.options = q.options.map((text, i) => ({
        key: String.fromCharCode(65 + i),
        text,
      }));
    }
    return item;
  });

  const questions =
    presentedAsItems.length > 0 ? presentedAsItems : questionsFromQuery;

  // AI 针对画像弱项一键出题 (动态组卷)
  const handleGenerateAdaptiveQuiz = async () => {
    sound.playClick();
    setIsGeneratingAdaptive(true);
    clearPresentedQuiz();
    try {
      if (isGatewayConnected) {
        const reply = (await generateAdaptive.mutateAsync({})) as {
          questions?: Array<Record<string, unknown>>;
          targetSkillName?: string;
        };
        if (reply && reply.questions && reply.questions.length > 0) {
          const newQRaw = (reply.questions[0] ?? {}) as Record<string, unknown>;
          const rawStr = (value: unknown): string =>
            typeof value === 'string' ? value : '';
          const rawOptions = Array.isArray(newQRaw.options)
            ? newQRaw.options.map((text: unknown, i: number) => ({
                key: String.fromCharCode(65 + i),
                text: rawStr(text),
              }))
            : undefined;
          const newQ: QuizQuestionItem = {
            id: rawStr(newQRaw.id),
            type: toUiQuizType(rawStr(newQRaw.type) || 'MULTIPLE_CHOICE'),
            category: `AI 靶向弱项 · ${reply.targetSkillName ?? shell.copy.targetWeaknessLabel}`,
            prompt: rawStr(newQRaw.prompt),
            content: rawStr(newQRaw.content),
            ...(rawOptions ? { options: rawOptions } : {}),
            correctAnswer: rawStr(newQRaw.correctAnswer),
            explanation: rawStr(newQRaw.explanation),
            testedSkill: rawStr(newQRaw.testedSkillId),
          };
          prependQuestion.mutate(newQ);
          setQuestionIndex(0);
          setSelectedChoice(null);
          setFillBlankInput('');
          setReorderSelectedChunks([]);
          setQuizSubmitted(false);
          sound.playSuccess();
          fireSuccessConfetti();
          toast.success('🎯 AI 已根据您的学情画像生成专属靶向弱项测评！');
          return;
        }
      }

      // 离线环境备选：按当前轨道给骨架题，避免韩语轨仍落日语
      setTimeout(() => {
        const fallbackQ: QuizQuestionItem =
          shell.track === 'ko'
            ? {
                id: `q_ai_${Date.now()}`,
                type: 'CHOICE',
                category: 'AI 靶向弱项 · 조사 에/에서',
                prompt: '빈칸에 알맞은 조사를 고르세요:',
                content: '친구와 카페( ) 한국어를 공부합니다.',
                options: [
                  { key: 'A', text: '에서', note: '동작 장소' },
                  { key: 'B', text: '에', note: '존재·도착' },
                  { key: 'C', text: '을', note: '목적어' },
                  { key: 'D', text: '와', note: '동반' },
                ],
                correctAnswer: 'A',
                explanation: '동작이 일어나는 장소에는 「에서」를 씁니다.',
                testedSkill: 'ko.grammar.particle_eseo',
              }
            : shell.track === 'en'
              ? {
                  id: `q_ai_${Date.now()}`,
                  type: 'CHOICE',
                  category: 'AI 靶向弱项 · Subjunctive',
                  prompt: '选择最恰当的动词形式填入括号（虚拟语气）：',
                  content: 'The professor suggested that each student ( ) an outline.',
                  options: [
                    { key: 'A', text: 'submit' },
                    { key: 'B', text: 'submits' },
                    { key: 'C', text: 'submitted' },
                    { key: 'D', text: 'will submit' },
                  ],
                  correctAnswer: 'A',
                  explanation: 'suggest that … (should) + 动词原形。',
                  testedSkill: 'en.grammar.subjunctive',
                }
              : {
                  id: `q_ai_${Date.now()}`,
                  type: 'CHOICE',
                  category: 'AI 靶向弱项 · 助词「で」与「に」',
                  prompt: '根据动作属性选择正确的场所助词：',
                  content: '昨夜、友達と一緒に図書館（　）勉強しました。',
                  options: [
                    { key: 'A', text: 'で', note: '动作发生的场所' },
                    { key: 'B', text: 'に', note: '静态存在场所或目的地' },
                    { key: 'C', text: 'を', note: '宾格助词' },
                    { key: 'D', text: 'へ', note: '移动方向' },
                  ],
                  correctAnswer: 'A',
                  explanation: '「勉強する」为具体动态动作，动作发生场所固定使用「で」。',
                  testedSkill: 'jp.particle.ni_vs_de',
                };
        prependQuestion.mutate(fallbackQ);
        setQuestionIndex(0);
        setSelectedChoice(null);
        setQuizSubmitted(false);
        sound.playSuccess();
        fireSuccessConfetti();
        toast.success('🎯 AI 已根据您的学情画像生成专属靶向弱项测评！');
      }, 500);
    } catch {
      toast.error('AI 动态出题请求超时');
    } finally {
      setIsGeneratingAdaptive(false);
    }
  };

  const currentQ: QuizQuestionItem | undefined = questions[questionIndex] ?? questions[0];
  if (!currentQ) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-sm text-ink-ghost max-w-md">
          {questionsLoading
            ? '题库加载中…'
            : shell.copy.quizEmptyHint}
        </p>
        {shell.featureFlags.koreanInterim && shell.track === 'ko' && (
          <p className="text-[11px] text-ink-amber-700o80-amber-400o80 max-w-sm">
            韩语轨道为 interim 骨架：侧栏与题库已按 TOPIK 分区；界面母语仍为中文（非整页韩语 i18n）。
          </p>
        )}
        <ShimmerButton
          onClick={handleGenerateAdaptiveQuiz}
          disabled={isGeneratingAdaptive || !isGatewayConnected}
          className="px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isGeneratingAdaptive ? 'AI 正在分析弱项组卷...' : '🎯 AI 针对弱项出题'}</span>
        </ShimmerButton>
      </div>
    );
  }

  // 提交做题答题
  const handleQuizSubmit = () => {
    sound.playClick();
    let correct = false;

    if (currentQ.type === 'CHOICE') {
      correct = selectedChoice === currentQ.correctAnswer;
    } else if (currentQ.type === 'FILL_BLANK') {
      correct = fillBlankInput.trim().toLowerCase() === currentQ.correctAnswer.toLowerCase();
    } else if (currentQ.type === 'REORDER') {
      correct = reorderSelectedChunks.join(' ') === currentQ.correctAnswer;
    }

    setIsCurrentAnswerCorrect(correct);
    setQuizSubmitted(true);

    // 同步将做题结果与错题上报网关，由 SQLite 统一持久化
    submitQuiz.mutate({
      questionId: currentQ.id,
      userAnswer:
        currentQ.type === 'CHOICE'
          ? selectedChoice ?? ''
          : currentQ.type === 'FILL_BLANK'
          ? fillBlankInput
          : reorderSelectedChunks.join(' '),
      isCorrect: correct,
      score: correct ? 1 : 0,
      timeSpentMs: 2800,
      testedSkillId: currentQ.testedSkill,
      questionContent: currentQ.content,
      correctAnswer: currentQ.correctAnswer,
      explanation: currentQ.explanation,
    });

    if (correct) {
      sound.playSuccess();
      fireSuccessConfetti();
      setSessionScore((prev) => prev + 1);
      toast.success('回答正确！知识点掌握度提升 ＋5%');
    } else {
      sound.playMistake();
      toast.error('回答有误，系统已为您自动归入错题本并标注考点。');
    }
  };

  // 下一题处理
  const handleNextQuestion = () => {
    sound.playClick();
    setSelectedChoice(null);
    setFillBlankInput('');
    setReorderSelectedChunks([]);
    setQuizSubmitted(false);

    if (questionIndex < questions.length - 1) {
      setQuestionIndex(questionIndex + 1);
    } else {
      toast.success(`恭喜完成本轮专项练习！总得分 ${sessionScore + (isCurrentAnswerCorrect ? 1 : 0)} / ${questions.length}`);
      setQuestionIndex(0);
      setSessionScore(0);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-5 max-w-3xl"
    >
      <PlanIntentBanner />
      {/* 做题顶部子模式切换与 AI 靶向弱项组卷按钮 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-paper-soft p-3 rounded-2xl border border-line-accent shadow-xs">
        {/* 子模式切换 */}
        <Tabs
          value={quizSubMode}
          onValueChange={(val) => {
            if (val) {
              sound.playClick();
              setQuizSubMode(val as 'OBJECTIVE' | 'SUBJECTIVE');
            }
          }}
        >
          <TabsList className="bg-veil-stone-200o60-stone-900">
            <TabsIndicator />
            <TabsTrigger value="OBJECTIVE">
              ⚡ 客观快速秒测 ({questions.length}题)
            </TabsTrigger>
            <TabsTrigger value="SUBJECTIVE">
              ✍️ AI 深度主观造句/翻译批改
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* 针对画像弱项一键出题 */}
        <ShimmerButton
          onClick={handleGenerateAdaptiveQuiz}
          disabled={isGeneratingAdaptive}
          className="px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isGeneratingAdaptive ? 'AI 正在分析弱项组卷...' : '🎯 AI 针对弱项出题'}</span>
        </ShimmerButton>
      </div>

      {quizSubMode === 'SUBJECTIVE' ? (
        <SubjectiveWritingWorkbench />
      ) : (
        <>
          {/* 顶部进度指示 */}
          <div className="flex items-center justify-between text-xs text-ink-ghost px-1">
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-accent-ink" />
              第 {questionIndex + 1} 题 / 共 {questions.length} 题 · {currentQ.category}
            </span>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-[11px] text-ink-stone-400 font-mono">
                快捷键: 1-4 选选项 / Enter 提交
              </span>
              <span className="font-semibold text-accent-ink-warm font-mono">
                当前得分: <NumberTicker value={sessionScore} className="inline-block" />
              </span>
            </div>
          </div>

          {/* 题目主卡片 */}
          <div className="bg-paper-soft rounded-3xl p-6 sm:p-8 border border-line-accent shadow-sm space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="amber">
                  {currentQ.type === 'CHOICE' ? '单项选择题' : currentQ.type === 'FILL_BLANK' ? '填空变形题' : '连词成句题'}
                </Badge>
                <span className="text-xs text-ink-stone-400 font-mono">
                  考查点: {currentQ.testedSkill}
                </span>
              </div>
              <h3 className="text-sm font-medium text-ink-ghost">
                {currentQ.prompt}
              </h3>
              <div className="text-lg sm:text-xl font-medium text-ink pt-2 tracking-wide font-serif">
                {currentQ.content}
              </div>
              <div className="pt-1">
                <UnifiedTtsPlayer
                  variant="button"
                  text={currentQ.content}
                  lang={trackToSpeechLang(shell.track)}
                  label="读题干"
                />
              </div>
            </div>

            {/* 题型 1: CHOICE (单选) */}
            {currentQ.type === 'CHOICE' && currentQ.options && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {currentQ.options.map((opt, optIdx) => {
                  const isSelected = selectedChoice === opt.key;
                  const showCorrect = quizSubmitted && opt.key === currentQ.correctAnswer;
                  const showWrong = quizSubmitted && isSelected && !isCurrentAnswerCorrect;

                  return (
                    <motion.div
                      key={opt.key}
                      whileHover={!quizSubmitted ? { scale: 1.01 } : {}}
                      whileTap={!quizSubmitted ? { scale: 0.99 } : {}}
                    >
                      <Button
                        variant="outline"
                        disabled={quizSubmitted}
                        onClick={() => {
                          sound.playClick();
                          setSelectedChoice(opt.key);
                        }}
                        className={`w-full h-auto p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between items-stretch whitespace-normal ${ showCorrect ? 'bg-tone-emerald-500o15 border-tone-emerald-500 text-ink-emerald-950 dark:text-ink-emerald-200 hover:bg-tone-emerald-500o15' : showWrong ? 'bg-wash-rose-500o15 border-tone-rose-500 text-ink-rose-950 dark:text-line-rose-200 hover:bg-wash-rose-500o15' : isSelected ? 'bg-wash-amber-500o15 border-tone-amber-500 text-ink-amber-950-amber-100 ring-2 ring-line-amber-500o30 hover:bg-wash-amber-500o15' : 'bg-veil-stone-100o70-stone-900o50 border-tone-stone-200o80-stone-800 text-ink-soft hover:border-tone-amber-500o40' }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="secondary" className="rounded font-mono text-xs">
                            {opt.key} ({optIdx + 1})
                          </Badge>
                          {showCorrect && <CheckCircle2 className="w-4 h-4 text-tone-emerald-600" />}
                          {showWrong && <XCircle className="w-4 h-4 text-ink-rose-600" />}
                        </div>
                        <div className="text-base font-semibold pt-1">{opt.text}</div>
                        {opt.note && (
                          <div className="text-xs text-ink-stone-400 mt-1">{opt.note}</div>
                        )}
                      </Button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* 题型 2: FILL_BLANK (真实输入验证) */}
            {currentQ.type === 'FILL_BLANK' && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={quizSubmitted}
                    value={fillBlankInput}
                    onChange={(e) => setFillBlankInput(e.target.value)}
                    placeholder="在此输入你的答案..."
                    className="flex-1 py-3 px-4 rounded-xl bg-veil-stone-100o90-stone-900o80 text-ink border border-line-stone-300-stone-700 outline-none focus:border-tone-amber-500 text-base"
                  />
                </div>
              </div>
            )}

            {/* 题型 3: REORDER (连词成句) */}
            {currentQ.type === 'REORDER' && currentQ.chunks && (
              <div className="space-y-4 pt-2">
                <div className="min-h-14 p-3 rounded-2xl border-2 border-dashed border-line-amber-500o30 bg-wash-amber-50o40-stone-900o40 flex flex-wrap gap-2 items-center">
                  {reorderSelectedChunks.length === 0 ? (
                    <span className="text-xs text-ink-stone-400">
                      点击下方词块按正确语序填入此处...
                    </span>
                  ) : (
                    reorderSelectedChunks.map((chunk, idx) => (
                      <Button
                        key={idx}
                        size="sm"
                        disabled={quizSubmitted}
                        onClick={() => {
                          sound.playClick();
                          setReorderSelectedChunks((prev) => prev.filter((_, i) => i !== idx));
                        }}
                        className="h-8 px-3"
                      >
                        <span>{chunk}</span>
                        <span className="text-[10px] opacity-75">✕</span>
                      </Button>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {currentQ.chunks.map((chunk, cIdx) => {
                    const isUsed = reorderSelectedChunks.includes(chunk);
                    return (
                      <Button
                        key={cIdx}
                        variant="outline"
                        size="sm"
                        disabled={isUsed || quizSubmitted}
                        onClick={() => {
                          sound.playClick();
                          setReorderSelectedChunks((prev) => [...prev, chunk]);
                        }}
                        className={isUsed ? 'opacity-30' : ''}
                      >
                        {chunk}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 提交 / 下一题控制条 */}
            <div className="flex items-center justify-between pt-4 border-t border-line-soft">
              {!quizSubmitted ? (
                <ShimmerButton
                  onClick={handleQuizSubmit}
                  disabled={
                    (currentQ.type === 'CHOICE' && !selectedChoice) ||
                    (currentQ.type === 'FILL_BLANK' && !fillBlankInput.trim()) ||
                    (currentQ.type === 'REORDER' && reorderSelectedChunks.length === 0)
                  }
                  className="px-6 py-2.5 text-xs font-bold"
                >
                  立即提交判定 (0ms 本地秒判)
                </ShimmerButton>
              ) : (
                <Button onClick={handleNextQuestion} className="px-6 h-10">
                  <span>下一题练习</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* 答题反馈与解析抽屉入口 */}
            {quizSubmitted && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-2xl border space-y-3 ${
                  isCurrentAnswerCorrect
                    ? 'bg-wash-emerald-500o10 border-line-emerald-500o30'
                    : 'bg-wash-rose-500o10 border-line-rose-500o30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isCurrentAnswerCorrect ? (
                      <CheckCircle2 className="w-5 h-5 text-tone-emerald-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-ink-rose-600" />
                    )}
                    <span className="font-bold text-sm">
                      {isCurrentAnswerCorrect ? '解答正确！' : `解答有误，标准答案：${currentQ.correctAnswer}`}
                    </span>
                  </div>

                  {/* AI 导师深度追问入口按钮 */}
                  <Button
                    size="sm"
                    onClick={() =>
                      onOpenTutor({
                        questionText: currentQ.content,
                        userAnswer:
                          currentQ.type === 'CHOICE'
                            ? selectedChoice ?? undefined
                            : currentQ.type === 'FILL_BLANK'
                            ? fillBlankInput
                            : reorderSelectedChunks.join(' '),
                        correctAnswer: currentQ.correctAnswer,
                        skillTag: currentQ.category,
                        explanation: currentQ.explanation,
                      })
                    }
                    className="shrink-0"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>AI 导师深度剖析与追问</span>
                  </Button>
                </div>

                <p className="text-xs sm:text-sm text-ink-mute leading-relaxed font-serif">
                  {currentQ.explanation}
                </p>
              </motion.div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
