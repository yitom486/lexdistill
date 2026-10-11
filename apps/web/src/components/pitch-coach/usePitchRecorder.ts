import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { sound } from '../../utils/audio.js';
import { readCssCustomProperty } from '../../lib/css-tokens.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import {
  describePitchFeedback,
  estimatePitchContour,
  overallPitchScore,
  scorePitchMatch,
} from '../../lib/pitch-analyze.js';
import { paintWaveFrame, type WaveColors } from './PitchCanvasVisualizer.js';

export interface PitchEvalResult {
  score: number;
  fluency: number;
  pitchMatch: number;
  comment: string;
}

interface UsePitchRecorderOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** 当前词的声调模板（逐拍 H/L）与类型，用于真实跟读比对 */
  pitchPattern: Array<'L' | 'H'>;
  pitchType: string;
  durationMs?: number;
}

/**
 * 跟读录音引擎：麦克风采集 → 波形循环绘制 → 落盘解码 → f0 轮廓比对打分。
 * 绘制本身由 PitchCanvasVisualizer.paintWaveFrame 承担，本 Hook 只拥有循环与数据。
 * 无麦克风/解码失败时如实返回，绝不编随机分数。
 */
export function usePitchRecorder({
  canvasRef,
  pitchPattern,
  pitchType,
  durationMs = 2800,
}: UsePitchRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [evalResult, setEvalResult] = useState<PitchEvalResult | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const colorsRef = useRef<WaveColors>({ trace: '', grid: '' });
  const theme = usePreferencesStore((state) => state.theme);

  useEffect(() => {
    colorsRef.current = {
      trace: readCssCustomProperty('--visual-pitch-trace'),
      grid: readCssCustomProperty('--line-hairline-strong'),
    };
  }, [theme]);

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
      const result = scorePitchMatch(contour, pitchPattern);
      const score = overallPitchScore(result);
      sound.playCorrect();
      setEvalResult({
        score,
        fluency: result.fluency,
        pitchMatch: result.pitchMatch,
        comment: describePitchFeedback(result, pitchType),
      });
      toast.success(`评测完成：综合 ${score} 分`);
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

  const finishRecording = (stream: MediaStream | null) => {
    setIsRecording(false);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    void analyzeRecording();
  };

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

    const tick = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        paintWaveFrame(
          canvas,
          { analyser: analyserRef.current, elapsedSec: (Date.now() - startTime) / 1000 },
          colorsRef.current
        );
      }
      const progress = Math.min(100, ((Date.now() - startTime) / durationMs) * 100);
      setRecordingProgress(progress);

      if (Date.now() - startTime < durationMs) {
        animFrameIdRef.current = requestAnimationFrame(tick);
      } else {
        finishRecording(stream);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
  };

  return {
    isRecording,
    recordingProgress,
    evalResult,
    startRecording,
    clearEvalResult: () => setEvalResult(null),
  };
}
