import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sound, speechStudio } from '../../utils/audio.js';
import { fireSuccessConfetti } from '../magicui/index.js';
import type { HangulItem } from '@study-studio/protocol';
import {
  useHangulPracticeMutation,
  useGenerateHangulWordsMutation,
  type HangulWordItem,
} from '../../queries/useLearnerQueries.js';
import {
  shuffle,
  pickDistractors,
  scriptTypeFor,
  RECOGNITION_MODES,
  type DrillMode,
  type RecognitionMode,
} from './hangul-drill.js';

interface HangulDrillInput {
  pool: HangulItem[];
  allHangul: HangulItem[];
}

/**
 * 谚文自测状态机：字母/单词两套作答计分、回写失败计数、迟到播报隔离。
 * 评分口径（抽题/干扰项/题量/技能映射）与原实现一致；成绩回写失败不再
 * 伪装成功，计入 writeFailed 并在战报中如实说明。
 */
export function useHangulDrill({ pool, allHangul }: HangulDrillInput) {
  const practiceMutation = useHangulPracticeMutation();

  const [drillMode, setDrillMode] = useState<DrillMode>('AUDIO_TO_JAMO');
  const [drillCount, setDrillCount] = useState<number>(10);
  const [isDrillActive, setIsDrillActive] = useState(false);
  const [plan, setPlan] = useState<HangulItem[]>([]);
  const [drillPool, setDrillPool] = useState<HangulItem[]>([]);
  const [mixedPlan, setMixedPlan] = useState<RecognitionMode[]>([]);
  const [drillIndex, setDrillIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [drillAnswered, setDrillAnswered] = useState(0);
  const [drillCorrect, setDrillCorrect] = useState(0);
  const [roundDone, setRoundDone] = useState(false);
  // 回写失败计数：战报诚实说明，不宣称全部已回写
  const [writeFailed, setWriteFailed] = useState(0);
  // 同步作答锁：与 disabled 双重保护同 tick 连击
  const answeredRef = useRef(false);
  const roundEpoch = useRef(0);
  const mounted = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveState = useRef<'idle' | 'pending' | 'error'>('idle');
  const lastPractice = useRef<{ hangulId: string; isCorrect: boolean; scriptType: 'CONSONANT' | 'VOWEL' | 'COMPOUND' } | null>(null);
  const wordsLoading = useRef(false);
  const [wordsLoaded, setWordsLoaded] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; roundEpoch.current += 1; speechStudio.stop(); };
  }, []);

  // 单词巩固（听写选词 / 词义回想）：词表来自 Gateway 本地韩语词典包，未安装走显式引导
  const generateWords = useGenerateHangulWordsMutation();
  const [wordList, setWordList] = useState<HangulWordItem[]>([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [wordFailed, setWordFailed] = useState(false);
  const isWordMode = drillMode === 'WORD_DICTATION' || drillMode === 'WORD_MEANING';
  const currentWord: HangulWordItem | undefined = wordList[wordIndex];

  const current: HangulItem | undefined = plan[drillIndex];
  const activeMode: RecognitionMode =
    drillMode === 'MIXED'
      ? (mixedPlan[drillIndex] ?? 'AUDIO_TO_JAMO')
      : drillMode === 'JAMO_TO_ROMA'
        ? 'JAMO_TO_ROMA'
        : 'AUDIO_TO_JAMO';

  const options = useMemo(() => {
    if (!current) return [];
    const distractors = pickDistractors(current, drillPool);
    if (activeMode === 'AUDIO_TO_JAMO') {
      return shuffle([current.jamo, ...distractors.map((d) => d.jamo)]);
    }
    return shuffle([current.romanization, ...distractors.map((d) => d.romanization)]);
  }, [current, drillPool, activeMode, drillIndex]);

  const correctAnswer = current
    ? activeMode === 'AUDIO_TO_JAMO'
      ? current.jamo
      : current.romanization
    : '';

  // 听音题切出即自动播报
  useEffect(() => {
    if (!isDrillActive || roundDone || activeMode !== 'AUDIO_TO_JAMO' || !current) return;
    void speechStudio.speak(current.audioText || current.jamo, { lang: 'KO', purpose: 'dictation' });
  }, [isDrillActive, roundDone, activeMode, current, drillIndex]);

  // 单词模式：激活后词表为空即拉取（未安装词典包走 wordFailed 显式引导；题量跟随字母自测档，0=全部按 20 取）
  const loadWords = async () => {
    if (wordsLoading.current && isWordMode) return;
    wordsLoading.current = true;
    const epoch = roundEpoch.current;
    setWordFailed(false);
    setWordsLoaded(false);
    try {
      const words = await generateWords.mutateAsync({ count: drillCount > 0 ? drillCount : 20 });
      if (!mounted.current || epoch !== roundEpoch.current) return;
      setWordList(words);
      setWordIndex(0);
      setWordsLoaded(true);
    } catch {
      if (!mounted.current || epoch !== roundEpoch.current) return;
      setWordFailed(true);
      toast.error('韩语单词加载失败，请重试；如未安装词典包，可在设置中检查。');
    } finally { wordsLoading.current = false; }
  };

  // 听写选词：新词切出即自动播报（作答后不再重播）
  useEffect(() => {
    if (!isDrillActive || drillMode !== 'WORD_DICTATION' || !currentWord) return;
    void speechStudio.speak(currentWord.audioText || currentWord.korean, { lang: 'KO', purpose: 'dictation' });
  }, [isDrillActive, drillMode, currentWord]);

  const reportPractice = (hangulId: string, isCorrect: boolean, scriptType: 'CONSONANT' | 'VOWEL' | 'COMPOUND') => {
    if (saveState.current === 'pending') return;
    const wasFailed = saveState.current === 'error';
    const epoch = roundEpoch.current;
    const payload = { hangulId, isCorrect, scriptType };
    lastPractice.current = payload;
    saveState.current = 'pending';
    setSavePending(true);
    setSaveError(null);
    void practiceMutation.mutateAsync(payload).then(() => {
      if (!mounted.current || epoch !== roundEpoch.current) return;
      saveState.current = 'idle';
      if (wasFailed) setWriteFailed(n => Math.max(0, n - 1));
    }, () => {
      if (!mounted.current || epoch !== roundEpoch.current) return;
      saveState.current = 'error';
      if (!wasFailed) setWriteFailed(n => n + 1);
      setSaveError('练习成绩回写失败；本题作答已保留，可以重试保存。');
      toast.error('练习成绩回写失败；本题作答已保留。');
    }).finally(() => {
      if (mounted.current && epoch === roundEpoch.current) setSavePending(false);
    });
  };

  const startDrill = () => {
    if (wordsLoading.current && isWordMode) return;
    roundEpoch.current += 1;
    saveState.current = 'idle';
    setSavePending(false);
    setSaveError(null);
    lastPractice.current = null;
    setDrillIndex(0);
    setWordIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    answeredRef.current = false;
    setDrillAnswered(0);
    setDrillCorrect(0);
    setRoundDone(false);
    setWriteFailed(0);
    if (isWordMode) {
      // 单词模式：清空旧表，由 effect 拉取新一批（未安装词典包走显式引导）
      setWordList([]);
      setWordFailed(false);
      setIsDrillActive(true);
      void loadWords();
      sound.playClick();
      return;
    }
    const source = pool.length > 0 ? pool : allHangul;
    if (source.length === 0) {
      toast.error('谚文底座尚未加载，请稍后重试。');
      return;
    }
    const shuffled = shuffle(source);
    setDrillPool([...source]);
    const list = drillCount > 0 ? shuffled.slice(0, Math.min(drillCount, shuffled.length)) : shuffled;
    setPlan(list);
    setMixedPlan(list.map(() => RECOGNITION_MODES[Math.floor(Math.random() * RECOGNITION_MODES.length)]!));
    setDrillIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    answeredRef.current = false;
    setDrillAnswered(0);
    setDrillCorrect(0);
    setRoundDone(false);
    setIsDrillActive(true);
    sound.playClick();
  };

  const stopDrill = () => {
    roundEpoch.current += 1;
    speechStudio.stop();
    setIsDrillActive(false);
    setRoundDone(false);
    setWordFailed(false);
    answeredRef.current = false;
    sound.playClick();
  };

  const switchDrillMode = (mode: DrillMode) => {
    roundEpoch.current += 1;
    speechStudio.stop();
    setDrillMode(mode);
    setIsDrillActive(false);
    setRoundDone(false);
    answeredRef.current = false;
    sound.playClick();
  };

  const answer = (option: string) => {
    if (answeredRef.current || isAnswered || !current) return;
    answeredRef.current = true;
    const ok = option === correctAnswer;
    setSelectedOption(option);
    setIsAnswered(true);
    setDrillAnswered((n) => n + 1);
    if (ok) {
      setDrillCorrect((n) => n + 1);
      sound.playSuccess();
    } else {
      sound.playError();
    }
    reportPractice(current.id, ok, scriptTypeFor(current));
  };

  const next = () => {
    if (!isAnswered || saveState.current !== 'idle') return;
    if (drillIndex + 1 >= plan.length) {
      setRoundDone(true);
      const accuracy = drillAnswered > 0 ? drillCorrect / drillAnswered : 0;
      if (accuracy >= 0.8) fireSuccessConfetti();
      return;
    }
    setDrillIndex((i) => i + 1);
    setSelectedOption(null);
    setIsAnswered(false);
    answeredRef.current = false;
  };

  const accuracy = drillAnswered > 0 ? Math.round((drillCorrect / drillAnswered) * 100) : 0;

  // 单词选项（听写选词：韩语表层形四选一；词义回想：英文释义四选一；均无需输入法）
  // 同形/同释义条目去重（Kengdic 多词可同释义，否则出现重复 key 与歧义选项）
  const wordOptions = useMemo(() => {
    if (!currentWord) return [];
    if (drillMode === 'WORD_MEANING') {
      const correct = currentWord.meanings[0] ?? '';
      const distractors = [
        ...new Set(
          wordList
            .filter((w) => w.id !== currentWord.id)
            .map((w) => w.meanings[0] ?? '')
            .filter((m) => m && m !== correct)
        ),
      ].slice(0, 3);
      return shuffle([correct, ...distractors]);
    }
    const distractors = [
      ...new Set(
        wordList
          .filter((w) => w.id !== currentWord.id)
          .map((w) => w.korean)
          .filter((k) => k && k !== currentWord.korean)
      ),
    ].slice(0, 3);
    return shuffle([currentWord.korean, ...distractors]);
  }, [currentWord, wordList, drillMode, wordIndex]);

  const wordCorrectAnswer =
    currentWord != null
      ? drillMode === 'WORD_MEANING'
        ? (currentWord.meanings[0] ?? '')
        : currentWord.korean
      : '';

  /** 单词成绩记入 ko.hangul.compound（整词运用；entryId 仅作追踪，见 kana 同源实现）。 */
  const answerWord = (option: string) => {
    if (answeredRef.current || isAnswered || !currentWord) return;
    answeredRef.current = true;
    const ok = option === wordCorrectAnswer;
    setSelectedOption(option);
    setIsAnswered(true);
    setDrillAnswered((n) => n + 1);
    if (ok) {
      setDrillCorrect((n) => n + 1);
      sound.playSuccess();
    } else {
      sound.playError();
    }
    reportPractice(currentWord.entryId, ok, 'COMPOUND');
  };

  const nextWord = () => {
    if (!isAnswered || saveState.current !== 'idle') return;
    if (wordIndex + 1 >= wordList.length) {
      setRoundDone(true);
      const acc = drillAnswered > 0 ? drillCorrect / drillAnswered : 0;
      if (acc >= 0.8) fireSuccessConfetti();
      return;
    }
    setWordIndex((i) => i + 1);
    setSelectedOption(null);
    setIsAnswered(false);
    answeredRef.current = false;
  };

  const retryWords = () => {
    void loadWords();
    sound.playClick();
  };

  return {
    drillMode,
    drillCount,
    setDrillCount,
    isDrillActive,
    plan,
    drillIndex,
    selectedOption,
    isAnswered,
    drillAnswered,
    drillCorrect,
    roundDone,
    accuracy,
    writeFailed,
    savePending,
    saveError,
    wordsLoaded,
    retrySave: () => { if (lastPractice.current) reportPractice(lastPractice.current.hangulId, lastPractice.current.isCorrect, lastPractice.current.scriptType); },
    current,
    activeMode,
    options,
    correctAnswer,
    isWordMode,
    wordList,
    wordIndex,
    wordFailed,
    currentWord,
    wordOptions,
    wordCorrectAnswer,
    startDrill,
    stopDrill,
    switchDrillMode,
    answer,
    next,
    answerWord,
    nextWord,
    retryWords,
  };
}

export type HangulDrill = ReturnType<typeof useHangulDrill>;
