import { motion } from 'framer-motion';
import { Volume2, CheckCircle2, XCircle, Bot, BookOpen, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { speechStudio } from '../../utils/audio.js';
import { useCollectDictionaryEntryMutation } from '../../queries/useLearnerQueries.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';
import type { HangulDrill } from './useHangulDrill.js';

interface WordDrillProps {
  drill: HangulDrill;
  onOpenTutor?: ((ctx: AiTutorContext) => void) | undefined;
}

/** 单词巩固（纯展示）：听写选词/词义回想、失败引导、收藏与导航。 */
export function HangulWordDrill({ drill, onOpenTutor }: WordDrillProps) {
  const collectEntry = useCollectDictionaryEntryMutation();
  const { currentWord, wordOptions, wordCorrectAnswer, selectedOption, isAnswered, wordIndex, wordList, drillMode, wordFailed } = drill;

  if (wordFailed && wordList.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center space-y-2">
        <BookOpen className="h-6 w-6 mx-auto text-ink-ghost" />
        <div className="text-sm font-medium">韩语单词读取失败</div>
        <div className="text-xs text-ink-ghost leading-relaxed">
          请重试。若尚未安装韩语词典包，可到「设置 → 词典」检查；字母自测不受影响。
        </div>
        <Button variant="outline" size="sm" onClick={drill.retryWords}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          重试
        </Button>
      </div>
    );
  }

  if (!currentWord) {
    return (
      <div className="rounded-xl border p-8 text-center text-sm text-ink-ghost">
        {drill.wordsLoaded ? '本次没有可用韩语单词，可返回矩阵或重新开始。' : '韩语单词加载中…'}
      </div>
    );
  }

  const askTutorWord = () => {
    if (!onOpenTutor) return;
    onOpenTutor({
      questionText: `韩语单词「${currentWord.korean}」（${currentWord.meanings.join('；')}），请讲解用法与常见搭配。`,
      correctAnswer: `${currentWord.korean} = ${currentWord.meanings[0] ?? ''}`,
      skillTag: 'ko.hangul.compound',
      explanation: `来源：${currentWord.sourceLabel}`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-ghost">
        第 {wordIndex + 1} / {wordList.length} 词 · {drillMode === 'WORD_DICTATION' ? '听发音选单词（四选一，无需输入法）' : '看单词选英文释义'}
      </div>
      {drill.drillMode === 'WORD_DICTATION' ? (
        <Button
          variant="outline"
          size="lg"
          onClick={() => void speechStudio.speak(currentWord.audioText || currentWord.korean, { lang: 'KO', purpose: 'dictation' })}
        >
          <Volume2 className="h-5 w-5 mr-2" />
          重播发音
        </Button>
      ) : (
        <div className="text-4xl font-bold text-center py-2">{currentWord.korean}</div>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="单词选项">
        {wordOptions.map((opt) => {
          const isCorrectOpt = opt === wordCorrectAnswer;
          const isPicked = opt === selectedOption;
          return (
            <button
              key={opt}
              disabled={isAnswered}
              onClick={() => drill.answerWord(opt)}
              aria-pressed={isPicked}
              className={`rounded-xl border p-3 text-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                isAnswered && isCorrectOpt
                  ? 'border-tone-emerald-500 bg-wash-emerald-500o10'
                  : isAnswered && isPicked
                    ? 'border-tone-rose-500 bg-wash-rose-500o10'
                    : 'hover:border-line-hairline-strong'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {isAnswered && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {selectedOption === wordCorrectAnswer ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-tone-emerald-600" />
                回答正确 · {currentWord.korean} = {currentWord.meanings.join('；')}
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-ink-rose-600" />
                正确答案：{wordCorrectAnswer} · {currentWord.korean} = {currentWord.meanings.join('；')}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={drill.savePending || !!drill.saveError} onClick={drill.nextWord}>
              {wordIndex + 1 >= wordList.length ? '查看战报' : '下一词'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={collectEntry.isPending}
              onClick={() =>
                collectEntry.mutate(currentWord.entryId, {
                  onSuccess: () => toast.success('已加入生词本，可到闪卡复习。'),
                  onError: () => toast.error('加入生词本失败，请稍后重试。'),
                })
              }
            >
              <BookOpen className="h-3.5 w-3.5 mr-1" />
              {collectEntry.isPending ? '加入中…' : '转生词卡'}
            </Button>
            {onOpenTutor && (
              <Button size="sm" variant="outline" onClick={askTutorWord}>
                <Bot className="h-3.5 w-3.5 mr-1" />
                问 AI 老师
              </Button>
            )}
          </div>
          {drill.savePending && <p role="status" className="text-xs text-ink-ghost">正在保存本题成绩…</p>}
          {drill.saveError && <div role="alert" className="text-xs text-ink-rose-600">{drill.saveError}<Button size="sm" variant="outline" onClick={drill.retrySave}>重试保存</Button></div>}
        </motion.div>
      )}
    </div>
  );
}
