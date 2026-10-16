import { motion } from 'framer-motion';
import { Volume2, CheckCircle2, XCircle, Bot } from 'lucide-react';
import { Button } from '../ui/button.js';
import { speechStudio } from '../../utils/audio.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';
import type { HangulDrill } from './useHangulDrill.js';

interface LetterDrillProps {
  drill: HangulDrill;
  onOpenTutor?: ((ctx: AiTutorContext) => void) | undefined;
}

/** 字母自测（纯展示）：听音/看字作答、反馈与导航。 */
export function HangulLetterDrill({ drill, onOpenTutor }: LetterDrillProps) {
  const { current, activeMode, options, correctAnswer, selectedOption, isAnswered, drillIndex, plan } = drill;
  if (!current) return null;
  const askTutor = () => {
    if (!onOpenTutor) return;
    onOpenTutor({
      questionText: `谚文「${current.jamo}」（${current.name}，罗马字 ${current.romanization}）的发音与构形，请讲解。`,
      correctAnswer: `${current.jamo} = ${current.romanization}`,
      skillTag:
        current.type === 'VOWEL'
          ? 'ko.hangul.vowel'
          : current.type === 'CONSONANT'
            ? 'ko.hangul.consonant'
            : 'ko.hangul.compound',
      explanation: current.mnemonic ?? '',
    });
  };
  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-ghost">
        第 {drillIndex + 1} / {plan.length} 题 · {activeMode === 'AUDIO_TO_JAMO' ? '听发音选字母' : '看字母选罗马字'}
      </div>
      {activeMode === 'AUDIO_TO_JAMO' ? (
        <Button
          variant="outline"
          size="lg"
          onClick={() => void speechStudio.speak(current.audioText || current.jamo, { lang: 'KO', purpose: 'dictation' })}
        >
          <Volume2 className="h-5 w-5 mr-2" />
          重播发音
        </Button>
      ) : (
        <div className="text-5xl font-bold text-center py-2">{current.jamo}</div>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="字母选项">
        {options.map((opt) => {
          const isCorrectOpt = opt === correctAnswer;
          const isPicked = opt === selectedOption;
          return (
            <button
              key={opt}
              disabled={isAnswered}
              onClick={() => drill.answer(opt)}
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
            {selectedOption === correctAnswer ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-tone-emerald-600" />
                回答正确 · {current.jamo}（{current.name}）= {current.romanization}
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-ink-rose-600" />
                正确答案：{correctAnswer} · {current.jamo}（{current.name}）
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={drill.savePending || !!drill.saveError} onClick={drill.next}>
              {drillIndex + 1 >= plan.length ? '查看战报' : '下一题'}
            </Button>
            {onOpenTutor && (
              <Button size="sm" variant="outline" onClick={askTutor}>
                <Bot className="h-3.5 h-3.5 mr-1" />
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
