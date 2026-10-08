import React, { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { sound, speechStudio } from "../utils/audio.js";
import { fireSuccessConfetti } from "../components/magicui/index.js";
import { useCurriculumKanaQuery, useAdaptiveKanaQueueQuery, useKanaPracticeMutation, useGenerateKanaWordsMutation, useCollectDictionaryEntryMutation, type KanaWordItem } from "../queries/useLearnerQueries.js";
import { romajiToKana, toHiragana } from "../lib/kana-input.js";
import { playKanaAudio } from "../lib/kana-audio.js";
import { confusionDistractorItems } from "../lib/kana-confusion.js";
import { buildKanaTutorContext } from "../lib/kana-tutor.js";
import type { KanaItem } from "@study-studio/protocol";
import type { AiTutorContext } from '../components/AiTutorDrawer.js';
import { unitsForTrack } from '@study-studio/learner-core';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import type { MatrixTab, ScriptDisplayMode, DrillMode, RecognitionMode } from '../components/kana-studio/types.js';
const RECOGNITION_MODES: RecognitionMode[] = ['AUDIO_TO_KANA', 'KANA_TO_ROMAJI', 'HIRA_TO_KATA'];
function guessWordScript(kana: string): 'HIRAGANA' | 'KATAKANA' {
    const hasKata = /[\u30A0-\u30FF]/.test(kana);
    const hasHira = /[\u3040-\u309F]/.test(kana);
    return hasKata && !hasHira ? 'KATAKANA' : 'HIRAGANA';
}
export function useKanaStudio(onOpenTutor?: (ctx: AiTutorContext) => void) {
    const intent = useStudySessionStore(s => s.planIntent);
    const unit = unitsForTrack('ja').find(u => u.id === intent?.courseUnitId);
    const focusKanaIds = unit?.evidence.type === 'kana-coverage' ? unit.evidence.kanaIds : undefined;
    const { data: allKana = [], refetch: refetchKana, isLoading: isKanaLoading } = useCurriculumKanaQuery();
    const practiceMutation = useKanaPracticeMutation();
    const [selectedMatrixTab, setMatrixTab] = useState<MatrixTab>('SEION');
    const focusType = allKana.find(k => focusKanaIds?.includes(k.id))?.type;
    const matrixTab: MatrixTab = focusType ? focusType === 'YOON' ? 'YOON' : focusType === 'DAKUON' || focusType === 'HANDAKUON' ? 'DAKUON_HANDAKUON' : 'SEION' : selectedMatrixTab;
    const [scriptMode, setScriptMode] = useState<ScriptDisplayMode>(intent?.skillId === 'jp.kana.katakana' ? 'KATAKANA' : 'HIRAGANA');
    const [showRomaji, setShowRomaji] = useState(true);
    const [activeKana, setActiveKana] = useState<KanaItem | null>(null);
    const [isKanaGuideOpen, setIsKanaGuideOpen] = useState(false);
    const [isMemoryGuideOpen, setIsMemoryGuideOpen] = useState(false);
    const [activeRowGuide, setActiveRowGuide] = useState<{
        rowName: string;
        items: readonly KanaItem[];
    } | null>(null);
    const [isDrillActive, setIsDrillActive] = useState(false);
    const [drillMode, setDrillMode] = useState<DrillMode>('AUDIO_TO_KANA');
    const [drillIndex, setDrillIndex] = useState(0);
    const [drillStreak, setDrillStreak] = useState(0);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [drillCount, setDrillCount] = useState<number>(10);
    const [drillRound, setDrillRound] = useState(0);
    const [drillAnswered, setDrillAnswered] = useState(0);
    const [drillCorrect, setDrillCorrect] = useState(0);
    const resetRoundStats = () => {
        setDrillAnswered(0);
        setDrillCorrect(0);
    };
    const generateWords = useGenerateKanaWordsMutation();
    const collectEntry = useCollectDictionaryEntryMutation();
    const [wordList, setWordList] = useState<KanaWordItem[]>([]);
    const [wordIndex, setWordIndex] = useState(0);
    const [wordInput, setWordInput] = useState('');
    const [wordStudyDone, setWordStudyDone] = useState(false);
    const isWordMode = drillMode === 'WORD_DICTATION' || drillMode === 'WORD_MEANING';
    const currentWord: KanaWordItem | undefined = wordList[wordIndex];
    useEffect(() => {
        if (!isDrillActive || !isWordMode || wordList.length > 0 || generateWords.isPending)
            return;
        generateWords.mutate({ count: 8, script: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA' }, {
            onSuccess: (words) => {
                setWordList(words);
                setWordIndex(0);
            },
            onError: () => {
                toast.error('假名单词加载失败，请稍后重试。');
            },
        });
    }, [isDrillActive, isWordMode, wordList.length, scriptMode, generateWords.isPending, generateWords.mutate]);
    useEffect(() => {
        if (!isDrillActive || drillMode !== 'WORD_DICTATION' || !currentWord)
            return;
        void speechStudio.speak(currentWord.audioText || currentWord.kana, { lang: 'JA', purpose: 'dictation' });
    }, [isDrillActive, drillMode, currentWord]);
    const filteredKanaList = useMemo(() => {
        if (focusKanaIds)
            return allKana.filter(k => focusKanaIds.includes(k.id));
        if (matrixTab === 'SEION') {
            return allKana.filter((k) => k.type === 'SEION' || k.type === 'SPECIAL');
        }
        if (matrixTab === 'DAKUON_HANDAKUON') {
            return allKana.filter((k) => k.type === 'DAKUON' || k.type === 'HANDAKUON');
        }
        return allKana.filter((k) => k.type === 'YOON');
    }, [allKana, matrixTab, focusKanaIds]);
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
    const handlePlayAudio = (kana: KanaItem, e?: React.MouseEvent) => {
        e?.stopPropagation();
        sound.playClick();
        void playKanaAudio(kana).then((played) => {
            if (!played)
                void speechStudio.speak(kana.audioText, { lang: 'JA', purpose: 'preview' });
        });
    };
    const handleSelectKana = (kana: KanaItem) => {
        handlePlayAudio(kana);
        setActiveKana(kana);
    };
    const handleOpenKanaGuide = (kana: KanaItem) => {
        handleSelectKana(kana);
        setIsKanaGuideOpen(true);
    };
    const handleOpenRowGuide = (rowName: string, items: readonly KanaItem[]) => {
        sound.playClick();
        setActiveRowGuide({ rowName, items });
    };
    const adaptiveKanaTypes = useMemo<readonly string[]>(() => {
        if (matrixTab === 'SEION')
            return ['SEION', 'SPECIAL'];
        if (matrixTab === 'DAKUON_HANDAKUON')
            return ['DAKUON', 'HANDAKUON'];
        return ['YOON'];
    }, [matrixTab]);
    const adaptiveKanaQueueQuery = useAdaptiveKanaQueueQuery({
        types: adaptiveKanaTypes,
        ...(focusKanaIds ? { kanaIds: focusKanaIds } : {}),
        scriptType: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
        limit: drillCount,
        round: drillRound,
        enabled: isDrillActive && !isWordMode,
    });
    const drillItems = adaptiveKanaQueueQuery.data ?? [];
    const currentDrillKana: KanaItem | undefined = drillItems[drillIndex];
    const mixedPlan = useMemo<RecognitionMode[]>(() => {
        if (drillMode !== 'MIXED')
            return [];
        return drillItems.map(() => RECOGNITION_MODES[Math.floor(Math.random() * RECOGNITION_MODES.length)]!);
    }, [drillMode, drillItems]);
    const activeMode: DrillMode = drillMode === 'MIXED' ? (mixedPlan[drillIndex] ?? 'AUDIO_TO_KANA') : drillMode;
    const drillOptions = useMemo(() => {
        if (!currentDrillKana || drillItems.length === 0)
            return [];
        let correctAnswer = '';
        if (activeMode === 'AUDIO_TO_KANA') {
            correctAnswer = scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana;
        }
        else if (activeMode === 'KANA_TO_ROMAJI') {
            correctAnswer = currentDrillKana.romaji;
        }
        else {
            correctAnswer = currentDrillKana.katakana;
        }
        const pool = filteredKanaList.length >= 4 ? filteredKanaList : allKana.length > 0 ? allKana : drillItems;
        const distractorScript = activeMode === 'HIRA_TO_KATA' || scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA';
        const distractorItems = confusionDistractorItems(currentDrillKana, pool, distractorScript, activeMode === 'KANA_TO_ROMAJI' ? 6 : 3);
        const distractors = activeMode === 'KANA_TO_ROMAJI'
            ? (() => {
                const seen = new Set([correctAnswer]);
                const values: string[] = [];
                for (const item of distractorItems) {
                    if (seen.has(item.romaji))
                        continue;
                    seen.add(item.romaji);
                    values.push(item.romaji);
                    if (values.length === 3)
                        break;
                }
                return values;
            })()
            : distractorItems.map((item) => distractorScript === 'KATAKANA' ? item.katakana : item.hiragana);
        return [correctAnswer, ...distractors].sort(() => 0.5 - Math.random());
    }, [currentDrillKana, drillItems, allKana, filteredKanaList, activeMode, scriptMode]);
    const drillCorrectAnswer = useMemo(() => {
        if (!currentDrillKana)
            return '';
        if (activeMode === 'AUDIO_TO_KANA') {
            return scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana;
        }
        if (activeMode === 'KANA_TO_ROMAJI') {
            return currentDrillKana.romaji;
        }
        return currentDrillKana.katakana;
    }, [currentDrillKana, activeMode, scriptMode]);
    const handleSelectDrillOption = async (option: string) => {
        if (isAnswered || practiceMutation.isPending || !currentDrillKana)
            return;
        setSelectedOption(option);
        setIsAnswered(true);
        let isCorrect = false;
        if (activeMode === 'AUDIO_TO_KANA') {
            isCorrect =
                option ===
                    (scriptMode === 'KATAKANA' ? currentDrillKana.katakana : currentDrillKana.hiragana);
        }
        else if (activeMode === 'KANA_TO_ROMAJI') {
            isCorrect = option === currentDrillKana.romaji;
        }
        else {
            isCorrect = option === currentDrillKana.katakana;
        }
        try {
            await practiceMutation.mutateAsync({
                kanaId: currentDrillKana.id, isCorrect,
                scriptType: scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA',
            });
        }
        catch (error) {
            setSelectedOption(null);
            setIsAnswered(false);
            toast.error(error instanceof Error ? error.message : '练习保存失败，请重试。');
            return;
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
        }
        else {
            sound.playMistake();
            setDrillStreak(0);
            toast.error(`回答有误，正确答案为: ${currentDrillKana.hiragana} (${currentDrillKana.romaji})`);
        }
    };
    const handleNextDrill = () => {
        sound.playClick();
        setSelectedOption(null);
        setIsAnswered(false);
        if (drillIndex < drillItems.length - 1) {
            setDrillIndex((i) => i + 1);
        }
        else {
            fireSuccessConfetti();
            toast.success('恭喜完成本轮假名自测！');
            setDrillIndex(0);
            setDrillRound((round) => round + 1);
            resetRoundStats();
        }
    };
    const meaningOptions = useMemo(() => {
        if (!currentWord)
            return [];
        const correct = currentWord.meanings[0] ?? '';
        const distractors = wordList
            .filter((w) => w.id !== currentWord.id)
            .map((w) => w.meanings[0] ?? '')
            .filter((m) => m && m !== correct)
            .slice(0, 3);
        return [correct, ...distractors].sort(() => 0.5 - Math.random());
    }, [currentWord, wordList]);
    const recordWordResult = (isCorrect: boolean) => {
        if (!currentWord)
            return;
        practiceMutation.mutate({
            kanaId: currentWord.entryId,
            isCorrect,
            scriptType: guessWordScript(currentWord.kana),
        });
    };
    const handleSubmitWordInput = () => {
        if (isAnswered || !currentWord)
            return;
        const converted = romajiToKana(wordInput.trim(), allKana, scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA');
        const isCorrect = converted !== '' && toHiragana(converted) === toHiragana(currentWord.kana);
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
        }
        else {
            sound.playMistake();
            setDrillStreak(0);
            toast.error(`拼写有误，正确答案为: ${currentWord.kana}`);
        }
        recordWordResult(isCorrect);
    };
    const handleSelectMeaningOption = (option: string) => {
        if (isAnswered || !currentWord)
            return;
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
        }
        else {
            sound.playMistake();
            setDrillStreak(0);
            toast.error(`回答有误，正确释义为: ${correct}`);
        }
        recordWordResult(isCorrect);
    };
    const handleCollectWord = () => {
        if (!currentWord)
            return;
        collectEntry.mutate(currentWord.entryId, {
            onSuccess: () => toast.success(`已加入生词本：${currentWord.headword}`),
            onError: () => toast.error('加入生词本失败，请稍后重试。'),
        });
    };
    const handleNextWord = () => {
        sound.playClick();
        setSelectedOption(null);
        setIsAnswered(false);
        setWordInput('');
        setWordStudyDone(false);
        if (wordIndex < wordList.length - 1) {
            setWordIndex((i) => i + 1);
        }
        else {
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
    const handleAskTutor = (kana: KanaItem, extra?: {
        wasWrong?: boolean;
        userPick?: string | null;
        script?: 'HIRAGANA' | 'KATAKANA';
    }) => {
        sound.playClick();
        onOpenTutor?.(buildKanaTutorContext({
            kana,
            pool: allKana,
            script: extra?.script ?? (scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA'),
            ...(extra?.wasWrong ? { wasWrong: true as const } : {}),
            ...(extra?.userPick ? { userPick: extra.userPick } : {}),
        }));
    };
    return { focusKanaIds, allKana, refetchKana, isKanaLoading, practiceMutation, matrixTab, setMatrixTab, scriptMode, setScriptMode, showRomaji, setShowRomaji, activeKana, setActiveKana, isKanaGuideOpen, setIsKanaGuideOpen, isMemoryGuideOpen, setIsMemoryGuideOpen, activeRowGuide, setActiveRowGuide, isDrillActive, setIsDrillActive, drillMode, setDrillMode, drillIndex, setDrillIndex, drillStreak, setDrillStreak, selectedOption, setSelectedOption, isAnswered, setIsAnswered, drillCount, setDrillCount, drillRound, setDrillRound, drillAnswered, setDrillAnswered, drillCorrect, setDrillCorrect, resetRoundStats, generateWords, collectEntry, wordList, setWordList, wordIndex, setWordIndex, wordInput, setWordInput, wordStudyDone, setWordStudyDone, isWordMode, currentWord, filteredKanaList, groupedByRow, handlePlayAudio, handleSelectKana, handleOpenKanaGuide, handleOpenRowGuide, adaptiveKanaTypes, adaptiveKanaQueueQuery, drillItems, currentDrillKana, mixedPlan, activeMode, drillOptions, drillCorrectAnswer, handleSelectDrillOption, handleNextDrill, meaningOptions, recordWordResult, handleSubmitWordInput, handleSelectMeaningOption, handleCollectWord, handleNextWord, handleRefreshWords, handleAskTutor };
}
export type KanaStudioState = ReturnType<typeof useKanaStudio>;
