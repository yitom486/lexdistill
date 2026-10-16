export interface PitchCapture {
  stream: MediaStream | null;
  context: AudioContext | null;
  recorder: MediaRecorder | null;
  frame: number | null;
  finishStop: (() => void) | null;
  chunks: Blob[];
}

export function releaseCapture(capture: PitchCapture) {
  if (capture.frame !== null) cancelAnimationFrame(capture.frame);
  capture.finishStop?.();
  if (capture.recorder) {
    capture.recorder.ondataavailable = null;
    capture.recorder.onstop = null;
    try { if (capture.recorder.state !== 'inactive') capture.recorder.stop(); } catch { /* Already stopped. */ }
  }
  capture.stream?.getTracks().forEach(track => track.stop());
  void capture.context?.close().catch(() => {});
  capture.stream = null;
  capture.context = null;
}

/** Final dataavailable precedes stop. A missed stop event is a failure, not partial success. */
export function stopCapture(capture: PitchCapture): Promise<void> {
  return new Promise((resolve, reject) => {
    const recorder = capture.recorder;
    if (!recorder) { reject(new Error('未检测到录音数据，本次未打分。')); return; }
    const finish = (cause?: unknown) => {
      clearTimeout(timer);
      capture.finishStop = null;
      recorder.onstop = null;
      if (cause) reject(cause); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('录音结束事件未收到，请重试。')), 500);
    capture.finishStop = () => finish();
    recorder.onstop = () => finish();
    try { recorder.stop(); } catch (cause) { finish(cause); }
  });
}

export function describeMicError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限被拒绝，请检查系统或应用的麦克风权限。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '未找到可用麦克风，请检查设备连接。';
  if (name === 'NotReadableError') return '无法读取麦克风，设备可能被占用，请检查后重试。';
  if (name === 'AbortError') return '麦克风启动已中断，请重试。';
  return cause instanceof Error ? cause.message : '录音启动失败，请重试。';
}
