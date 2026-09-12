import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Volume2,
  Sparkles,
  Layers,
  HelpCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Bot,
  Flame,
  Award,
  BookOpen,
  Info,
  Lightbulb,
  Mic2,
  GitCompareArrows,
} from 'lucide-react';
import { toast } from 'sonner';
import { sound, speechStudio } from '../utils/audio.js';
import { fireSuccessConfetti, ShimmerButton } from './magicui/index.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { KanaMemoryGuideDialog } from './ja/kana/KanaMemoryGuideDialog.js';
import { KanaRowGuideDialog } from './ja/kana/KanaRowGuideDialog.js';
import { getKanaCardHighlight, KanaRowLabel } from './ja/kana/KanaRowLabel.js';
import {
  useCurriculumKanaQuery,
  useAdaptiveKanaQueueQuery,
  useKanaPracticeMutation,
  useGenerateKanaWordsMutation,
  useCollectDictionaryEntryMutation,
  type KanaWordItem,
} from '../queries/useLearnerQueries.js';
import { romajiToKana, toHiragana } from '../lib/kana-input.js';
import { confusionDistractorItems, confusionDistractors } from '../lib/kana-confusion.js';
import { buildKanaTutorContext } from '../lib/kana-tutor.js';
import type { KanaItem } from '@study-studio/protocol';
import type { AiTutorContext } from './AiTutorDrawer.js';

interface KanaStudioWorkbenchProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

type MatrixTab = 'SEION' | 'DAKUON_HANDAKUON' | 'YOON';
type ScriptDisplayMode = 'HIRAGANA' | 'KATAKANA' | 'BOTH';
type DrillMode = 'AUDIO_TO_KANA' | 'KANA_TO_ROMAJI' | 'HIRA_TO_KATA' | 'WORD_DICTATION' | 'WORD_MEANING' | 'MIXED';
type RecognitionMode = 'AUDIO_TO_KANA' | 'KANA_TO_ROMAJI' | 'HIRA_TO_KATA';
const RECOGNITION_MODES: RecognitionMode[] = ['AUDIO_TO_KANA', 'KANA_TO_ROMAJI', 'HIRA_TO_KATA'];

/** 五十音矩阵的列不是“有几个就排几个”，而是固定对应五个元音段位。 */
const KANA_COLUMN_CLASSES: Record<string, string> = {
  あ段: 'col-start-1',
  い段: 'col-start-2',
  う段: 'col-start-3',
  え段: 'col-start-4',
  お段: 'col-start-5',
};

/** 题量档（0 = 全部）。 */

/** 按读音猜书写体（回写画像用；混合书写回退 HIRAGANA）。 */
function guessWordScript(kana: string): 'HIRAGANA' | 'KATAKANA' {
  const hasKata = /[\u30A0-\u30FF]/.test(kana);
  const hasHira = /[\u3040-\u309F]/.test(kana);
  return hasKata && !hasHira ? 'KATAKANA' : 'HIRAGANA';
}

export function KanaStudioWorkbench({ onOpenTutor }: KanaStudioWorkbenchProps) {
  const { data: allKana = [], refetch: refetchKana, isLoading: isKanaLoading } = useCurriculumKanaQuery();
  const practiceMutation = useKanaPracticeMutation();

  // 界面状态
  const [matrixTab, setMatrixTab] = useState<MatrixTab>('SEION');
  const [scriptMode, setScriptMode] = useState<ScriptDisplayMode>('HIRAGANA');
  const [showRomaji, setShowRomaji] = useState(true);
  const [activeKana, setActiveKana] = useState<KanaItem | null>(null);
  const [isKanaGuideOpen, setIsKanaGuideOpen] = useState(false);
  const [isMemoryGuideOpen, setIsMemoryGuideOpen] = useState(false);
  const [activeRowGuide, setActiveRowGuide] = useState<{
    rowName: string;
    items: readonly KanaItem[];
  } | null>(null);

  // 自测考核模式状态
  const [isDrillActive, setIsDrillActive] = useState(false);
  const [drillMode, setDrillMode] = useState<DrillMode>('AUDIO_TO_KANA');
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillStreak, setDrillStreak] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  // 题量与本轮战报（切模式/题量/重开自动清零）
  const [drillCount, setDrillCount] = useState<number>(10);
  const [drillRound, setDrillRound] = useState(0);
  const [drillAnswered, setDrillAnswered] = useState(0);
  const [drillCorrect, setDrillCorrect] = useState(0);

  const resetRoundStats = () => {
    setDrillAnswered(0);
    setDrillCorrect(0);
  };

  // 单词巩固（听写 / 词义）：词表来自 Gateway 本地词典，Agent 经 learning.content 同源调用
  const generateWords = useGenerateKanaWordsMutation();
  const collectEntry = useCollectDictionaryEntryMutation();
  const [wordList, setWordList] = useState<KanaWordItem[]>([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [wordInput, setWordInput] = useState('');
  // 学练一体：每词先学（看读音释义+跟读）再测，切词/切模式自动回到学
  const [wordStudyDone, setWordStudyDone] = useState(false);
  const isWordMode = drillMode === 'WORD_DICTATION' || drillMode === 'WORD_MEANING';
  const currentWord: KanaWordItem | undefined = wordList[wordIndex];

  useEffect(() => {
    if (!isDrillActive || !isWordMode || wordList.length > 0 || generateWords.isPending) return;
    generateWords.mutate(
      { count: 8, script: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA' },
      {
        onSuccess: (words) => {
          setWordList(words);
          setWordIndex(0);
        },
        onError: () => {
          toast.error('假名单词加载失败，请稍后重试。');
        },
      }
    );
  }, [isDrillActive, isWordMode, wordList.length, scriptMode, generateWords.isPending, generateWords.mutate]);

  // 新词切出即自动播报（学阶段跟读用；作答后不再重播）
  useEffect(() => {
    if (!isDrillActive || drillMode !== 'WORD_DICTATION' || !currentWord) return;
    void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'dictation' });
  }, [isDrillActive, drillMode, currentWord]);

  // 矩阵分类过滤
  const filteredKanaList = useMemo(() => {
    if (matrixTab === 'SEION') {
      return allKana.filter((k) => k.type === 'SEION' || k.type === 'SPECIAL');
    }
    if (matrixTab === 'DAKUON_HANDAKUON') {
      return allKana.filter((k) => k.type === 'DAKUON' || k.type === 'HANDAKUON');
    }
    return allKana.filter((k) => k.type === 'YOON');
  }, [allKana, matrixTab]);

  // 按“行”组织假名
  const groupedByRow = useMemo(() => {
    const map = new Map<string, KanaItem[]>();
    for (const item of filteredKanaList) {
      if (!map.has(item.row)) {
        map.set(item.row, []);
      }
      map.get(item.row)!.push(item);
    }
    return Array.from(map.entries()).map(([rowName, items]) => ({
      rowName,
      items: items.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, [filteredKanaList]);

  // 播放假名发音
  const handlePlayAudio = (kana: KanaItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    sound.playClick();
    speechStudio.speak(kana.audioText, { lang: 'JA', purpose: 'preview' });
  };

  // 点击假名主体只播放发音，并保留当前格子的高亮
  const handleSelectKana = (kana: KanaItem) => {
    handlePlayAudio(kana);
    setActiveKana(kana);
  };

  // 只有明确点击“详情”时才打开讲义 Dialog
  const handleOpenKanaGuide = (kana: KanaItem) => {
    handleSelectKana(kana);
    setIsKanaGuideOpen(true);
  };

  const handleOpenRowGuide = (rowName: string, items: readonly KanaItem[]) => {
    sound.playClick();
    setActiveRowGuide({ rowName, items });
  };

  // 自适应题池跟随矩阵范围；每轮由 Gateway 按逐项 FSRS 状态冻结，0 = 范围内全部。
  const adaptiveKanaTypes = useMemo<readonly string[]>(() => {
    if (matrixTab === 'SEION') return ['SEION', 'SPECIAL'];
    if (matrixTab === 'DAKUON_HANDAKUON') return ['DAKUON', 'HANDAKUON'];
    return ['YOON'];
  }, [matrixTab]);
  const adaptiveKanaQueueQuery = useAdaptiveKanaQueueQuery({
    types: adaptiveKanaTypes,
    scriptType: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
    limit: drillCount,
    round: drillRound,
    enabled: isDrillActive && !isWordMode,
  });
  const drillItems = adaptiveKanaQueueQuery.data ?? [];

  const currentDrillKana: KanaItem | undefined = drillItems[drillIndex];

  // 混合模式：每题题型提前排好，作答中途不变
  const mixedPlan = useMemo<RecognitionMode[]>(() => {
    if (drillMode !== 'MIXED') return [];
    return drillItems.map(
      () => RECOGNITION_MODES[Math.floor(Math.random() * RECOGNITION_MODES.length)]!
    );
  }, [drillMode, drillItems]);

  // 当前题实际生效题型（混合模式按排表，其余直通）
  const activeMode: DrillMode =
    drillMode === 'MIXED' ? (mixedPlan[drillIndex] ?? 'AUDIO_TO_KANA') : drillMode;

  // 生成选项：保留一个有价值的近邻，其余跨行/跨段随机补齐。
  const drillOptions = useMemo(() => {
    if (!currentDrillKana || drillItems.length === 0) return [];

    let correctAnswer = '';
    if (activeMode === 'AUDIO_TO_KANA') {
      correctAnswer = scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana;
    } else if (activeMode === 'KANA_TO_ROMAJI') {
      correctAnswer = currentDrillKana.romaji;
    } else {
      correctAnswer = currentDrillKana.katakana;
    }

    const pool = filteredKanaList.length >= 4 ? filteredKanaList : allKana.length > 0 ? allKana : drillItems;
    const distractorScript = activeMode === 'HIRA_TO_KATA' || scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA';
    const distractorItems = confusionDistractorItems(
      currentDrillKana,
      pool,
      distractorScript,
      activeMode === 'KANA_TO_ROMAJI' ? 6 : 3
    );
    const distractors =
      activeMode === 'KANA_TO_ROMAJI'
        ? (() => {
            const seen = new Set([correctAnswer]);
            const values: string[] = [];
            for (const item of distractorItems) {
              if (seen.has(item.romaji)) continue;
              seen.add(item.romaji);
              values.push(item.romaji);
              if (values.length === 3) break;
            }
            return values;
          })()
        : distractorItems.map((item) =>
            distractorScript === 'KATAKANA' ? item.katakana : item.hiragana
          );

    return [correctAnswer, ...distractors].sort(() => 0.5 - Math.random());
  }, [currentDrillKana, drillItems, allKana, filteredKanaList, activeMode, scriptMode]);

  // 本题正确答案字面（供答错时请导师讲清错因）
  const drillCorrectAnswer = useMemo(() => {
    if (!currentDrillKana) return '';
    if (activeMode === 'AUDIO_TO_KANA') {
      return scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana;
    }
    if (activeMode === 'KANA_TO_ROMAJI') {
      return currentDrillKana.romaji;
    }
    return currentDrillKana.katakana;
  }, [currentDrillKana, activeMode, scriptMode]);

  // 提交自测作答
  const handleSelectDrillOption = (option: string) => {
    if (isAnswered || !currentDrillKana) return;

    setSelectedOption(option);
    setIsAnswered(true);

    let isCorrect = false;
    if (activeMode === 'AUDIO_TO_KANA') {
      isCorrect =
        option ===
        (scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana);
    } else if (activeMode === 'KANA_TO_ROMAJI') {
      isCorrect = option === currentDrillKana.romaji;
    } else {
      isCorrect = option === currentDrillKana.katakana;
    }

    setDrillAnswered((n) => n + 1);
    if (isCorrect) {
      sound.playCorrect();
      setDrillCorrect((n) => n + 1);
      setDrillStreak((s) => s + 1);
      toast.success('回答正确！+1');
      if ((drillStreak + 1) % 5 === 0) {
        fireSuccessConfetti();
      }
    } else {
      sound.playMistake();
      setDrillStreak(0);
      toast.error(`回答有误，正确答案为: ${currentDrillKana.hiragana} (${currentDrillKana.romaji})`);
    }

    // 回写 Gateway SQLite 画像与足迹
    practiceMutation.mutate({
      kanaId: currentDrillKana.id,
      isCorrect,
      scriptType: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
    });
  };

  // 下一题
  const handleNextDrill = () => {
    sound.playClick();
    setSelectedOption(null);
    setIsAnswered(false);
    if (drillIndex < drillItems.length - 1) {
      setDrillIndex((i) => i + 1);
    } else {
      fireSuccessConfetti();
      toast.success('恭喜完成本轮假名自测！');
      setDrillIndex(0);
      setDrillRound((round) => round + 1);
      resetRoundStats();
    }
  };

  // 词义选项（正确释义 + 同批其余词干扰项）
  const meaningOptions = useMemo(() => {
    if (!currentWord) return [];
    const correct = currentWord.meanings[0] ?? '';
    const distractors = wordList
      .filter((w) => w.id !== currentWord.id)
      .map((w) => w.meanings[0] ?? '')
      .filter((m) => m && m !== correct)
      .slice(0, 3);
    return [correct, ...distractors].sort(() => 0.5 - Math.random());
  }, [currentWord, wordList]);

  const recordWordResult = (isCorrect: boolean) => {
    if (!currentWord) return;
    practiceMutation.mutate({
      kanaId: currentWord.entryId,
      isCorrect,
      scriptType: guessWordScript(currentWord.kana),
    });
  };

  // 单词听写提交：罗马字输入即时转假名比对（规则判定 0ms；主观写作仍走 learning.assess）
  const handleSubmitWordInput = () => {
    if (isAnswered || !currentWord) return;
    const converted = romajiToKana(
      wordInput.trim(),
      allKana,
      scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA'
    );
    const isCorrect =
      converted !== '' && toHiragana(converted) === toHiragana(currentWord.kana);
    setIsAnswered(true);
    setDrillAnswered((n) => n + 1);
    if (isCorrect) {
      sound.playCorrect();
      setDrillCorrect((n) => n + 1);
      setDrillStreak((s) => s + 1);
      toast.success('拼写正确！+1');
      if ((drillStreak + 1) % 5 === 0) {
        fireSuccessConfetti();
      }
    } else {
      sound.playMistake();
      setDrillStreak(0);
      toast.error(`拼写有误，正确答案为: ${currentWord.kana}`);
    }
    recordWordResult(isCorrect);
  };

  // 词义回想提交
  const handleSelectMeaningOption = (option: string) => {
    if (isAnswered || !currentWord) return;
    setSelectedOption(option);
    setIsAnswered(true);
    const correct = currentWord.meanings[0] ?? '';
    const isCorrect = option === correct;
    setDrillAnswered((n) => n + 1);
    if (isCorrect) {
      sound.playCorrect();
      setDrillCorrect((n) => n + 1);
      setDrillStreak((s) => s + 1);
      toast.success('回答正确！+1');
      if ((drillStreak + 1) % 5 === 0) {
        fireSuccessConfetti();
      }
    } else {
      sound.playMistake();
      setDrillStreak(0);
      toast.error(`回答有误，正确释义为: ${correct}`);
    }
    recordWordResult(isCorrect);
  };

  // 单词一键转 FSRS 生词卡（导出）
  const handleCollectWord = () => {
    if (!currentWord) return;
    collectEntry.mutate(currentWord.entryId, {
      onSuccess: () => toast.success(`已加入生词本：${currentWord.headword}`),
      onError: () => toast.error('加入生词本失败，请稍后重试。'),
    });
  };

  // 下一词 / 换一批
  const handleNextWord = () => {
    sound.playClick();
    setSelectedOption(null);
    setIsAnswered(false);
    setWordInput('');
    setWordStudyDone(false);
    if (wordIndex < wordList.length - 1) {
      setWordIndex((i) => i + 1);
    } else {
      fireSuccessConfetti();
      toast.success('本轮单词巩固完成！');
      setWordIndex(0);
      resetRoundStats();
    }
  };

  const handleRefreshWords = () => {
    sound.playClick();
    setWordList([]);
    setWordIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setWordInput('');
    setWordStudyDone(false);
    resetRoundStats();
  };

  // 呼出导师深度解析（记忆引导语由 lib/kana-tutor 构造，UI 只负责调用）
  const handleAskTutor = (
    kana: KanaItem,
    extra?: { wasWrong?: boolean; userPick?: string | null }
  ) => {
    sound.playClick();
    onOpenTutor?.(
      buildKanaTutorContext({
        kana,
        pool: allKana,
        script: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
        ...(extra?.wasWrong ? { wasWrong: true as const } : {}),
        ...(extra?.userPick ? { userPick: extra.userPick } : {}),
      })
    );
  };

  const activeKanaConfusions = useMemo(() => {
    if (!activeKana) return [];
    return confusionDistractors(
      activeKana,
      allKana,
      scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
      3
    );
  }, [activeKana, allKana, scriptMode]);

  return (
    <div className="space-y-6">
      {/* 顶部控制与切换栏 */}
      <div className="bg-paper-soft rounded-2xl p-4 sm:p-6 border border-line-accent shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="amber">课程底座</Badge>
              <span className="text-xs text-ink-ghost">
                权威字形 · 标准发音 · 熟练度回写
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-ink mt-1">
              五十音工作室 (Kana Studio)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 平/片假名切换 */}
            <div className="flex items-center bg-veil-stone-200o70-stone-800o80 rounded-xl p-1 text-xs">
              <button
                onClick={() => {
                  sound.playClick();
                  setScriptMode('HIRAGANA');
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  scriptMode === 'HIRAGANA'
                    ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
                    : 'text-ink-stone-500 hover:text-ink-soft'
                }`}
              >
                平假名
              </button>
              <button
                onClick={() => {
                  sound.playClick();
                  setScriptMode('KATAKANA');
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  scriptMode === 'KATAKANA'
                    ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
                    : 'text-ink-stone-500 hover:text-ink-soft'
                }`}
              >
                片假名
              </button>
              <button
                onClick={() => {
                  sound.playClick();
                  setScriptMode('BOTH');
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  scriptMode === 'BOTH'
                    ? 'bg-tone-white dark:bg-tone-stone-700 text-ink shadow-sm font-bold'
                    : 'text-ink-stone-500 hover:text-ink-soft'
                }`}
              >
                平片对照
              </button>
            </div>

            {/* 罗马音注音显示开关 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sound.playClick();
                setShowRomaji(!showRomaji);
              }}
              className="text-xs gap-1.5"
            >
              <span>罗马字: {showRomaji ? '开' : '关'}</span>
            </Button>

            <Button
              variant="amber"
              size="sm"
              onClick={() => {
                sound.playClick();
                setIsMemoryGuideOpen(true);
              }}
              className="gap-1.5 text-xs shadow-sm"
              aria-label="打开五十音记忆法"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>五十音记忆法</span>
            </Button>

            {/* 自测模式切换 */}
            <ShimmerButton
              onClick={() => {
                sound.playClick();
                const enteringDrill = !isDrillActive;
                setIsDrillActive(enteringDrill);
                if (enteringDrill) setDrillRound((round) => round + 1);
                setSelectedOption(null);
                setIsAnswered(false);
                setWordIndex(0);
                setWordInput('');
                setWordStudyDone(false);
                resetRoundStats();
              }}
              className="px-3.5 py-1.5 text-xs font-semibold gap-1.5 shadow-md"
            >
              <Award className="w-3.5 h-3.5" />
              <span>{isDrillActive ? '返回假名矩阵' : '启动假名自测'}</span>
            </ShimmerButton>
          </div>
        </div>

        {/* 矩阵选项卡 (清音 / 浊音&半浊音 / 拗音) */}
        {!isDrillActive && (
          <div className="mt-4 pt-4 border-t border-line-amber-900o10-amber-500o10 flex items-center justify-between">
            <Tabs
              value={matrixTab}
              onValueChange={(val) => {
                if (!val) return;
                sound.playClick();
                setMatrixTab(val as MatrixTab);
              }}
            >
              <TabsList className="bg-transparent p-0 border-0">
                <TabsIndicator className="bg-tone-amber-500 shadow-sm" />
                <TabsTrigger value="SEION" className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950">
                  清音矩阵 (46)
                </TabsTrigger>
                <TabsTrigger value="DAKUON_HANDAKUON" className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950">
                  浊音与半浊音 (25)
                </TabsTrigger>
                <TabsTrigger value="YOON" className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950">
                  常用拗音 (33)
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <span className="text-xs text-ink-stone-400 font-mono hidden sm:inline">
              点击假名播放发音 · 点击“详情”打开讲义
            </span>
          </div>
        )}
      </div>

      {/* 核心主展区：矩阵模式 vs 自测模式 */}
      <AnimatePresence mode="wait">
        {isDrillActive ? (
          /* ================= 自测模式 (Kana Drill) ================= */
          <motion.div
            key="drill"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="max-w-2xl mx-auto bg-paper-soft rounded-3xl p-6 sm:p-8 border border-line-amber-900o15-amber-500o20 shadow-md space-y-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="amber">考核冲刺</Badge>
                <span className="text-xs text-ink-stone-500">
                  {isWordMode ? (
                    wordList.length === 0 ? (
                      <>{generateWords.isPending ? '抽词中…' : '暂无词语'}</>
                    ) : (
                      <>第 {wordIndex + 1} / {wordList.length} 词</>
                    )
                  ) : drillItems.length === 0 ? (
                    <>{adaptiveKanaQueueQuery.isLoading ? '正在按练习记录组题…' : '暂无题目'}</>
                  ) : (
                    <>第 {drillIndex + 1} / {drillItems.length} 题</>
                  )}
                </span>
                {!isWordMode && drillItems.length > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-veil-stone-200o70-stone-800 text-ink-ghost"
                    title="题池跟随矩阵选项卡范围"
                  >
                    {matrixTab === 'SEION'
                      ? '清音矩阵'
                      : matrixTab === 'DAKUON_HANDAKUON'
                        ? '浊音·半浊音'
                        : '常用拗音'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {drillStreak > 0 && (
                  <div className="flex items-center gap-1 text-xs font-bold text-accent-ink">
                    <Flame className="w-4 h-4 fill-tone-amber-500 text-tone-amber-500 animate-pulse" />
                    <span>{drillStreak} 连对</span>
                  </div>
                )}
                {drillAnswered > 0 && (
                  <div
                    className="text-xs text-ink-ghost"
                    title="本轮战报会随画像回写，导师可见你的假名薄弱项"
                  >
                    本轮 {drillCorrect}/{drillAnswered} ·{' '}
                    {Math.round((drillCorrect / drillAnswered) * 100)}%
                  </div>
                )}
                {/* 自测题型切换 */}
                <select
                  value={drillMode}
                  onChange={(e) => {
                    sound.playClick();
                    setDrillMode(e.target.value as DrillMode);
                    setDrillRound((round) => round + 1);
                    setSelectedOption(null);
                    setIsAnswered(false);
                    setWordIndex(0);
                    setWordInput('');
                    setWordStudyDone(false);
                    resetRoundStats();
                  }}
                  className="text-xs rounded-lg border border-line-stone-300-stone-700 bg-surface-dim px-2 py-1"
                >
                  <option value="AUDIO_TO_KANA">听音辨字</option>
                  <option value="KANA_TO_ROMAJI">看字辨音</option>
                  <option value="HIRA_TO_KATA">平片互转</option>
                  <option value="MIXED">综合混合</option>
                  <option value="WORD_DICTATION">单词听写</option>
                  <option value="WORD_MEANING">词义回想</option>
                </select>
                {!isWordMode && (
                  <select
                    value={drillCount}
                    onChange={(e) => {
                      sound.playClick();
                      setDrillCount(Number(e.target.value));
                      setDrillRound((round) => round + 1);
                      setDrillIndex(0);
                      setSelectedOption(null);
                      setIsAnswered(false);
                      resetRoundStats();
                    }}
                    title="每轮题量"
                    className="text-xs rounded-lg border border-line-stone-300-stone-700 bg-surface-dim px-2 py-1"
                  >
                    <option value={10}>10 题</option>
                    <option value={20}>20 题</option>
                    <option value={50}>50 题</option>
                    <option value={0}>全部</option>
                  </select>
                )}
              </div>
            </div>

            {/* 题干区域 */}
            {isWordMode ? (
              <div className="text-center py-6 space-y-4">
                {!currentWord ? (
                  <p className="text-xs text-ink-stone-500">
                    {generateWords.isPending ? '正在从本地词典抽词…' : '暂无可用词语，请先安装日语词典包。'}
                  </p>
                ) : !wordStudyDone ? (
                  <div className="space-y-4">
                    <p className="text-xs text-ink-stone-500">先学：看读音释义、跟读两遍，再去测验</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentWord.kana}
                    </div>
                    <p className="text-sm text-ink-ghost">
                      {currentWord.headword}
                    </p>
                    <p className="text-sm text-ink-mute-deep">
                      {currentWord.meanings.join('；')}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <Button
                        onClick={() => {
                          sound.playClick();
                          void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'preview' });
                        }}
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        跟读
                      </Button>
                      <Button
                        onClick={() => {
                          sound.playClick();
                          setWordStudyDone(true);
                        }}
                        size="sm"
                        className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6"
                      >
                        记住了，去测验 ➔
                      </Button>
                    </div>
                  </div>
                ) : drillMode === 'WORD_DICTATION' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">听发音，用罗马字拼出假名（自动转换）：</p>
                    <button
                      onClick={() => {
                        sound.playClick();
                        void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'dictation' });
                      }}
                      className="mx-auto w-20 h-20 rounded-full bg-wash-amber-500o15 border-2 border-line-amber-500o30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-accent-ink-strong shadow-sm"
                    >
                      <Volume2 className="w-8 h-8" />
                    </button>
                    <p className="text-sm text-ink-faint">
                      词义提示：{currentWord.meanings.join('；')}
                    </p>
                    <p className="text-4xl font-serif font-bold text-ink min-h-[3rem]">
                      {wordInput
                        ? romajiToKana(wordInput, allKana, scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA') || '···'
                        : '···'}
                    </p>
                    <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
                      <input
                        value={wordInput}
                        onChange={(e) => setWordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSubmitWordInput();
                        }}
                        disabled={isAnswered}
                        placeholder="输入罗马字，如 ame（长音用 -，如 konpyu-ta-）"
                        className="flex-1 rounded-xl border border-line-stone-300-stone-700 bg-surface-dim px-3 py-2 text-sm font-mono"
                      />
                      {!isAnswered && (
                        <Button onClick={handleSubmitWordInput} size="sm" className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-5">
                          提交
                        </Button>
                      )}
                    </div>
                    {isAnswered && (
                      <p className="text-sm text-ink-faint">
                        正确答案：<span className="font-bold font-serif">{currentWord.kana}</span>
                        <span className="text-ink-stone-400">（{currentWord.headword}）</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">看单词，选择正确的中文释义：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentWord.kana}
                    </div>
                    <button
                      onClick={() => {
                        sound.playClick();
                        void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'preview' });
                      }}
                      className="text-xs text-accent-ink hover:underline"
                    >
                      🔊 播放发音
                    </button>
                    <div className="grid grid-cols-1 gap-3 pt-2 max-w-md mx-auto">
                      {meaningOptions.map((opt, idx) => {
                        const correct = currentWord.meanings[0] ?? '';
                        const isCorrectOpt = opt === correct;
                        const isSelected = selectedOption === opt;
                        let btnStyle =
                          'bg-tone-white dark:bg-tone-stone-800o80 border-line hover:border-tone-amber-500o50';
                        if (isAnswered) {
                          if (isCorrectOpt) {
                            btnStyle = 'bg-tone-emerald-500o15 border-tone-emerald-500 text-ink-emerald-800-emerald-300 font-bold';
                          } else if (isSelected) {
                            btnStyle = 'bg-wash-rose-500o15 border-tone-rose-500 text-ink-rose-800-rose-300';
                          } else {
                            btnStyle = 'opacity-40 border-line-soft';
                          }
                        }
                        return (
                          <button
                            key={idx}
                            onClick={() => handleSelectMeaningOption(opt)}
                            disabled={isAnswered}
                            className={`p-3 rounded-2xl border text-sm transition-all ${btnStyle}`}
                          >
                            <span>{opt}</span>
                            {isAnswered && isCorrectOpt && (
                              <CheckCircle2 className="w-4 h-4 text-tone-emerald-500 inline ml-2" />
                            )}
                            {isAnswered && isSelected && !isCorrectOpt && (
                              <XCircle className="w-4 h-4 text-tone-rose-500 inline ml-2" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 单词作答后操作区：转生词卡 / 换一批 / 下一词 */}
                {isAnswered && (
                  <div className="flex items-center justify-center gap-3 pt-4">
                    <Button
                      onClick={handleCollectWord}
                      disabled={collectEntry.isPending}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs text-accent-ink-strong"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      转生词卡
                    </Button>
                    <Button onClick={handleRefreshWords} variant="outline" size="sm" className="gap-1.5 text-xs">
                      <RefreshCw className="w-3.5 h-3.5" />
                      换一批
                    </Button>
                    <Button
                      onClick={handleNextWord}
                      size="sm"
                      className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6"
                    >
                      下一词 ➔
                    </Button>
                  </div>
                )}
              </div>
            ) : currentDrillKana ? (
              <div className="text-center py-6 space-y-4">
                {activeMode === 'AUDIO_TO_KANA' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-ink-stone-500">听发音，点击选择正确的假名：</p>
                    <button
                      onClick={() => handlePlayAudio(currentDrillKana)}
                      className="mx-auto w-20 h-20 rounded-full bg-wash-amber-500o15 border-2 border-line-amber-500o30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-accent-ink-strong shadow-sm"
                    >
                      <Volume2 className="w-8 h-8" />
                    </button>
                  </div>
                ) : activeMode === 'KANA_TO_ROMAJI' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-ink-stone-500">看假名，选择正确的罗马字发音：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {scriptMode === 'KATAKANA'
                        ? currentDrillKana.katakana
                        : currentDrillKana.hiragana}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-ink-stone-500">平假名 ➔ 选出对应的片假名：</p>
                    <div className="text-6xl font-serif font-bold text-ink">
                      {currentDrillKana.hiragana}
                    </div>
                  </div>
                )}

                {/* 选项矩阵 (4 选 1) */}
                <div className="grid grid-cols-2 gap-3 pt-4 max-w-md mx-auto">
                  {drillOptions.map((opt, idx) => {
                    let isCorrectOpt = false;
                    if (activeMode === 'AUDIO_TO_KANA') {
                      isCorrectOpt =
                        opt ===
                        (scriptMode === 'KATAKANA'
                          ? currentDrillKana.katakana
                          : currentDrillKana.hiragana);
                    } else if (activeMode === 'KANA_TO_ROMAJI') {
                      isCorrectOpt = opt === currentDrillKana.romaji;
                    } else {
                      isCorrectOpt = opt === currentDrillKana.katakana;
                    }

                    const isSelected = selectedOption === opt;
                    const optionKana = allKana.find((kana) => {
                      if (activeMode === 'KANA_TO_ROMAJI') return kana.romaji === opt;
                      if (activeMode === 'HIRA_TO_KATA') return kana.katakana === opt;
                      return (scriptMode === 'KATAKANA' ? kana.katakana : kana.hiragana) === opt;
                    });

                    let btnStyle =
                      'bg-tone-white dark:bg-tone-stone-800o80 border-line hover:border-tone-amber-500o50';
                    if (isAnswered) {
                      if (isCorrectOpt) {
                        btnStyle = 'bg-tone-emerald-500o15 border-tone-emerald-500 text-ink-emerald-800-emerald-300 font-bold';
                      } else if (isSelected) {
                        btnStyle = 'bg-wash-rose-500o15 border-tone-rose-500 text-ink-rose-800-rose-300';
                      } else {
                        btnStyle = 'opacity-40 border-line-soft';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleSelectDrillOption(opt)}
                        disabled={isAnswered}
                        className={`p-4 rounded-2xl border text-xl font-serif font-bold transition-all flex items-center justify-center gap-2 ${btnStyle}`}
                      >
                        <span className="flex flex-col items-center leading-tight">
                          <span>{opt}</span>
                          {isAnswered && activeMode !== 'KANA_TO_ROMAJI' && optionKana && (
                            <span className="text-xs font-mono font-normal text-ink-ghost">
                              {optionKana.romaji}
                            </span>
                          )}
                        </span>
                        {isAnswered && isCorrectOpt && (
                          <CheckCircle2 className="w-4 h-4 text-tone-emerald-500" />
                        )}
                        {isAnswered && isSelected && !isCorrectOpt && (
                          <XCircle className="w-4 h-4 text-tone-rose-500" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {isAnswered && activeMode !== 'KANA_TO_ROMAJI' && (
                  <p className="text-xs text-ink-ghost">
                    正确读音：<span className="font-mono font-semibold text-accent-ink-strong">{currentDrillKana.romaji}</span>
                  </p>
                )}

                {/* 作答后操作区 */}
                {isAnswered && (
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                    <Button
                      onClick={() =>
                        currentDrillKana &&
                        handleAskTutor(currentDrillKana, {
                          wasWrong: selectedOption !== drillCorrectAnswer,
                          ...(selectedOption ? { userPick: selectedOption } : {}),
                        })
                      }
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs text-accent-ink-strong"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      问 AI 导师
                    </Button>
                    <Button
                      type="button"
                      onClick={() => currentDrillKana && handleOpenKanaGuide(currentDrillKana)}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs text-accent-ink-strong"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      查看详情
                    </Button>
                    <Button
                      onClick={handleNextDrill}
                      disabled={practiceMutation.isPending}
                      size="sm"
                      className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs px-6"
                    >
                      下一题 ➔
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 space-y-4">
                <p className="text-xs text-ink-stone-500">
                  {isKanaLoading || adaptiveKanaQueueQuery.isLoading
                    ? '正在按练习记录组题…'
                    : '假名表为空：请确认网关已启动（默认 localhost:8080），然后重试。'}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={() => {
                      sound.playClick();
                      setIsDrillActive(false);
                    }}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    返回矩阵学习
                  </Button>
                  <Button
                    onClick={() => {
                      void refetchKana();
                    }}
                    size="sm"
                    className="bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs"
                  >
                    重新加载
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          /* ================= 矩阵导览模式 ================= */
          <motion.div
            key="matrix"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {groupedByRow.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {groupedByRow.map(({ rowName, items }) => (
                <div
                  key={rowName}
                  className="grid grid-cols-1 gap-3 rounded-2xl border border-line-amber-900o10 bg-paper-soft p-3.5 dark:border-wash-amber-500o10 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-stretch sm:p-4"
                >
                  <KanaRowLabel
                    rowName={rowName}
                    items={items}
                    scriptMode={scriptMode}
                    onOpen={() => handleOpenRowGuide(rowName, items)}
                  />

                  <div className="grid min-w-0 grid-cols-5 gap-2 sm:gap-3">
                    {items.map((kana) => {
                      const isActive = activeKana?.id === kana.id;
                      const cardHighlight = getKanaCardHighlight(kana);
                      return (
                        <div
                          key={kana.id}
                          onClick={() => handleSelectKana(kana)}
                          className={`group relative ${KANA_COLUMN_CLASSES[kana.col] ?? ''} flex flex-col items-center justify-center gap-1 rounded-xl border p-2.5 transition-all cursor-pointer select-none sm:p-3.5 ${
                            isActive
                              ? 'bg-wash-amber-500o15 border-tone-amber-500 shadow-sm'
                              : 'bg-tone-white dark:bg-tone-stone-800o80 border-line-stone-200o80-stone-700o80 hover:border-tone-amber-500o50 hover:shadow-sm'
                          }`}
                        >
                          {/* 假名主字面 */}
                          <div className="text-xl sm:text-2xl font-serif font-bold text-ink group-hover:scale-105 transition-transform flex items-baseline gap-1">
                            {scriptMode === 'HIRAGANA' && <span>{kana.hiragana}</span>}
                            {scriptMode === 'KATAKANA' && <span>{kana.katakana}</span>}
                            {scriptMode === 'BOTH' && (
                              <>
                                <span>{kana.hiragana}</span>
                                <span className="text-xs text-ink-stone-400 font-sans font-normal">
                                  / {kana.katakana}
                                </span>
                              </>
                            )}
                          </div>

                          {/* 罗马音辅助注记 */}
                          {showRomaji && (
                            <div className="text-[11px] font-mono text-ink-stone-400 group-hover:text-accent-ink">
                              {kana.romaji}
                            </div>
                          )}

                          {cardHighlight && (
                            <Badge
                              variant="amber"
                              className="max-w-full truncate px-1.5 py-0 text-[9px] leading-4"
                            >
                              {cardHighlight}
                            </Badge>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenKanaGuide(kana);
                            }}
                            className="mt-1 h-6 rounded-lg px-2 text-[10px] text-tone-amber-700 hover:bg-wash-amber-500o15 dark:text-ink-amber-300"
                            aria-label={`查看 ${kana.hiragana} 的发音与记忆详情`}
                          >
                            <Lightbulb className="h-3 w-3" />
                            详情
                          </Button>

                          {/* 试听按钮在桌面端悬停显示，在触摸设备上保持可见 */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => handlePlayAudio(kana, event)}
                            className="absolute right-1 top-1 h-7 w-7 rounded-lg p-0 text-ink-stone-400 opacity-70 transition-opacity hover:text-tone-amber-600 sm:opacity-0 sm:group-hover:opacity-100"
                            title="播放发音"
                            aria-label={`播放 ${kana.hiragana} 发音`}
                          >
                            <Volume2 className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-line-amber-900o10 bg-paper-soft p-6 text-center dark:border-wash-amber-500o10">
                <p className="text-xs leading-relaxed text-ink-ghost">
                  {isKanaLoading
                    ? '正在加载假名表…'
                    : '假名表暂时不可用，请确认网关已启动（默认 localhost:8080），然后重试。'}
                </p>
                {!isKanaLoading && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void refetchKana();
                    }}
                    className="mt-3"
                  >
                    重新加载
                  </Button>
                )}
              </div>
            )}


          </motion.div>
        )}
      </AnimatePresence>

      <KanaMemoryGuideDialog
        open={isMemoryGuideOpen}
        onOpenChange={setIsMemoryGuideOpen}
      />

      {activeRowGuide && (
        <KanaRowGuideDialog
          open
          onOpenChange={(open) => {
            if (!open) setActiveRowGuide(null);
          }}
          rowName={activeRowGuide.rowName}
          items={activeRowGuide.items}
          scriptMode={scriptMode}
        />
      )}

      <Dialog
        open={isKanaGuideOpen && Boolean(activeKana)}
        onOpenChange={setIsKanaGuideOpen}
      >
        {isKanaGuideOpen && activeKana && (
          <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
            <DialogHeader className="pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="amber" className="text-xs">
                  假名讲义
                </Badge>
                <span className="text-xs text-ink-ghost">
                  {activeKana.row} · {activeKana.col}
                </span>
              </div>
              <DialogTitle className="text-xl sm:text-2xl">
                {activeKana.hiragana} · {activeKana.katakana} 怎么读、怎么记？
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                先记住：假名通常不像汉字那样有独立“含义”，它首先表示一个发音单位；真正的词义要看它组成的单词。
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-tone-amber-500o25 bg-wash-amber-500o10 p-4 dark:bg-wash-amber-500o15 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-20 min-w-20 shrink-0 flex-col items-center justify-center rounded-2xl border border-line-amber-500o30 bg-tone-amber-500o20 text-ink">
                    <div className="flex items-baseline gap-1 text-3xl font-serif font-bold">
                      {scriptMode === 'BOTH' ? (
                        <>
                          <span>{activeKana.hiragana}</span>
                          <span className="text-sm text-ink-ghost">
                            / {activeKana.katakana}
                          </span>
                        </>
                      ) : scriptMode === 'KATAKANA' ? (
                        activeKana.katakana
                      ) : (
                        activeKana.hiragana
                      )}
                    </div>
                    <span className="mt-0.5 text-xs font-mono text-accent-ink-strong">
                      {activeKana.romaji}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-mute-deep">
                      一个发音单位 · {activeKana.romaji}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                      先把声音、字形和口形绑定起来，再用下面的例词确认它在词中的读法。
                    </p>
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handlePlayAudio(activeKana)}
                    className="flex-1 gap-1 text-xs sm:flex-none"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    朗读发音
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAskTutor(activeKana)}
                    className="flex-1 gap-1 bg-tone-amber-600 text-xs text-tone-white hover:bg-tone-amber-700 sm:flex-none"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    AI 假名点拨
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-line-amber-900o10 bg-veil-whiteo70-stone-900o35 p-3 dark:border-wash-amber-500o10">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink-deep">
                    <Info className="h-3.5 w-3.5 text-accent-ink" />
                    发音抓手
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    {activeKana.learningGuide?.soundDescription ??
                      `它表示 ${activeKana.romaji} 这一拍，先把声音和字形绑定起来。`}
                  </p>
                </div>

                <div className="rounded-xl border border-line-amber-900o10 bg-veil-whiteo70-stone-900o35 p-3 dark:border-wash-amber-500o10">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink-deep">
                    <Lightbulb className="h-3.5 w-3.5 text-accent-ink" />
                    记忆窍门
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    {activeKana.learningGuide?.memoryTip ??
                      `先把 ${activeKana.romaji} 的声音和字形绑定，再用例词重复认读。`}
                  </p>
                </div>

                <div className="rounded-xl border border-line-amber-900o10 bg-veil-whiteo70-stone-900o35 p-3 dark:border-wash-amber-500o10">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink-deep">
                    <Mic2 className="h-3.5 w-3.5 text-accent-ink" />
                    发音动作
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    {activeKana.learningGuide?.pronunciationTip ??
                      '保持短而清楚的一拍，不要拖成长音，也不要额外添加中文声调。'}
                  </p>
                </div>

                <div className="rounded-xl border border-line-amber-900o10 bg-veil-whiteo70-stone-900o35 p-3 dark:border-wash-amber-500o10">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink-deep">
                    <GitCompareArrows className="h-3.5 w-3.5 text-accent-ink" />
                    易混淆对照
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    {activeKana.learningGuide?.confusionNotes ??
                      '先看收笔方向和是否有圆圈，再结合罗马字与例词确认。'}
                  </p>
                  {activeKanaConfusions.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-accent-ink-strong">
                      本表形近对照：{activeKanaConfusions.join('、')}
                    </p>
                  )}
                </div>
              </div>

              {activeKana.mnemonic && (
                <p className="text-[11px] text-ink-ghost">
                  字源/来源：{activeKana.mnemonic}
                </p>
              )}

              {(activeKana.learningGuide?.exampleWords ?? []).length > 0 && (
                <div className="rounded-xl border border-line-amber-900o10 bg-veil-whiteo55-stone-900o25 p-3 dark:border-wash-amber-500o10">
                  <div className="mb-2 text-xs font-bold text-ink-deep">
                    放进词里记
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(activeKana.learningGuide?.exampleWords ?? []).map((exampleWord, index) => (
                      <Button
                        key={`${exampleWord.word}-${index}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          sound.playClick();
                          void speechStudio.speak(exampleWord.reading, {
                            lang: 'JA',
                            purpose: 'preview',
                          });
                        }}
                        className="h-auto min-h-8 justify-start rounded-lg bg-veil-whiteo80 px-2.5 py-1.5 text-left whitespace-normal dark:bg-veil-stone-800o70"
                        title="播放例词发音"
                        aria-label={`播放例词 ${exampleWord.word} 的发音`}
                      >
                        <span className="text-sm font-serif font-semibold text-ink">
                          {exampleWord.word}
                        </span>
                        <span className="text-[11px] font-mono text-ink-ghost">
                          {exampleWord.reading}
                        </span>
                        <span className="text-[11px] text-ink-faint">
                          · {exampleWord.meaning}
                        </span>
                        <Volume2 className="h-3 w-3 text-accent-ink" />
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-ink-ghost">
                基础讲解来自应用内置课程资产；想结合你的错误记录换一种说法，再点击“AI 假名点拨”。
              </p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
