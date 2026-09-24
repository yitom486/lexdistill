import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Activity,
  Award,
  Search,
  ExternalLink,
  Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { sound, speechStudio } from '../utils/audio.js';
import { ShimmerButton } from './magicui/index.js';
import { Progress } from './ui/progress.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { useDictionaryLookupQuery, usePitchLexiconQuery } from '../queries/useLearnerQueries.js';
import type { PitchLexiconItem } from '../queries/useLearnerQueries.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { buildPitchTutorContext } from '../lib/pitch-tutor.js';
import { readCssCustomProperty } from '../lib/css-tokens.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import {
  describePitchFeedback,
  estimatePitchContour,
  overallPitchScore,
  scorePitchMatch,
} from '../lib/pitch-analyze.js';

interface PitchAccentCoachProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

export function PitchAccentCoach({ onOpenTutor }: PitchAccentCoachProps) {
  const pitchQuery = usePitchLexiconQuery();
  // 词表唯一来源：Gateway curriculum.pitch（本地词典库 SSOT）；
  // 加载失败 / 空列表由下方空状态显式呈现，不再回退前端演示词表。
  const words = pitchQuery.data ?? [];
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);
  const [dictionaryInput, setDictionaryInput] = useState('');
  const [dictionaryQuery, setDictionaryQuery] = useState('');
  const dictionaryLookup = useDictionaryLookupQuery('ja', dictionaryQuery);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [evalResult, setEvalResult] = useState<{
    score: number;
    fluency: number;
    pitchMatch: number;
    comment: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const theme = usePreferencesStore((state) => state.theme);
  const pitchTraceColorRef = useRef('');

  useEffect(() => {
    pitchTraceColorRef.current = readCssCustomProperty('--visual-pitch-trace');
  }, [theme]);

  const safeIndex = Math.min(selectedWordIndex, Math.max(words.length - 1, 0));
  const currentWord: PitchLexiconItem | undefined = words[safeIndex] ?? words[0];

  // 注意：所有 Hook 必须在 early return 之前调用（Rules of Hooks）。
  // 之前 useEffect 写在下方 !currentWord return 之后，首屏词表未到时少调一个 Hook，
  // 数据到达后多调一个 → React 抛“Rendered more hooks than during the previous render”，
  // ErrorBoundary 接住显示你看到的红框；点重载时缓存已就绪所以正常。
  useEffect(() => {
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // 卸载时尽力停止录音，忽略边缘异常
      }
      mediaRecorderRef.current = null;
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    };
  }, []);

  if (!currentWord) {
    return (
      <div className="bg-paper-soft rounded-2xl p-10 border border-line-accent shadow-sm text-center space-y-3">
        <AlertCircle className="w-8 h-8 mx-auto text-tone-amber-500" />
        <p className="text-sm text-ink-faint">
          {pitchQuery.isError
            ? '声调基准词表加载失败，请确认 Gateway 已启动后重试。'
            : pitchQuery.isLoading
              ? '正在从 Gateway 读取声调基准词表…'
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

  // 真人示范音：走中央 TTS 引擎（系统/云端跟随设置），不再用正弦哔哔声冒充原音
  const playModelVoice = (kana: string) => {
    sound.playClick();
    void speechStudio.speak(kana, { lang: 'JA', purpose: 'preview' });
  };

  // 请 AI 老师讲这个词的声调（上下文由 lib/pitch-tutor 构造，UI 只调用）
  const handleAskTutor = () => {
    if (!currentWord || !onOpenTutor) return;
    sound.playClick();
    onOpenTutor(buildPitchTutorContext(currentWord));
  };

  // 模拟录音与实时波形绘制
  const startRecording = async () => {
    sound.playClick();
    setEvalResult(null);
    setIsRecording(true);
    setRecordingProgress(0);

    let stream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        // 同步用 MediaRecorder 落盘，供随后解码做真实音高分析
        try {
          const recorder = new MediaRecorder(stream);
          recordedChunksRef.current = [];
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          recorder.start();
          mediaRecorderRef.current = recorder;
        } catch {
          recordedChunksRef.current = [];
          mediaRecorderRef.current = null;
        }
      }
    } catch {
      // 麦克风受限则使用模拟波形
    }

    // 录音倒计时与波形循环
    const startTime = Date.now();
    const duration = 2800; // 2.8秒录音

    const drawWave = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const c = canvas.getContext('2d');
      if (!c) return;

      c.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      c.lineWidth = 2.5;
      c.strokeStyle = pitchTraceColorRef.current;
      c.beginPath();

      if (analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteTimeDomainData(dataArray);

        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] ?? 128) / 128.0;
          const y = v * (height / 2);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
          x += sliceWidth;
        }
      } else {
        // 合成动效正弦波
        const elapsed = (Date.now() - startTime) / 1000;
        for (let x = 0; x < width; x += 4) {
          const amp = Math.sin(elapsed * 8) * 20 + 15;
          const y = centerY + Math.sin(x * 0.05 + elapsed * 10) * amp;
          if (x === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
      c.stroke();

      const progress = Math.min(100, ((Date.now() - startTime) / duration) * 100);
      setRecordingProgress(progress);

      if (Date.now() - startTime < duration) {
        animFrameIdRef.current = requestAnimationFrame(drawWave);
      } else {
        finishRecording(stream);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(drawWave);
  };

  const finishRecording = (stream: MediaStream | null) => {
    setIsRecording(false);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    void analyzeRecording();
  };

  /**
   * 真实跟读评测：解码刚才录下的音频，自相关估 f0 轮廓，
   * 与课程声调模板逐拍比对。无麦克风/解码失败时如实返回，
   * 绝不编随机分数。
   */
  const analyzeRecording = async () => {
    const chunks = recordedChunksRef.current;
    recordedChunksRef.current = [];
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    try {
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          recorder.addEventListener('stop', done, { once: true });
          try {
            recorder.stop();
          } catch {
            done();
          }
          // 500ms 兜底，避免 stop 事件丢失时卡死
          setTimeout(done, 500);
        });
      }
    } catch {
      // 忽略停止时的边缘异常，继续走解码分支
    }

    const ctx = audioContextRef.current;
    try {
      if (chunks.length === 0 || !ctx) {
        setEvalResult(null);
        toast.info('未检测到麦克风输入，本次只看波形演示，未打分。');
        return;
      }
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      const raw = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(raw);
      const samples = decoded.getChannelData(0);
      const contour = estimatePitchContour(samples, decoded.sampleRate);
      const result = scorePitchMatch(contour, currentWord.pitchPattern);
      const score = overallPitchScore(result);
      sound.playCorrect();
      setEvalResult({
        score,
        fluency: result.fluency,
        pitchMatch: result.pitchMatch,
        comment: describePitchFeedback(result, currentWord.pitchType),
      });
      toast.success(`评测完成：综合声调得分 ${score} 分！`);
    } catch {
      setEvalResult(null);
      toast.info('录音解码失败，未打分，请重试一次。');
    } finally {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与科普说明 */}
      <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="amber">AI 声学与音调纠正 (Pitch Accent)</Badge>
              <span className="text-xs text-ink-ghost">
                日语特有高低重音可视化评测
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-ink mt-1">
              声调走向精准训练与跟读评分
            </h2>
          </div>

          {/* 词条切换 */}
          <Tabs
            value={String(selectedWordIndex)}
            onValueChange={(val) => {
              if (val == null) return;
              sound.playClick();
              setSelectedWordIndex(Number(val));
              setEvalResult(null);
            }}
          >
            <TabsList className="bg-veil-stone-200o60-stone-900 flex-wrap h-auto">
              <TabsIndicator />
              {words.map((item, idx) => (
                <TabsTrigger key={item.id} value={String(idx)} className="px-3 py-1.5 text-xs">
                  {item.kanji} ({item.kana})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 本地词典优先；OJAD 只在未命中时作为用户主动打开的外部检索。 */}
      <form
        className="rounded-2xl border border-line-accent bg-veil-paper-60 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setDictionaryQuery(dictionaryInput.trim());
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <label htmlFor="ja-dictionary-query" className="text-sm font-semibold text-ink-soft">
              日语词典查询
            </label>
            <p className="mt-0.5 text-xs text-ink-ghost">
              优先检索应用本地词表；未收录时可前往 OJAD 自行确认。
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <input
              id="ja-dictionary-query"
              value={dictionaryInput}
              onChange={(event) => setDictionaryInput(event.target.value)}
              placeholder="例如：雨、あめ、ame"
              className="h-9 min-w-0 flex-1 rounded-xl border border-ink-stone-200 bg-tone-white px-3 text-sm text-tone-stone-900 outline-none transition focus:border-tone-amber-500 focus:ring-2 focus:ring-tone-amber-500o20 dark:border-tone-stone-700 dark:bg-tone-stone-900 dark:text-tone-stone-100 sm:w-56"
            />
            <Button type="submit" size="sm" disabled={!dictionaryInput.trim() || dictionaryLookup.isFetching}>
              <Search className="h-3.5 w-3.5" />
              查询
            </Button>
          </div>
        </div>

        {dictionaryQuery && (
          <div className="mt-3 border-t border-ink-stone-200 pt-3 dark:border-tone-stone-800">
            {dictionaryLookup.isFetching ? (
              <p className="text-xs text-ink-stone-500">正在查询本地词典…</p>
            ) : dictionaryLookup.data?.entries.length ? (
              <div className="space-y-2">
                {dictionaryLookup.data.entries.map((entry) => {
                  const pronunciation = entry.pronunciation as {
                    pitchType?: string;
                    pitchPattern?: string[];
                  } | undefined;
                  return (
                    <div key={entry.id} className="rounded-xl bg-wash-amber-50o70 p-3 text-sm dark:bg-wash-amber-500o10">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-serif text-lg font-bold text-ink">{entry.headword}</span>
                        {entry.reading && <span className="font-mono text-accent-ink-strong">{entry.reading}</span>}
                        {entry.romanization && <span className="text-xs text-ink-stone-500">{entry.romanization}</span>}
                        <button
                          type="button"
                          title={`朗读${entry.reading || entry.headword}`}
                          onClick={() => {
                            sound.playClick();
                            void speechStudio.speak(entry.reading || entry.headword, {
                              lang: 'JA',
                              purpose: 'preview',
                            });
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full hover:bg-tone-amber-500o20 text-accent-ink-strong cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        {pronunciation?.pitchType && <Badge variant="amber">{pronunciation.pitchType}</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-ink-faint">{entry.meanings.join('；')}</p>
                      {pronunciation?.pitchPattern && (
                        <p className="mt-1 text-xs text-ink-stone-500">音调走向：{pronunciation.pitchPattern.join(' → ')}</p>
                      )}
                      <p className="mt-2 text-[11px] text-ink-stone-400">来源：{entry.sourceLabel}</p>
                    </div>
                  );
                })}
              </div>
            ) : dictionaryLookup.data?.externalLookup ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                <span>本地词典暂未收录「{dictionaryQuery}」。</span>
                <a
                  href={dictionaryLookup.data.externalLookup.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-tone-amber-700 hover:underline dark:text-ink-amber-300"
                >
                  前往 OJAD 查询 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-ink-stone-500">暂时无法取得词典结果，请稍后重试。</p>
            )}
          </div>
        )}
      </form>

      {/* 主展示区：声调高低走势曲线与对比 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：音高走势与对比卡片 */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-paper-soft rounded-2xl p-6 border border-line-accent shadow-sm space-y-6">
            {/* 核心词汇音调大图 */}
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-4 border-b border-line-soft">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-serif font-bold text-ink">
                    {currentWord.kanji}
                  </span>
                  <span className="text-xl text-accent-ink-warm font-mono font-semibold">
                    {currentWord.kana}
                  </span>
                  <span className="text-sm text-ink-stone-500 font-serif">
                    ({currentWord.meaning})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="amber" className="px-3 py-1">
                  {currentWord.pitchType}
                </Badge>
                <Button
                  size="sm"
                  onClick={() => playModelVoice(currentWord.kana)}
                  className="gap-1.5"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>示范原音</span>
                </Button>
                {onOpenTutor && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAskTutor}
                    className="gap-1.5"
                  >
                    <Bot className="w-4 h-4" />
                    <span>问AI老师</span>
                  </Button>
                )}
              </div>
            </div>

            {/* 声调走向走势阶梯图 (Mora Pitch Step Chart) */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-ink-ghost">
                拍位音高走向剖析 (Pitch Step Curve)：
              </span>
              <div className="p-6 rounded-2xl bg-wash-amber-50o60-stone-900o50 border border-line-accent">
                <div className="flex items-center justify-around">
                  {currentWord.moraList.map((mora, idx) => {
                    const isHigh = currentWord.pitchPattern[idx] === 'H';
                    return (
                      <div key={idx} className="flex flex-col items-center gap-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md font-mono font-bold transition-all ${
                            isHigh
                              ? 'bg-tone-amber-500 text-tone-stone-950 shadow-sm scale-110'
                              : 'bg-line-soft text-ink-faint-soft'
                          }`}
                        >
                          {isHigh ? '高音 H' : '低音 L'}
                        </span>

                        {/* 阶梯柱状图 */}
                        <div
                          className={`w-12 rounded-xl transition-all flex items-center justify-center font-bold text-sm ${
                            isHigh
                              ? 'h-24 bg-gradient-to-t from-tone-amber-500 to-ink-amber-400 text-tone-stone-950 shadow-md'
                              : 'h-12 bg-tone-stone-300 dark:bg-tone-stone-800 text-ink-mute'
                          }`}
                        >
                          {isHigh ? '↑' : '↓'}
                        </div>

                        {/* 假名显示 */}
                        <span className="text-xl font-bold text-ink font-serif">
                          {mora}
                        </span>
                        <span className="text-[11px] text-ink-stone-400 font-mono">第 {idx + 1} 拍</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 专家辨析提示 */}
            <div className="p-3.5 rounded-xl bg-wash-amber-500o10-amber-500o15 border border-tone-amber-500o25 text-xs text-ink-amber-950-amber-200 leading-relaxed">
              💡 <span className="font-bold">发音要领：</span>
              {currentWord.tip}
            </div>

            {/* 易混淆对比词条对 (如 雨 vs 飴) */}
            {currentWord.contrastPair && (
              <div className="p-4 rounded-xl bg-veil-stone-100o80-stone-900o60 border border-line-soft space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-ink-mute">
                    🔥 经典对比辨析 (Minimal Pair)：
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => playModelVoice(currentWord.contrastPair!.kana)}
                    className="h-auto p-0 text-[11px] gap-1"
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
                  <Badge variant="secondary" className="rounded font-mono text-xs">
                    {currentWord.contrastPair.pitchType}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：实时录音跟读评测器 */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-paper-soft rounded-2xl p-6 border border-line-accent shadow-sm space-y-5">
            <div>
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <Mic className="w-4 h-4 text-accent-ink" />
                麦克风实时跟读打分
              </h3>
              <p className="text-xs text-ink-ghost mt-1">
                点击按钮朗读「{currentWord.kanji}」，AI 引擎将比对声调起伏
              </p>
            </div>

            {/* 声波画布 */}
            <div className="relative h-28 bg-tone-stone-950 rounded-xl overflow-hidden flex items-center justify-center border border-line-amber-900o20">
              <canvas
                ref={canvasRef}
                width={360}
                height={112}
                className="w-full h-full object-contain"
              />
              {!isRecording && !evalResult && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-stone-500">
                  <span>等待开始录音...</span>
                </div>
              )}
            </div>

            {/* 录音控制按钮与进度条 */}
            <div className="space-y-2">
              {isRecording ? (
                <div className="space-y-2">
                  <Progress value={recordingProgress} />
                  <p className="text-xs text-center text-accent-ink-warm font-semibold animate-pulse">
                    正在录音分析中... 请清晰朗读：{currentWord.kana}
                  </p>
                </div>
              ) : (
                <ShimmerButton
                  onClick={startRecording}
                  className="w-full py-3 text-sm font-bold flex items-center justify-center gap-2 shadow-lg"
                >
                  <Mic className="w-4 h-4" />
                  <span>开始跟读录音 (2.8s)</span>
                </ShimmerButton>
              )}
            </div>

            {/* 评测结果卡片 */}
            {evalResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-xl bg-wash-amber-500o10-amber-500o15 border border-line-amber-500o30 space-y-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-ink-amber-900-amber-200 flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-accent-ink" />
                    AI 声调综合得分
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold font-mono text-accent-ink">
                      {evalResult.score}
                    </span>
                    <span className="text-xs text-ink-stone-500 font-mono">/ 100</span>
                  </div>
                </div>

                {/* 细分指标 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-veil-stone-100o70-stone-900o60 flex justify-between">
                    <span className="text-ink-stone-500">音高匹配度</span>
                    <span className="font-bold text-ink-soft">{evalResult.pitchMatch}%</span>
                  </div>
                  <div className="p-2 rounded bg-veil-stone-100o70-stone-900o60 flex justify-between">
                    <span className="text-ink-stone-500">节奏连贯度</span>
                    <span className="font-bold text-ink-soft">{evalResult.fluency}%</span>
                  </div>
                </div>

                <p className="text-xs text-ink-mute leading-relaxed font-serif">
                  {evalResult.comment}
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
