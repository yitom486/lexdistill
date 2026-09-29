import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Newspaper,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Bot,
  SlidersHorizontal,
  Volume2,
  Square,
  Highlighter,
  CreditCard,
  Languages,
  Loader2,
  Bookmark,
} from 'lucide-react';
import { toast } from 'sonner';
import { sound, speechStudio } from '../utils/audio.js';
import { openLookupPopup } from '../lib/lookup-popup-bus.js';
import {
  normalizeSelectionText,
  type LookupLanguage,
} from '../lib/selection-text.js';
import { fireSuccessConfetti } from './magicui/index.js';
import { ResizableSplitPane } from './ui/resizable-split-pane.js';
import { Button, buttonVariants } from './ui/button.js';
import { cn } from '../lib/utils.js';
import { Badge } from './ui/badge.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { Progress } from './ui/progress.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { toPlainReadingText } from '../utils/plain-text.js';
import type { ReadingPassageSet, NewsTopic } from '@study-studio/protocol';
import { NEWS_TOPICS } from '@study-studio/protocol';
import {
  useReadingSetsQuery,
  useGenerateReadingSetMutation,
  useSubmitReadingPracticeMutation,
  useAddAnnotationMutation,
  useAddCardsMutation,
  useNewsTopicsQuery,
} from '../queries/useLearnerQueries.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';

interface ReadingComprehensionWorkbenchProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

export function ReadingComprehensionWorkbench({
  onOpenTutor,
}: ReadingComprehensionWorkbenchProps) {
  const shell = useLearningShell();
  const splitRatio = usePreferencesStore((s) => s.readingSplitRatio);
  const setReadingSplitRatio = usePreferencesStore((s) => s.setReadingSplitRatio);
  const furiganaEnabled = usePreferencesStore((s) => s.furiganaEnabled);
  const toggleFurigana = usePreferencesStore((s) => s.toggleFurigana);

  const [origin, setOrigin] = useState<'ai' | 'news'>('ai');
  // 阅读内容由当前学习轨道决定，不在工作台内提供跨语言切换。
  const readingLanguage = shell.defaultReadingLang;
  const [aiDifficulty, setAiDifficulty] = useState('2');
  const [newsTopic, setNewsTopic] = useState('world');

  // TanStack Query 服务端状态对接
  const { data: newsTopics = NEWS_TOPICS } = useNewsTopicsQuery();
  const { data: dbReadingSets = [], isLoading: isSetsLoading } = useReadingSetsQuery(
    origin,
    readingLanguage
  );
  const generateMutation = useGenerateReadingSetMutation();
  const submitPracticeMutation = useSubmitReadingPracticeMutation();
  const addAnnotationMutation = useAddAnnotationMutation();
  const addCardsMutation = useAddCardsMutation();

  // 阅读篇目仅来自 Gateway / SQLite；空结果表示当前筛选条件确实无篇目，
  // 由已有空状态提示导入或生成，不再静默回退前端演示文章。
  const combinedSets: ReadingPassageSet[] = useMemo(() => dbReadingSets, [dbReadingSets]);

  const [activeSetId, setActiveSetId] = useState<string>('');
  const [stepIndex, setStepIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  // 音频朗读状态
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // 选区浮动工具栏状态
  const passageRef = useRef<HTMLDivElement>(null);
  const [selectionRange, setSelectionRange] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  // 默认选中第一个可用篇目；切语种后不得残留他语篇目
  useEffect(() => {
    if (combinedSets.length > 0) {
      if (!activeSetId || !combinedSets.some((s) => s.id === activeSetId)) {
        setActiveSetId(combinedSets[0]!.id);
        setStepIndex(0);
        setSelected(null);
        setSubmitted(false);
        setScore(0);
      }
    } else {
      setActiveSetId('');
      setStepIndex(0);
      setSelected(null);
      setSubmitted(false);
      setScore(0);
    }
  }, [combinedSets, activeSetId]);

  const activeSet: ReadingPassageSet | undefined =
    combinedSets.find((s) => s.id === activeSetId) ?? combinedSets[0];

  const plainBody = useMemo(
    () => (activeSet ? toPlainReadingText(activeSet.body) : ''),
    [activeSet]
  );

  const question = activeSet?.questions[stepIndex] ?? activeSet?.questions[0];
  const totalQuestions = activeSet?.questions?.length || 1;
  const progressPct = ((stepIndex + (submitted ? 1 : 0)) / totalQuestions) * 100;

  // 切换篇目来源
  const switchOrigin = (next: 'ai' | 'news') => {
    sound.playClick();
    speechStudio.stop();
    setIsPlayingAudio(false);
    setOrigin(next);
    setStepIndex(0);
    setSelected(null);
    setSubmitted(false);
    setScore(0);
  };

  // 朗读文章
  const handleTogglePlayAudio = () => {
    if (!activeSet) return;
    sound.playClick();
    if (isPlayingAudio) {
      speechStudio.stop();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      speechStudio.speak(plainBody || activeSet.body, {
        lang: activeSet.language,
        onEnd: () => setIsPlayingAudio(false),
        onError: () => setIsPlayingAudio(false),
      });
    }
  };

  // 监听划词选择
  const handleMouseUpPassage = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionRange(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length > 1) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const parentRect = passageRef.current?.getBoundingClientRect();
      if (parentRect) {
        setSelectionRange({
          text,
          x: Math.max(10, rect.left - parentRect.left + rect.width / 2 - 100),
          y: Math.max(10, rect.top - parentRect.top - 44),
        });
      }
    }
  };

  // 划词标记重点
  const handleMarkKeyPoint = () => {
    if (!activeSet || !selectionRange?.text) return;
    sound.playClick();
    addAnnotationMutation.mutate({
      documentId: activeSet.id,
      quote: selectionRange.text,
      kind: 'KEY_POINT',
      startOffset: 0,
      endOffset: selectionRange.text.length,
    });
    toast.success(`已沉淀批注重点：“${selectionRange.text.slice(0, 15)}...”`);
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  // 划词查词典：经总线复用全局查词浮层（自有工具栏保留，各管各的选择）
  const handleLookupSelection = () => {
    if (!activeSet || !selectionRange?.text) return;
    const language: LookupLanguage =
      activeSet.language === 'EN' ? 'en' : activeSet.language === 'KO' ? 'ko' : 'ja';
    const text = normalizeSelectionText(selectionRange.text);
    if (!text) return;
    sound.playClick();
    const parentRect = passageRef.current?.getBoundingClientRect();
    const x = parentRect ? parentRect.left + selectionRange.x : window.innerWidth / 2 - 130;
    const y = parentRect ? parentRect.top + selectionRange.y + 44 : 120;
    openLookupPopup({ text, language, x, y });
  };

  // 划词转记忆卡
  const handleConvertToFlashcard = () => {
    if (!activeSet || !selectionRange?.text) return;
    sound.playClick();
    addCardsMutation.mutate([
      {
        id: `card_${Date.now()}`,
        type: 'VOCAB',
        frontWord: selectionRange.text,
        reading: '',
        tag: '阅读精读',
        pos: '重点词句',
        backMeaning: `来自阅读篇目《${activeSet.title}》的重点摘录与研读。`,
        exampleJp: plainBody.slice(0, 80) || activeSet.body.slice(0, 80),
        exampleHighlight: selectionRange.text,
        exampleZh: '',
        stability: 1.0,
        reps: 0,
      },
    ]);
    toast.success('已一键转化为 FSRS 记忆卡！可在闪卡工作台复习。');
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  // 提交单题作答
  const handleSubmitAnswer = () => {
    if (!selected || submitted || !question) return;
    sound.playClick();
    const ok = selected === question.correctAnswer;
    setSubmitted(true);
    if (ok) {
      setScore((s) => s + 1);
      sound.playCorrect();
      toast.success('回答正确！+1');
    } else {
      sound.playMistake();
      toast.error(`回答有误，正确答案为: ${question.correctAnswer}`);
    }
  };

  // 进入下一题或完成整篇
  const handleNextQuestion = () => {
    if (!activeSet) return;
    sound.playClick();
    if (stepIndex < totalQuestions - 1) {
      setStepIndex((i) => i + 1);
      setSelected(null);
      setSubmitted(false);
    } else {
      // 完成整篇，回写学情与打卡
      const finalScore = score + (selected === question?.correctAnswer ? 0 : 0);
      submitPracticeMutation.mutate({
        setId: activeSet.id,
        score: finalScore,
        totalQuestions,
        language: activeSet.language,
      });

      if (finalScore >= Math.ceil(totalQuestions * 0.8)) {
        fireSuccessConfetti();
        sound.playSuccess();
        toast.success(`太棒了！本篇阅读理解通关：${finalScore}/${totalQuestions} 题正确！`);
      } else {
        toast.info(`本篇完成：答对 ${finalScore}/${totalQuestions} 题。继续加油！`);
      }

      setStepIndex(0);
      setSelected(null);
      setSubmitted(false);
      setScore(0);
    }
  };

  // 动态生成篇目
  const handleGenerateNewPassage = async () => {
    sound.playClick();
    try {
      const genLanguage = readingLanguage;
      toast.loading(
        origin === 'ai'
          ? genLanguage === 'EN'
            ? `AI 正在按 CET/考研向难度 Lv.${aiDifficulty} 生成英语精读篇...`
            : genLanguage === 'KO'
              ? `AI 正在生成韩语轨道脚手架篇目（interim）Lv.${aiDifficulty}...`
              : `AI 正在按难度 Lv.${aiDifficulty} 生成日语自适应长文...`
          : genLanguage === 'EN'
            ? `正在从英语媒体抓取「${newsTopic}」原文（多源回退；失败则用 RSS 摘要）...`
            : genLanguage === 'KO'
              ? `正在从韩语公开源抓取「${newsTopic}」原文（联合新闻等；失败回退摘要）...`
              : `正在从 NHK 等日语源抓取「${newsTopic}」正文（失败则回退 RSS）...`,
        { id: 'generate-reading' }
      );
      const generated = await generateMutation.mutateAsync({
        origin,
        difficulty: Number(aiDifficulty),
        language: genLanguage,
        topic:
          origin === 'news'
            ? newsTopic
            : genLanguage === 'EN'
              ? 'education and media literacy'
              : genLanguage === 'KO'
                ? '시사·생활'
                : '日常生活与文化',
      });
      toast.success(
        origin === 'ai'
          ? genLanguage === 'KO'
            ? '韩语轨道 interim 篇目与配题已生成'
            : '自适应阅读长文与配套测试题生成成功！'
          : genLanguage === 'KO'
            ? '韩语公开新闻已就绪（原文摘录或 RSS 摘要）'
            : '真实新闻篇目抓取与排版完成！',
        { id: 'generate-reading' }
      );
      if (generated?.id) {
        setActiveSetId(generated.id);
        setStepIndex(0);
        setSelected(null);
        setSubmitted(false);
        setScore(0);
      }
    } catch (e) {
      toast.error('生成篇目失败，请检查网关连接状态', { id: 'generate-reading' });
    }
  };

  // 左侧文章区（当前轨道无篇目时展示空态，禁止回落到其他轨道的 DEMO）
  const passagePanel = !activeSet ? (
    <div className="h-full rounded-2xl border border-dashed border-line-amber-900o20-amber-500o20 bg-paper-soft flex flex-col items-center justify-center gap-2 p-8 text-center">
      <Newspaper className="w-8 h-8 text-tone-amber-500o70" />
      <p className="text-sm font-medium text-ink-mute-deep">
        {shell.copy.readingEmptyHint}
      </p>
      <p className="text-xs text-ink-stone-500">
        当前学习轨道暂无篇目 · 可点右上角「自适应生成」创建阅读材料
      </p>
    </div>
  ) : (
    <div
      ref={passageRef}
      onMouseUp={handleMouseUpPassage}
      data-manual-lookup="true"
      className="h-full rounded-2xl border border-line-accent bg-paper-soft shadow-xs flex flex-col overflow-hidden relative"
    >
      {/* 划词悬浮快捷栏 */}
      <AnimatePresence>
        {selectionRange && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 4 }}
            style={{ left: selectionRange.x, top: selectionRange.y }}
            className="absolute z-30 flex items-center gap-1 p-1 bg-tone-stone-900 text-tone-white rounded-xl shadow-xl text-xs"
          >
            <button
              onClick={() => speechStudio.speak(selectionRange.text, { lang: activeSet.language })}
              className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-tone-stone-800 rounded-lg transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5 text-ink-amber-400" />
              朗读
            </button>
            <div className="w-[1px] h-3.5 bg-tone-stone-700" />
            <button
              onClick={handleMarkKeyPoint}
              className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-tone-stone-800 rounded-lg transition-colors"
            >
              <Highlighter className="w-3.5 h-3.5 text-ink-amber-400" />
              标重点
            </button>
            <div className="w-[1px] h-3.5 bg-tone-stone-700" />
            <button
              onClick={handleLookupSelection}
              className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-tone-stone-800 rounded-lg transition-colors"
            >
              <Languages className="w-3.5 h-3.5 text-tone-sky-400" />
              查词
            </button>
            <div className="w-[1px] h-3.5 bg-tone-stone-700" />
            <button
              onClick={handleConvertToFlashcard}
              className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-tone-stone-800 rounded-lg transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5 text-ink-emerald-400" />
              转闪卡
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 顶部篇目信息栏与操作 */}
      <div className="px-4 py-3 border-b border-line-accent flex flex-wrap items-center gap-2 justify-between bg-wash-amber-500o5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={activeSet.origin === 'ai' ? 'amber' : 'emerald'}>
              {activeSet.origin === 'ai' ? 'AI 自适应篇目' : '真实精选新闻'}
            </Badge>
            {activeSet.origin === 'news' &&
              // P3-B：优先读结构化 sourceKind；旧数据无该字段时回退到 sourceLabel 字符串推断
              (activeSet.sourceKind === 'full_text' ? (
                <Badge variant="outline" className="text-[10px] border-line-emerald-600o40 text-ink-emerald-800-emerald-300">
                  原文摘录
                </Badge>
              ) : activeSet.sourceKind === 'rss_summary' ? (
                <Badge variant="outline" className="text-[10px]">
                  RSS 摘要
                </Badge>
              ) : activeSet.sourceKind === 'offline_template' ? (
                <Badge
                  variant="outline"
                  className="text-[10px] border-line-amber-600o50 text-ink-amber-800-amber-300"
                  title={
                    activeSet.fetchStatus === 'timeout'
                      ? '抓取超时，已用合规模板兜底'
                      : activeSet.fetchStatus === 'empty'
                        ? '新闻源返回为空，已用合规模板兜底'
                        : activeSet.fetchStatus === 'network_failed'
                          ? '新闻源网络失败，已用合规模板兜底'
                          : '新闻源暂不可用，已用合规模板兜底'
                  }
                >
                  {activeSet.fetchStatus === 'timeout'
                    ? '超时·模板兜底'
                    : activeSet.fetchStatus === 'empty'
                      ? '空源·模板兜底'
                      : activeSet.fetchStatus === 'network_failed'
                        ? '网络失败·模板兜底'
                        : '模板兜底'}
                </Badge>
              ) : activeSet.sourceLabel.includes('原文摘录') ? (
                <Badge variant="outline" className="text-[10px] border-line-emerald-600o40 text-ink-emerald-800-emerald-300">
                  原文摘录
                </Badge>
              ) : activeSet.sourceLabel.includes('RSS') ? (
                <Badge variant="outline" className="text-[10px]">
                  RSS 摘要
                </Badge>
              ) : null)}
            <Badge variant="secondary" className="font-mono text-[10px]">
              Lv.{activeSet.difficulty}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {activeSet.language === 'JA' ? '日文' : activeSet.language === 'KO' ? '韩文' : '英文'}
            </Badge>
            <span className="text-[11px] text-ink-stone-500 truncate">{activeSet.sourceLabel}</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold font-serif text-ink truncate">
            {activeSet.title}
          </h3>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* TTS 朗读控制 */}
          <Button
            variant={isPlayingAudio ? 'amber' : 'outline'}
            size="sm"
            onClick={handleTogglePlayAudio}
            className="text-xs gap-1"
          >
            {isPlayingAudio ? (
              <>
                <Square className="w-3.5 h-3.5 animate-pulse text-ink-amber-900-amber-100" />
                停止
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-accent-ink-warm" />
                全文朗读
              </>
            )}
          </Button>

          {/* 假名注音开关 (仅日文篇目可见) */}
          {activeSet.language === 'JA' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFurigana}
              className={`text-xs gap-1 ${furiganaEnabled ? 'text-tone-amber-700 font-bold' : 'text-ink-stone-400'}`}
              title="切换假名注音辅助"
            >
              <Languages className="w-3.5 h-3.5" />
              注音
            </Button>
          )}

          {activeSet.sourceUrl && (
            <a
              href={activeSet.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={activeSet.sourceUrl}
              onClick={() => sound.playClick()}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-xs gap-1')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              查看原文
            </a>
          )}
        </div>
      </div>

      {/* 篇目列表切换胶囊 */}
      {combinedSets.length > 1 && (
        <div className="px-4 py-2 border-b border-line-stone-200o50-stone-800o50 flex items-center gap-2 overflow-x-auto bg-veil-stone-100o40-stone-900o30">
          <Bookmark className="w-3 h-3 text-ink-stone-400 shrink-0" />
          <span className="text-[11px] text-ink-stone-400 shrink-0">当前精选：</span>
          <div className="flex items-center gap-1.5 flex-nowrap">
            {combinedSets.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  sound.playClick();
                  speechStudio.stop();
                  setIsPlayingAudio(false);
                  setActiveSetId(s.id);
                  setStepIndex(0);
                  setSelected(null);
                  setSubmitted(false);
                  setScore(0);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all ${
                  s.id === activeSet.id
                    ? 'bg-tone-amber-600 text-tone-white font-medium shadow-xs'
                    : 'text-ink-faint-soft hover:bg-veil-stone-200o70-stone-800'
                }`}
              >
                {s.title.slice(0, 14)}...
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 正文呈现区 */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 select-text">
        <p className="text-[15px] sm:text-base leading-8 whitespace-pre-wrap font-serif text-ink-soft selection:bg-tone-amber-500o25 selection:text-ink-amber-900-amber-100">
          {plainBody}
        </p>
      </div>

      <div className="px-4 py-2 text-[11px] text-ink-hint border-t border-line-amber-900o5-amber-500o5 flex items-center justify-between gap-2">
        <span>
          💡 划词可即时朗读、沉淀重点或一键出闪卡
          {activeSet.sourceUrl ? ' · 右上角可打开媒体原文核对' : ''}
        </span>
        <span className="shrink-0">共 {plainBody.length} 字/词</span>
      </div>
    </div>
  );

  // 右侧题目自测区
  const questionPanel = !activeSet ? (
    <div className="h-full rounded-2xl border border-dashed border-line-amber-900o20-amber-500o20 bg-paper-soft flex flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-ink-stone-500">暂无配题 · 生成篇目后将在此作答</p>
    </div>
  ) : (
    <div className="h-full rounded-2xl border border-line-accent bg-paper-soft shadow-xs flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line-accent space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-stone-500">
          <span className="font-mono">
            第 {stepIndex + 1} / {totalQuestions} 题
          </span>
          <span className="text-accent-ink-warm font-medium">
            本篇已答对 {score} 题
          </span>
        </div>
        <Progress value={progressPct} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {question ? (
          <>
            <p className="text-sm font-semibold text-ink leading-relaxed">
              {question.prompt}
            </p>
            <div className="space-y-2">
              {question.options.map((opt) => {
                const isSel = selected === opt.key;
                const showOk = submitted && opt.key === question.correctAnswer;
                const showBad = submitted && isSel && opt.key !== question.correctAnswer;
                return (
                  <Button
                    key={opt.key}
                    type="button"
                    variant="outline"
                    disabled={submitted}
                    onClick={() => {
                      sound.playClick();
                      setSelected(opt.key);
                    }}
                    className={`h-auto w-full justify-start px-3 py-3 text-left font-normal transition-colors ${ showOk ? 'border-tone-emerald-500 bg-wash-emerald-500o10 text-ink-emerald-950 dark:text-tint-emerald-100' : showBad ? 'border-tone-rose-500 bg-wash-rose-500o10 text-ink-rose-950 dark:text-tint-rose-100' : isSel ? 'border-tone-amber-500 bg-wash-amber-500o10 font-medium' : '' }`}
                  >
                    <Badge variant="secondary" className="mr-2 font-mono shrink-0">
                      {opt.key}
                    </Badge>
                    <span className="text-sm">{opt.text}</span>
                    {showOk && (
                      <CheckCircle2 className="w-4 h-4 ml-auto text-tone-emerald-600 shrink-0" />
                    )}
                    {showBad && <XCircle className="w-4 h-4 ml-auto text-ink-rose-600 shrink-0" />}
                  </Button>
                );
              })}
            </div>

            {submitted && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl text-xs leading-relaxed bg-wash-amber-500o10 border border-tone-amber-500o20 text-ink-mute"
              >
                💡 {question.explanation}
              </motion.div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-ink-stone-400">
            暂无配套阅读理解题目
          </div>
        )}
      </div>

      <div className="p-3 border-t border-line-accent flex flex-wrap items-center gap-2 justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={stepIndex === 0 && !submitted}
          onClick={() => {
            sound.playClick();
            setStepIndex((i) => Math.max(0, i - 1));
            setSelected(null);
            setSubmitted(false);
          }}
        >
          <ChevronLeft className="w-4 h-4" /> 上一题
        </Button>

        <div className="flex items-center gap-2">
          {onOpenTutor && submitted && question && (
            <Button
              variant="amber"
              size="sm"
              onClick={() =>
                onOpenTutor({
                  questionText: `【阅读理解】篇目《${activeSet.title}》：${question.prompt}`,
                  userAnswer: selected ?? undefined,
                  correctAnswer: question.correctAnswer,
                  skillTag: '长文阅读理解',
                  explanation: `篇目正文：“${plainBody.slice(0, 100)}...”\n\n题目解析：“${question.explanation}”`,
                })
              }
            >
              <Bot className="w-3.5 h-3.5" /> 追问导师
            </Button>
          )}

          {!submitted ? (
            <Button size="sm" disabled={!selected} onClick={handleSubmitAnswer}>
              提交本题
            </Button>
          ) : (
            <Button size="sm" onClick={handleNextQuestion}>
              {stepIndex < totalQuestions - 1 ? '下一题' : '完成本篇'}
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4 w-full max-w-6xl"
    >
      <PlanIntentBanner />
      {/* 顶部控制栏与生成器 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-2xl border border-line-accent bg-paper-soft shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center">
            <Newspaper className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold font-serif text-ink">
                阅读理解工作室 (Reading Studio)
              </h2>
              <Badge variant="amber" className="text-[10px]">
                双栏拖拽可调宽
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost mt-0.5">
              {shell.featureFlags.koreanInterim
                ? '韩语：联合新闻等公开 RSS + 原文摘录；失败回退学习模板'
                : 'AI 分级篇目与真实合规新闻双源驱动 · 左文右题 · 划词转闪卡 · 自动同步学情'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 篇目来源切换 */}
          <Tabs value={origin} onValueChange={(v) => v && switchOrigin(v as 'ai' | 'news')}>
            <TabsList className="bg-veil-stone-200o60-stone-800">
              <TabsIndicator />
              <TabsTrigger value="ai" className="text-xs gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI 写文章
              </TabsTrigger>
              <TabsTrigger value="news" className="text-xs gap-1">
                <Newspaper className="w-3.5 h-3.5" /> 今日新闻
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {origin === 'ai' ? (
            <Select value={aiDifficulty} onValueChange={(v) => v && setAiDifficulty(v)}>
              <SelectTrigger className="w-[7.5rem]">
                <SelectValue placeholder="难度" />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    难度 Lv.{d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={newsTopic} onValueChange={(v) => v && setNewsTopic(v)}>
              <SelectTrigger className="w-[8.5rem]">
                <SelectValue placeholder="栏目" />
              </SelectTrigger>
              <SelectContent>
                {newsTopics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={generateMutation.isPending}
            onClick={handleGenerateNewPassage}
            className="text-xs gap-1"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-3.5 h-3.5 text-tone-amber-600" />
                {origin === 'ai' ? '自适应生成' : '抓取新闻'}
              </>
            )}
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-ink-stone-400 hidden md:block px-1">
        拖拽中间分隔条，或按 <kbd className="px-1 rounded bg-tone-stone-200o80-stone-800 font-mono">[</kbd>
        {' / '}
        <kbd className="px-1 rounded bg-tone-stone-200o80-stone-800 font-mono">]</kbd>
        微调双栏宽度（Shift 加大步进；偏好已本地持久化）。
      </p>
      <p className="text-[11px] text-ink-stone-400 md:hidden px-1">
        手机端为上下布局；桌面端可拖拽中间分隔条调整宽度（分栏偏好已自动本地持久化）。
      </p>

      {/* 双栏自适应阅读器 */}
      <ResizableSplitPane
        ratio={splitRatio}
        onRatioChange={setReadingSplitRatio}
        enableBracketShortcuts
        left={passagePanel}
        right={questionPanel}
      />
    </motion.div>
  );
}
