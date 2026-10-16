import React, { useRef, useState } from 'react';
import { Mic, Volume2, Bot, AlertCircle } from 'lucide-react';
import { sound, speechStudio } from '../utils/audio.js';
import { ShimmerButton } from './magicui/index.js';
import { Progress } from './ui/progress.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { usePitchLexiconQuery } from '../queries/useLearnerQueries.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { buildPitchTutorContext } from '../lib/pitch-tutor.js';
import { playKanaText } from '../lib/kana-audio.js';
import { usePitchRecorder } from './pitch-coach/usePitchRecorder.js';
import { PitchCanvasVisualizer } from './pitch-coach/PitchCanvasVisualizer.js';
import { PitchEvalScorecard } from './pitch-coach/PitchEvalScorecard.js';
import { PitchWordPicker } from './pitch-coach/PitchWordPicker.js';

interface PitchAccentCoachProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

/**
 * 声调教练：编排容器（数据 + 布局），绘制/录音/报告/词表下沉子模块。
 * 词表唯一来源：Gateway curriculum.pitch；失败/空由空状态显式呈现。
 */
export function PitchAccentCoach({ onOpenTutor }: PitchAccentCoachProps) {
  const pitchQuery = usePitchLexiconQuery();
  const words = pitchQuery.data ?? [];
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);

  const safeIndex = Math.min(selectedWordIndex, Math.max(words.length - 1, 0));
  const currentWord = words[safeIndex] ?? words[0];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorder = usePitchRecorder({
    canvasRef,
    pitchPattern: currentWord?.pitchPattern ?? [],
    pitchType: currentWord?.pitchType ?? '',
    contextKey: currentWord?.kanji ?? '',
  });

  if (!currentWord) {
    return (
      <div className="surface-card rounded-2xl p-10 text-center space-y-3">
        <AlertCircle className="w-8 h-8 mx-auto text-gold-warm" />
        <p className="text-sm text-ink-faint">
          {pitchQuery.isError
            ? '声调基准词表加载失败，请重试。'
            : pitchQuery.isLoading
              ? '正在读取声调基准词表…'
              : '本地词典库暂无声调基准词条，请先安装日语词典包。'}
        </p>
        {pitchQuery.isError && (
          <Button variant="outline" size="sm" onClick={() => pitchQuery.refetch()}>
            重新加载
          </Button>
        )}
      </div>
    );
  }

  // 真人示范音：单假名播内置；单词走实时 TTS（整词语调不能拼接）。
  const playModelVoice = (kana: string) => {
    sound.playClick();
    void playKanaText(kana).then((played) => {
      if (!played) void speechStudio.speak(kana, { lang: 'JA', purpose: 'preview' });
    });
  };

  const handleAskTutor = () => {
    if (!onOpenTutor) return;
    sound.playClick();
    onOpenTutor(buildPitchTutorContext(currentWord));
  };

  return (
    <div className="space-y-6">
      <div className="surface-card rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <Badge variant="gold">声调评测 · Pitch Accent</Badge>
          <span className="text-xs text-ink-ghost">
            日语特有高低重音可视化评测
          </span>
        </div>
        <h2 className="text-xl sm:text-2xl font-serif font-bold text-ink mt-1 tracking-tight">
          声调走向精准训练与跟读评分
        </h2>
      </div>

      <PitchWordPicker
        words={words}
        selectedWordIndex={safeIndex}
        onSelectWord={(idx) => {
          setSelectedWordIndex(idx);
          recorder.clearEvalResult();
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：音高走势与对比卡片 */}
        <div className="lg:col-span-7">
          <div className="surface-card rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-4 border-b border-line-hairline">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-serif font-bold text-ink">
                  {currentWord.kanji}
                </span>
                <span className="text-xl text-gold-warm font-mono font-semibold">
                  {currentWord.kana}
                </span>
                <span className="text-sm text-ink-stone-500 font-serif">
                  ({currentWord.meaning})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="gold" className="px-3 py-1">
                  {currentWord.pitchType}
                </Badge>
                <Button
                  size="sm"
                  onClick={() => playModelVoice(currentWord.kana)}
                  className="gap-1.5"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>听示范</span>
                </Button>
                {onOpenTutor && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAskTutor}
                    className="gap-1.5"
                  >
                    <Bot className="w-4 h-4" />
                    <span>问导师</span>
                  </Button>
                )}
              </div>
            </div>

            {/* 拍位音高走向剖析 */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-ink-ghost">
                拍位音高走向剖析：
              </span>
              <div className="p-6 rounded-2xl bg-surface-abyss/60 border border-line-hairline">
                <div className="flex items-center justify-around">
                  {currentWord.moraList.map((mora, idx) => {
                    const isHigh = currentWord.pitchPattern[idx] === 'H';
                    return (
                      <div key={idx} className="flex flex-col items-center gap-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md font-mono font-bold transition-all ${
                            isHigh
                              ? 'bg-gold-warm text-tone-stone-950 shadow-inner-hi-strong scale-110'
                              : 'bg-line-soft text-ink-faint-soft'
                          }`}
                        >
                          {isHigh ? '高音 H' : '低音 L'}
                        </span>

                        <div
                          className={`w-12 rounded-xl transition-all flex items-center justify-center font-bold text-sm ${
                            isHigh
                              ? 'h-24 bg-gold-warm text-tone-stone-950 shadow-inner-hi-strong'
                              : 'h-12 bg-tone-stone-300 dark:bg-tone-stone-800 text-ink-mute'
                          }`}
                        >
                          {isHigh ? '↑' : '↓'}
                        </div>

                        <span className="text-xl font-bold text-ink font-serif">
                          {mora}
                        </span>
                        <span className="text-xs text-ink-faint-soft font-mono">第 {idx + 1} 拍</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-gold-warm/10 border border-gold-warm/20 text-xs text-ink leading-relaxed">
              <span className="font-bold">发音要领：</span>
              {currentWord.tip}
            </div>

            {currentWord.contrastPair && (
              <div className="p-4 rounded-xl bg-surface-coal/60 border border-line-hairline space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-ink-faint-soft">
                    经典对比辨析：
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => playModelVoice(currentWord.contrastPair!.kana)}
                    className="h-auto p-0 text-xs gap-1"
                  >
                    <Volume2 className="w-3 h-3" />
                    试听对比词声调
                  </Button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-bold text-ink mr-2">
                      {currentWord.contrastPair.kanji} ({currentWord.contrastPair.kana})
                    </span>
                    <span className="text-xs text-ink-stone-500">
                      {currentWord.contrastPair.meaning}
                    </span>
                  </div>
                  <Badge variant="gold" className="font-mono">
                    {currentWord.contrastPair.pitchType}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：实时录音跟读评测器 */}
        <div className="lg:col-span-5">
          <div className="surface-card rounded-2xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <Mic className="w-4 h-4 text-gold-warm" />
                麦克风实时跟读打分
              </h3>
              <p className="text-xs text-ink-ghost mt-1">
                点击按钮朗读「{currentWord.kanji}」，录音将与声调模板逐拍比对
              </p>
            </div>

            <PitchCanvasVisualizer
              canvasRef={canvasRef}
              isRecording={recorder.isRecording}
              hasResult={recorder.evalResult !== null}
            />

            <div className="space-y-2">
              {recorder.isRecording ? (
                <div className="space-y-2">
                  {recorder.phase === 'recording' && <Progress value={recorder.recordingProgress} />}
                  <p className="text-xs text-center text-gold-warm font-semibold">
                    {recorder.phase === 'requesting' ? '正在等待麦克风权限…' : recorder.phase === 'analyzing' ? '正在分析录音…' : `正在录音，请朗读：${currentWord.kana}`}
                  </p>
                  <Button size="sm" variant="outline" onClick={recorder.cancelRecording}>取消本次录音</Button>
                </div>
              ) : (
                <ShimmerButton
                  onClick={() => void recorder.startRecording()}
                  className="w-full py-3 text-sm font-bold flex items-center justify-center gap-2 shadow-lg"
                >
                  <Mic className="w-4 h-4" />
                  <span>开始跟读录音 (2.8s)</span>
                </ShimmerButton>
              )}
            </div>

            {recorder.evalResult && (
              <PitchEvalScorecard result={recorder.evalResult} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
