import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { sound } from '../../utils/audio.js';
import { readCssCustomProperty } from '../../lib/css-tokens.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { describePitchFeedback, estimatePitchContour, overallPitchScore, scorePitchMatch } from '../../lib/pitch-analyze.js';
import { paintWaveFrame } from './PitchCanvasVisualizer.js';
import { describeMicError, releaseCapture, stopCapture, type PitchCapture } from './pitch-capture.js';

export interface PitchEvalResult { score: number; fluency: number; pitchMatch: number; comment: string }
interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  pitchPattern: Array<'L' | 'H'>;
  pitchType: string;
  contextKey?: string;
  durationMs?: number;
}

/** A capture owns its microphone, final chunks and decoder until analysis or cancellation finishes. */
export function usePitchRecorder({ canvasRef, pitchPattern, pitchType, contextKey = '', durationMs = 2800 }: Options) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'analyzing'>('idle');
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [evalResult, setEvalResult] = useState<PitchEvalResult | null>(null);
  const active = useRef<PitchCapture | null>(null);
  const mounted = useRef(false);
  const liveKey = useRef('');
  const key = `${contextKey}:${pitchType}:${pitchPattern.join('')}`;
  liveKey.current = key;
  const theme = usePreferencesStore(state => state.theme);
  const colors = () => ({ trace: readCssCustomProperty('--visual-pitch-trace'), grid: readCssCustomProperty('--line-hairline-strong') });
  const cancelRecording = () => {
    const capture = active.current;
    active.current = null;
    if (capture) releaseCapture(capture);
    setPhase('idle');
    setRecordingProgress(0);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) releaseCapture(active.current);
      active.current = null;
    };
  }, []);
  useEffect(() => { cancelRecording(); setEvalResult(null); }, [key]);
  useEffect(() => {
    if (!active.current && canvasRef.current) paintWaveFrame(canvasRef.current, { analyser: null, elapsedSec: 0 }, colors());
  }, [theme, key]);

  const startRecording = async () => {
    if (active.current) return;
    const capture: PitchCapture = { stream: null, context: null, recorder: null, frame: null, finishStop: null, chunks: [] };
    active.current = capture;
    const requestKey = key;
    const pattern = [...pitchPattern];
    const isCurrent = () => mounted.current && active.current === capture && liveKey.current === requestKey;
    sound.playClick();
    setEvalResult(null);
    setPhase('requesting');
    setRecordingProgress(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持麦克风录音。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent()) { stream.getTracks().forEach(track => track.stop()); return; }
      capture.stream = stream;
      const context = new AudioContext();
      capture.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const recorder = new MediaRecorder(stream);
      capture.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size > 0) capture.chunks.push(event.data); };
      recorder.start();
      setPhase('recording');
      const started = Date.now();
      const finish = async () => {
        if (!isCurrent()) return;
        setPhase('analyzing');
        try {
          await stopCapture(capture);
          capture.stream?.getTracks().forEach(track => track.stop());
          capture.stream = null;
          if (!isCurrent()) return;
          if (!capture.chunks.length) throw new Error('未检测到录音数据，本次未打分。');
          const raw = await new Blob(capture.chunks, { type: recorder.mimeType || 'audio/webm' }).arrayBuffer();
          const decoded = await context.decodeAudioData(raw);
          if (!isCurrent()) return;
          const result = scorePitchMatch(estimatePitchContour(decoded.getChannelData(0), decoded.sampleRate), pattern);
          const score = overallPitchScore(result);
          setEvalResult({ score, fluency: result.fluency, pitchMatch: result.pitchMatch, comment: describePitchFeedback(result, pitchType) });
          toast.success(`评测完成：综合 ${score} 分`);
        } catch (cause) {
          if (isCurrent()) toast.error(cause instanceof Error ? cause.message : '录音分析失败，本次未打分。');
        } finally {
          releaseCapture(capture);
          if (active.current === capture) { active.current = null; if (mounted.current) setPhase('idle'); }
        }
      };
      const tick = () => {
        if (!isCurrent()) { releaseCapture(capture); return; }
        const elapsed = Date.now() - started;
        if (canvasRef.current) paintWaveFrame(canvasRef.current, { analyser, elapsedSec: elapsed / 1000 }, colors());
        setRecordingProgress(Math.min(100, elapsed / durationMs * 100));
        if (elapsed < durationMs) capture.frame = requestAnimationFrame(tick);
        else { capture.frame = null; void finish(); }
      };
      capture.frame = requestAnimationFrame(tick);
    } catch (cause) {
      if (isCurrent()) toast.error(describeMicError(cause));
      releaseCapture(capture);
      if (active.current === capture) { active.current = null; if (mounted.current) setPhase('idle'); }
    }
  };
  return { phase, isRecording: phase !== 'idle', recordingProgress, evalResult, startRecording, cancelRecording, clearEvalResult: () => setEvalResult(null) };
}
