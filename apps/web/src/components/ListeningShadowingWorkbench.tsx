import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Headphones,
  Play,
  Pause,
  Volume2,
  Mic,
  Sparkles,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Eye,
  EyeOff,
  Bot,
} from 'lucide-react';
import { sound } from '../utils/audio.js';
import { toast } from 'sonner';
import { type TextbookLesson, type TextbookSentence } from '../models/textbook.js';
import { type DictationItem } from '../models/practice.js';
import { useGenerateDictationMutation, useTextbooksQuery } from '../queries/useLearnerQueries.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useTts } from '../hooks/useTts.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { BorderBeam } from './magicui/index.js';
import type { SupportedLanguage } from '../utils/audio.js';

interface ListeningShadowingWorkbenchProps {
  onOpenTutor?: (context: AiTutorContext) => void;
  onAddMistake?: (mistake: {
    categoryTag: string;
    prompt: string;
    sentence: string;
    userWrongAnswer: string;
    correctAnswer: string;
    testedSkillId: string;
    reviewNote: string;
  }) => void;
}

export const ListeningShadowingWorkbench: React.FC<ListeningShadowingWorkbenchProps> = ({
  onOpenTutor,
  onAddMistake,
}) => {

  // 模式切换: 'SHADOWING' (对话影子跟读) | 'DICTATION' (精听挖词听写)
  const [activeSubMode, setActiveSubMode] = useState<'SHADOWING' | 'DICTATION'>('SHADOWING');

  // 对话精听状态 (集成多语种教材课次)
  const { data: textbooks = [] } = useTextbooksQuery();
  const allLessons = textbooks.flatMap((b) =>
    b.lessons.map((l) => ({
      lesson: l,
      bookTitle: b.shortTitle,
      language: (b.language || 'JA') as SupportedLanguage,
    }))
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  useEffect(() => {
    if (allLessons.length === 0) return;
    if (!allLessons.some((item) => item.lesson.id === selectedLessonId)) {
      setSelectedLessonId(allLessons[0]!.lesson.id);
    }
  }, [allLessons, selectedLessonId]);
  const activeLessonMeta = allLessons.find((item) => item.lesson.id === selectedLessonId) ?? allLessons[0];
  const activeLesson: TextbookLesson | undefined = activeLessonMeta?.lesson;
  const currentLanguage: SupportedLanguage = activeLessonMeta?.language ?? 'JA';
  const [sentenceIndex, setSentenceIndex] = useState<number>(0);

  // 统一的 TTS 调度与状态 (Zustand)
  const { isSpeaking, rate, speak, stop, setRate } = useTts();
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const isLoopingRef = useRef<boolean>(isLooping);
  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  // 全局持久化偏好 (注音显示与盲听遮罩)
  const showFurigana = usePreferencesStore((s) => s.furiganaEnabled);
  const setShowFurigana = usePreferencesStore((s) => s.setFuriganaEnabled);
  const maskText = usePreferencesStore((s) => s.maskTextEnabled);
  const setMaskText = usePreferencesStore((s) => s.setMaskTextEnabled);
  const [shadowStep, setShadowStep] = useState<'IDLE' | 'LISTENING' | 'SHADOWING'>('IDLE');

  // 挖词听写状态（题池由 Gateway learning.content 生成；空池时显式提示，不内置演示题）
  const [dictationPool, setDictationPool] = useState<DictationItem[]>([]);
  const [dictationIndex, setDictationIndex] = useState<number>(0);
  const [userInput, setUserInput] = useState<string>('');
  const [hasChecked, setHasChecked] = useState<boolean>(false);
  const [isDictationCorrect, setIsDictationCorrect] = useState<boolean | null>(null);
  const generateDictation = useGenerateDictationMutation();

  const activeSentence: TextbookSentence | undefined = activeLesson?.dialogues[sentenceIndex];
  const activeDictation: DictationItem | undefined =
    dictationPool[dictationIndex] ?? dictationPool[0];

  // 播放当前句子并驱动影子跟读流程
  const playActiveSentence = () => {
    if (!activeSentence) return;
    setShadowStep('LISTENING');
    speak(activeSentence.japanese, {
      lang: currentLanguage,
      rate,
      onStart: () => setShadowStep('LISTENING'),
      onEnd: () => {
        if (activeSubMode === 'SHADOWING') {
          setShadowStep('SHADOWING');
          setTimeout(() => {
            if (isLoopingRef.current) {
              playActiveSentence();
            } else {
              setShadowStep('IDLE');
            }
          }, 1800);
        } else {
          setShadowStep('IDLE');
        }
      },
      onError: () => {
        setShadowStep('IDLE');
      },
    });
  };

  const handleTogglePlay = () => {
    sound.playClick();
    if (isSpeaking) {
      stop();
      setShadowStep('IDLE');
    } else {
      if (activeSubMode === 'SHADOWING' && activeSentence) {
        playActiveSentence();
      } else if (activeSubMode === 'DICTATION' && activeDictation) {
        speak(activeDictation.fullJapanese, { lang: 'JA' });
      }
    }
  };

  const handleNextSentence = () => {
    if (!activeLesson) return;
    sound.playClick();
    stop();
    setShadowStep('IDLE');
    if (sentenceIndex < activeLesson.dialogues.length - 1) {
      setSentenceIndex((prev) => prev + 1);
    } else {
      setSentenceIndex(0);
    }
  };

  const handlePrevSentence = () => {
    if (!activeLesson) return;
    sound.playClick();
    stop();
    setShadowStep('IDLE');
    if (sentenceIndex > 0) {
      setSentenceIndex((prev) => prev - 1);
    } else {
      setSentenceIndex(activeLesson.dialogues.length - 1);
    }
  };

  // 挖词听写提交比对
  const handleCheckDictation = () => {
    if (!activeDictation) return;
    if (!userInput.trim()) {
      toast.warning('请输入您听到的假名或助词');
      return;
    }

    const trimmedUser = userInput.trim();
    const isCorrect =
      trimmedUser === activeDictation.targetWord ||
      trimmedUser.toLowerCase() === activeDictation.furiganaHint.toLowerCase();

    setIsDictationCorrect(isCorrect);
    setHasChecked(true);

    if (isCorrect) {
      sound.playSuccess();
      toast.success('听写完全正确！假名与格助词掌握敏锐！');
    } else {
      sound.playError();
      toast.error(`听写有误：正确应为「${activeDictation.targetWord}」`);

      if (onAddMistake) {
        onAddMistake({
          categoryTag: activeDictation.categoryTag,
          prompt: activeDictation.blankPrompt,
          sentence: activeDictation.clozeDisplay,
          userWrongAnswer: trimmedUser,
          correctAnswer: activeDictation.targetWord,
          testedSkillId: activeDictation.testedSkillId,
          reviewNote: activeDictation.grammarExplanation,
        });
      }
    }
  };

  const handleNextDictation = () => {
    sound.playClick();
    setUserInput('');
    setHasChecked(false);
    setIsDictationCorrect(null);
    setShadowStep('IDLE');
    if (dictationIndex < dictationPool.length - 1) {
      setDictationIndex((prev) => prev + 1);
    } else {
      setDictationIndex(0);
    }
  };

  const handleRefreshDictation = async () => {
    sound.playClick();
    try {
      const items = await generateDictation.mutateAsync({ count: 4 });
      setDictationPool(items);
      setDictationIndex(0);
      setUserInput('');
      setHasChecked(false);
      setIsDictationCorrect(null);
      toast.success('已从 learning.content 刷新听写题池');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : '暂时无法生成听写题，请确认 Gateway 已启动后重试。'
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      {/* 顶部标题与控制栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper-soft p-4 sm:p-5 rounded-2xl border border-line-accent shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center font-bold">
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold font-serif text-ink">
                听力精听与影子跟读工作台
              </h2>
              <Badge variant="amber" className="text-[11px] border-tone-amber-500o20">
                Web Audio 原声解析
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost">
              短句切片循环 · 假名标音遮罩 · 影子同步跟读 · 关键助词听写
            </p>
          </div>
        </div>

        {/* 二级模式切换 */}
        <Tabs
          value={activeSubMode}
          onValueChange={(val) => {
            if (!val) return;
            sound.playClick();
            setActiveSubMode(val as 'SHADOWING' | 'DICTATION');
          }}
        >
          <TabsList className="bg-veil-stone-200o60-stone-900 self-start sm:self-auto">
            <TabsIndicator />
            <TabsTrigger value="SHADOWING" className="px-3 py-1.5 text-xs">
              🎙️ 对话短句影子跟读
            </TabsTrigger>
            <TabsTrigger value="DICTATION" className="px-3 py-1.5 text-xs">
              ✍️ 考点挖词精听听写 ({dictationPool.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ========================================================================= */}
      {/* 模式一：对话短句影子跟读 (SHADOWING)                                        */}
      {/* ========================================================================= */}
      {activeSubMode === 'SHADOWING' && (
        <div className="flex flex-col gap-5">
          {/* 教材课文快速选择与播放参数设置 */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-paper-bright p-3.5 rounded-xl border border-line-accent text-xs">
            <div className="flex items-center gap-2">
              <span className="text-ink-stone-500 font-medium">当前教材篇目：</span>
              <Select
                value={selectedLessonId}
                onValueChange={(value) => {
                  if (!value) return;
                  sound.playClick();
                  stop();
                  setShadowStep('IDLE');
                  setSelectedLessonId(value);
                  setSentenceIndex(0);
                }}
              >
                <SelectTrigger className="w-[280px] sm:w-[320px]">
                  <SelectValue placeholder="选择教材篇目" />
                </SelectTrigger>
                <SelectContent>
                  {allLessons.map((item) => (
                    <SelectItem key={item.lesson.id} value={item.lesson.id}>
                      《{item.bookTitle}》第 {item.lesson.lessonNumber} 课 · {item.lesson.title} ({item.lesson.targetLevel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 辅助工具栏：语速、假名显示与纯盲听遮罩 */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-veil-stone-200o60-stone-800 p-1 rounded-lg">
                {[0.75, 1.0, 1.25].map((spd) => (
                  <Button
                    key={spd}
                    type="button"
                    variant={Math.abs(rate - spd) < 0.05 ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      sound.playClick();
                      setRate(spd);
                    }}
                    className="h-6 px-2 text-[11px] font-bold"
                  >
                    {spd}x
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                variant={showFurigana ? 'amber' : 'outline'}
                size="sm"
                onClick={() => {
                  sound.playClick();
                  setShowFurigana(!showFurigana);
                }}
                className="h-7 gap-1 px-2.5"
              >
                {showFurigana ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showFurigana ? '注音: 开' : '注音: 关'}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  sound.playClick();
                  setMaskText(!maskText);
                }}
                className={`h-7 gap-1 px-2.5 transition-colors ${ maskText ? 'border-line-purple-500o30 bg-wash-purple-500o10 text-ink-purple-900 dark:text-ink-purple-300' : '' }`}
              >
                <span>{maskText ? '🙈 盲听中' : '👀 看原文'}</span>
              </Button>
            </div>
          </div>

          {/* 句子精听与跟读主展示卡片 */}
          {activeSentence && activeLesson ? (
            <motion.div
              key={activeSentence.id}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 sm:p-8 rounded-2xl bg-paper-soft border border-line-accent shadow-sm space-y-6 relative overflow-hidden"
            >
              {/* Magic UI 流光边框增强：发音与跟读反馈 */}
              {shadowStep === 'SHADOWING' && (
                <BorderBeam
                  size={220}
                  duration="var(--motion-border-beam-shadowing-duration)"
                  colorFrom="var(--visual-shadowing-beam-from)"
                  colorTo="var(--visual-shadowing-beam-to)"
                />
              )}
              {shadowStep === 'LISTENING' && (
                <BorderBeam
                  size={180}
                  duration="var(--motion-border-beam-listening-duration)"
                  colorFrom="var(--visual-listening-beam-from)"
                  colorTo="var(--visual-listening-beam-to)"
                />
              )}
              {/* 顶部说话者与进度 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full bg-tone-amber-500o20 text-ink-amber-900-amber-300 font-bold flex items-center justify-center text-xs">
                    {activeSentence.speaker}
                  </span>
                  <div>
                    <span className="font-semibold text-xs text-ink-soft">
                      说话者：{activeSentence.speaker}
                    </span>
                    <span className="text-[11px] text-ink-stone-400 ml-2">
                      句段 {sentenceIndex + 1} / {activeLesson.dialogues.length}
                    </span>
                  </div>
                </div>

                {/* 影子跟读节拍状态条 */}
                <div className="flex items-center gap-2">
                  {shadowStep === 'LISTENING' && (
                    <Badge className="animate-pulse gap-1 bg-tone-amber-500 text-tone-stone-950 border-transparent hover:bg-tone-amber-500">
                      <Volume2 className="w-3.5 h-3.5" />
                      正在聆听原声 ({rate}x)
                    </Badge>
                  )}
                  {shadowStep === 'SHADOWING' && (
                    <Badge variant="emerald" className="animate-bounce gap-1">
                      <Mic className="w-3.5 h-3.5" />
                      🎙️ 影子跟读时刻！请大声复述
                    </Badge>
                  )}
                  {shadowStep === 'IDLE' && (
                    <span className="text-xs text-ink-stone-400">就绪 · 点击播放开始</span>
                  )}
                </div>
              </div>


              {/* 日语原句与假名标注区域 */}
              <div className="min-h-[90px] flex flex-col justify-center items-center text-center px-4">
                {maskText ? (
                  <div className="p-4 rounded-xl bg-veil-stone-200o50-stone-900o50 text-ink-stone-500 text-sm font-medium flex items-center gap-2">
                    <span>🙈 原文已遮罩，请先盲听 2~3 遍建立听觉反射，再揭晓文本</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 带假名的 Ruby 文本 */}
                    <div className="text-2xl sm:text-3xl font-serif text-ink tracking-wider flex flex-wrap justify-center items-center gap-x-2 gap-y-1">
                      {activeSentence.furiganaTokens.map((token, idx) => {
                        if (showFurigana && token.reading) {
                          return (
                            <ruby key={idx} className="cursor-pointer hover:text-tone-amber-600 transition-colors">
                              {token.surface}
                              <rt className="text-xs text-accent-ink-warm font-sans select-none">
                                {token.reading}
                              </rt>
                            </ruby>
                          );
                        }
                        return (
                          <span key={idx} className="cursor-pointer hover:text-tone-amber-600 transition-colors">
                            {token.surface}
                          </span>
                        );
                      })}
                      <UnifiedTtsPlayer
                        variant="inline"
                        text={activeSentence.japanese}
                        lang={currentLanguage}
                        className="ml-1"
                      />
                    </div>

                    {/* 中文翻译 */}
                    <p className="text-sm sm:text-base text-ink-ghost font-serif">
                      {activeSentence.chinese}
                    </p>
                  </div>
                )}
              </div>

              {/* 语法要点提示 */}
              {activeSentence.grammarNotes && activeSentence.grammarNotes.length > 0 && !maskText && (
                <div className="p-3 rounded-xl bg-wash-amber-500o10-stone-900o60 border border-line-amber-900o10 text-xs text-ink-amber-900-amber-300 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-tone-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-bold">句型语法考点：</span>
                    {activeSentence.grammarNotes.map((n, i) => (
                      <p key={i} className="text-ink-mute">
                        • {n}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* 核心播放与切换控制器 */}
              <div className="flex items-center justify-between pt-2 border-t border-tone-stone-200o80-stone-800">
                {/* 循环跟读开关 */}
                <Button
                  variant={isLooping ? 'amber' : 'outline'}
                  size="sm"
                  onClick={() => {
                    sound.playClick();
                    setIsLooping(!isLooping);
                  }}
                  className="gap-1"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>{isLooping ? '循环跟读: 开' : '单次播放'}</span>
                </Button>

                {/* 播放 / 暂停大按钮群 */}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrevSentence}
                    title="上一句"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  <Button
                    size="icon"
                    onClick={handleTogglePlay}
                    className={`w-14 h-14 rounded-2xl shadow-md ${
                      isSpeaking
                        ? 'bg-tone-amber-600 text-tone-stone-950'
                        : 'bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 text-tone-stone-950 hover:brightness-105'
                    }`}
                  >
                    {isSpeaking ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                  </Button>

                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleNextSentence}
                    title="下一句"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* 向 AI 导师就此句追问 */}
                {onOpenTutor && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      sound.playClick();
                      onOpenTutor({
                        questionText: `请针对听力短句进行剖析：「${activeSentence.japanese}」（${activeSentence.chinese}）`,
                        userAnswer: undefined,
                        correctAnswer: activeSentence.japanese,
                        skillTag: activeSentence.grammarNotes?.[0] ?? '听力短句口语辨析',
                        explanation: '句子包含假名读音标注与格助词接续规则',
                      });
                    }}
                    className="gap-1.5 h-auto p-0"
                  >
                    <Bot className="w-4 h-4" />
                    <span>AI 深度追问</span>
                  </Button>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="p-8 text-center text-ink-stone-400">本课暂无对话短句</div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 模式二：考点挖词精听听写挑战 (DICTATION)                                    */}
      {/* ========================================================================= */}
      {activeSubMode === 'DICTATION' && (
        <div className="flex flex-col gap-5">
          {!activeDictation ? (
            <div className="p-10 rounded-2xl bg-paper-soft border border-line-accent shadow-sm text-center space-y-4">
              <Sparkles className="w-8 h-8 mx-auto text-tone-amber-500" />
              <p className="text-sm text-ink-faint">
                题池为空。听写题由 Gateway learning.content 依据教材考点实时生成并入库，不内置演示题。
              </p>
              <Button
                onClick={handleRefreshDictation}
                disabled={generateDictation.isPending}
                className="bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 hover:brightness-105"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {generateDictation.isPending ? '生成中…' : '生成听写题'}
              </Button>
            </div>
          ) : (
          <motion.div
            key={activeDictation.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 sm:p-8 rounded-2xl bg-paper-soft border border-line-accent shadow-sm space-y-6"
          >
            {/* 顶栏信息 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="amber">{activeDictation.categoryTag}</Badge>
                <span className="text-xs text-ink-stone-500">
                  第 {dictationIndex + 1} 题 / 共 {dictationPool.length} 题
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshDictation}
                  disabled={generateDictation.isPending}
                  className="gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {generateDictation.isPending ? '生成中…' : '刷新题池'}
                </Button>
              {/* 播放原声语音按钮 (统一 TTS 组件) */}
              <UnifiedTtsPlayer
                variant="button"
                text={activeDictation.fullJapanese}
                lang="JA"
                label="播报录音原声"
              />
              </div>
            </div>

            {/* 听力挖空展示 */}
            <div className="space-y-3 text-center py-4 bg-paper-bright rounded-xl border border-line-amber-900o5 p-4">
              <p className="text-xs text-ink-stone-500 font-medium">{activeDictation.blankPrompt}</p>
              <h3 className="text-2xl sm:text-3xl font-bold font-serif text-ink tracking-wide">
                {activeDictation.clozeDisplay}
              </h3>
              <p className="text-sm text-ink-ghost font-serif">
                中文释义：{activeDictation.chinese}
              </p>
            </div>

            {/* 听写输入框 */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCheckDictation();
                  }}
                  disabled={hasChecked && isDictationCorrect === true}
                  placeholder="听录音后在此键入所缺假名（如：で / に / か）..."
                  className="w-full px-4 py-3 rounded-xl bg-surface-warm border border-line-amber-900o20-amber-500o20 text-ink text-base font-medium outline-none focus:ring-2 focus:ring-tone-amber-500 shadow-xs"
                />
                <span className="absolute right-3 top-3.5 text-xs text-ink-stone-400 font-mono">
                  按 Enter 提交
                </span>
              </div>

              {!hasChecked ? (
                <Button
                  onClick={handleCheckDictation}
                  className="w-full sm:w-auto h-11 px-6 shrink-0 bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 hover:brightness-105"
                >
                  🚀 验证听写
                </Button>
              ) : (
                <Button
                  onClick={handleNextDictation}
                  className="w-full sm:w-auto h-11 px-6 shrink-0 bg-surface-stone-900-amber-600 text-tone-white hover:brightness-110"
                >
                  下一题 ➔
                </Button>
              )}
            </div>

            {/* 听写核对反馈区 */}
            {hasChecked && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-xl border text-xs space-y-2 ${ isDictationCorrect ? 'bg-wash-emerald-500o10 border-line-emerald-500o30 text-ink-emerald-900-emerald-200' : 'bg-wash-rose-500o10 border-line-rose-500o30 text-ink-rose-900-rose-200' }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm">
                  {isDictationCorrect ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-tone-emerald-600" />
                      <span>听写敏锐！答案完全一致（「{activeDictation.targetWord}」）</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5 text-ink-rose-600" />
                      <span>
                        听写有误：正确应为「{activeDictation.targetWord}」(读音: {activeDictation.furiganaHint})，已自动录入错题本
                      </span>
                    </>
                  )}
                </div>
                <p className="text-ink-mute leading-relaxed font-sans">
                  💡 {activeDictation.grammarExplanation}
                </p>
              </motion.div>
            )}
          </motion.div>
          )}
        </div>
      )}
    </div>
  );
};
