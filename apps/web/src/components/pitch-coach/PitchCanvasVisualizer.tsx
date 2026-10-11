import type { RefObject } from 'react';

export interface WaveReading {
  analyser: AnalyserNode | null;
  elapsedSec: number;
}

export interface WaveColors {
  trace: string;
  grid: string;
}

/**
 * 单帧波形绘制：声学音高网格（虚线发丝标尺）+ 贝塞尔平滑音调曲线 + 主题辉光。
 * 颜色来自语义 Token（运行时读取），此处只收字符串，不写任何色值字面量进 class。
 */
export function paintWaveFrame(
  canvas: HTMLCanvasElement,
  reading: WaveReading,
  colors: WaveColors
) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;

  c.clearRect(0, 0, width, height);

  // 声学音高网格：三线虚线发丝标尺
  c.save();
  c.strokeStyle = colors.grid || 'rgba(255, 255, 255, 0.08)';
  c.lineWidth = 1;
  c.setLineDash([3, 4]);
  for (const y of [height * 0.25, height * 0.5, height * 0.75]) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(width, y);
    c.stroke();
  }
  c.restore();

  // 采样：真实麦克风时域数据，或合成演示正弦
  const points: Array<{ x: number; y: number }> = [];
  if (reading.analyser) {
    const bufferLength = reading.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    reading.analyser.getByteTimeDomainData(dataArray);
    const sliceWidth = width / bufferLength;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] ?? 128) / 128.0;
      points.push({ x: i * sliceWidth, y: v * (height / 2) });
    }
  } else {
    const elapsed = reading.elapsedSec;
    for (let x = 0; x < width; x += 4) {
      const amp = Math.sin(elapsed * 8) * 20 + 15;
      points.push({ x, y: centerY + Math.sin(x * 0.05 + elapsed * 10) * amp });
    }
  }
  if (points.length === 0) return;

  // 贝塞尔平滑 + 主题辉光
  c.save();
  c.strokeStyle = colors.trace || '#e0a96d';
  c.lineWidth = 2.5;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  try {
    c.shadowColor = colors.trace;
    c.shadowBlur = 8;
  } catch {
    // 忽略旧引擎的阴影异常
  }
  c.beginPath();
  const first = points[0]!;
  c.moveTo(first.x, first.y);
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i]!;
    const next = points[i + 1]!;
    c.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
  }
  const last = points[points.length - 1]!;
  c.lineTo(last.x, last.y);
  c.stroke();
  c.restore();
}

interface PitchCanvasVisualizerProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isRecording: boolean;
  hasResult: boolean;
}

/** 声波画布： Ableton 式深色声学台面，网格与辉光由 paintWaveFrame 逐帧绘制。 */
export function PitchCanvasVisualizer({ canvasRef, isRecording, hasResult }: PitchCanvasVisualizerProps) {
  return (
    <div className="relative h-28 bg-surface-abyss rounded-xl overflow-hidden flex items-center justify-center border border-line-hairline">
      <canvas
        ref={canvasRef}
        width={360}
        height={112}
        className="w-full h-full object-contain"
        aria-label="跟读声波"
      />
      {!isRecording && !hasResult && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-faint-soft pointer-events-none">
          <span>等待开始录音...</span>
        </div>
      )}
    </div>
  );
}
