import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioInputStore } from '../stores/useAudioInputStore.js';

export type MicPermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported';
export interface UseMicrophoneTesterResult {
  devices: MediaDeviceInfo[];
  devicesReady: boolean;
  devicesError: string | null;
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  permissionState: MicPermissionState;
  isTesting: boolean;
  inputLevel: number;
  errorMessage: string | null;
  startTest: () => Promise<void>;
  stopTest: () => void;
  refreshDevices: () => Promise<void>;
}

export function useMicrophoneTester(): UseMicrophoneTesterResult {
  const selectedDeviceId = useAudioInputStore((s) => s.preferredDeviceId);
  const setSelectedDeviceId = useAudioInputStore((s) => s.setPreferredDeviceId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesReady, setDevicesReady] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<MicPermissionState>('idle');
  const [isTesting, setIsTesting] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const requestEpoch = useRef(0);
  const enumerationEpoch = useRef(0);
  const requesting = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const stopTest = useCallback(() => {
    requestEpoch.current++;
    requesting.current = false;
    if (animFrameIdRef.current !== null) cancelAnimationFrame(animFrameIdRef.current);
    animFrameIdRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    if (mounted.current) {
      setIsTesting(false);
      setInputLevel(0);
      setPermissionState((state) => state === 'requesting' ? 'idle' : state);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const epoch = ++enumerationEpoch.current;
    const current = () => mounted.current && epoch === enumerationEpoch.current;
    if (!navigator.mediaDevices?.enumerateDevices) {
      if (current()) {
        setPermissionState('unsupported');
        setDevicesReady(true);
        setDevicesError('当前环境不支持设备枚举。');
      }
      return;
    }
    if (current()) setDevicesReady(false);
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (current()) {
        setDevices(all.filter((d) => d.kind === 'audioinput'));
        setDevicesError(null);
      }
    } catch {
      if (current()) setDevicesError('设备枚举失败，请点击“刷新设备”重试。');
    } finally {
      if (current()) setDevicesReady(true);
    }
  }, []);

  const startTest = useCallback(async () => {
    if (requesting.current || !mounted.current) return;
    stopTest();
    const epoch = requestEpoch.current;
    const current = () => mounted.current && epoch === requestEpoch.current;
    setErrorMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unsupported');
      setErrorMessage('当前运行环境不支持音频采集 API。');
      return;
    }
    requesting.current = true;
    setPermissionState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      });
      // 权限对话框无法程序取消；迟到授权必须立即释放，不开始采集。
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setPermissionState('granted');
      const Constructor = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Constructor();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      setIsTesting(true);
      void refreshDevices();
      const data = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!current() || !analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const value of data) sum += value;
        setInputLevel(Math.min(100, Math.round((sum / data.length / 96) * 100)));
        animFrameIdRef.current = requestAnimationFrame(updateLevel);
      };
      animFrameIdRef.current = requestAnimationFrame(updateLevel);
    } catch (err) {
      if (!current()) return;
      const permissionGranted = streamRef.current !== null;
      stopTest();
      const name = err instanceof Error ? err.name : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      setPermissionState(denied ? 'denied' : permissionGranted ? 'granted' : 'idle');
      setErrorMessage(denied
        ? '麦克风权限已被拒绝，请在系统或应用设置中允许麦克风权限。'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? '未找到所选麦克风，请刷新设备或改用系统默认。'
          : name === 'NotReadableError'
            ? '麦克风暂时无法使用，可能被其他应用占用。'
            : '无法启动麦克风测试，请检查设备后重试。');
    } finally {
      if (current()) requesting.current = false;
    }
  }, [selectedDeviceId, stopTest, refreshDevices]);

  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    const media = navigator.mediaDevices;
    const handleChange = () => void refreshDevices();
    media?.addEventListener?.('devicechange', handleChange);
    return () => {
      mounted.current = false;
      enumerationEpoch.current++;
      media?.removeEventListener?.('devicechange', handleChange);
      stopTest();
    };
  }, [refreshDevices, stopTest]);

  return { devices, devicesReady, devicesError, selectedDeviceId, setSelectedDeviceId,
    permissionState, isTesting, inputLevel, errorMessage, startTest, stopTest, refreshDevices };
}
