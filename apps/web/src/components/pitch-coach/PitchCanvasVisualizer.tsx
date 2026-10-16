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
 * 单帧波形绘制：声学音高网格（虚线发丝标尺）+ 真实采样连线 + 主题辉光。
 * 颜色全部来自调用方传入的语义 Token（运行时读取），此处不写任何色值字面量。
 * 无麦克风信号时只画基线与文字说明，不合成演示波形冒充用户声音；
 * 绘制逐个原始采样点直连；评分依据原始采样（estimatePitchContour）。
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
  // Token 未就绪时保持空白画布，不画任何成功曲线
  if (!colors.trace && !colors.grid) return;

  // 声学音高网格：三线虚线发丝标尺
  if (colors.grid) {
    c.save();
    c.strokeStyle = colors.grid;
    c.lineWidth = 1;
    c.setLineDash([3, 4]);
    for (const y of [height * 0.25, height * 0.5, height * 0.75]) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(width, y);
      c.stroke();
    }
    c.restore();
  }

  // 采样：真实麦克风时域数据；无信号时画基线并标注，不合成演示波形
  if (!reading.analyser) {
    c.save();
    c.strokeStyle = colors.grid || colors.trace;
    c.lineWidth = 1;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(0, centerY);
    c.lineTo(width, centerY);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = colors.grid || colors.trace;
    c.font = '12px sans-serif';
    c.textAlign = 'center';
    c.fillText('无麦克风信号', width / 2, centerY - 10);
    c.restore();
    return;
  }
  const points: Array<{ x: number; y: number }> = [];
  const bufferLength = reading.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  reading.analyser.getByteTimeDomainData(dataArray);
  const sliceWidth = width / bufferLength;
  for (let i = 0; i < bufferLength; i++) {
    const v = (dataArray[i] ?? 128) / 128.0;
    points.push({ x: i * sliceWidth, y: v * (height / 2) });
  }
  if (points.length === 0 || !colors.trace) return;

  // 原始采样点直连；评分仍由原始声学轮廓负责。
  c.save();
  c.strokeStyle = colors.trace;
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
  for (let i = 1; i < points.length; i++) {
    const curr = points[i]!;
    c.lineTo(curr.x, curr.y);
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
