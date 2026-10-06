import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioInputStore } from '../stores/useAudioInputStore.js';

export type MicPermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported';

export interface UseMicrophoneTesterResult {
  devices: MediaDeviceInfo[];
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
  const [permissionState, setPermissionState] = useState<MicPermissionState>('idle');
  const [isTesting, setIsTesting] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const stopTest = useCallback(() => {
    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsTesting(false);
    setInputLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setPermissionState('unsupported');
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');
      setDevices(audioInputs);
    } catch {
      // 忽略枚举失败
    }
  }, []);

  const startTest = useCallback(async () => {
    stopTest();
    setErrorMessage(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unsupported');
      setErrorMessage('当前运行环境不支持音频采集 API。');
      return;
    }

    setPermissionState('requesting');

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setPermissionState('granted');
      setIsTesting(true);

      // 获得权限后设备名称即可见，重新刷新设备列表
      void refreshDevices();

      const AudioContextConstructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextConstructor();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] ?? 0;
        }
        const avg = sum / dataArray.length;
        // 放大拾音动态范围映射到 0-100
        const calculated = Math.min(100, Math.round((avg / 96) * 100));
        setInputLevel(calculated);

        animFrameIdRef.current = requestAnimationFrame(updateLevel);
      };

      animFrameIdRef.current = requestAnimationFrame(updateLevel);
    } catch (err) {
      stopTest();
      setPermissionState('denied');
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? '麦克风权限已被拒绝，请在系统或应用设置中允许麦克风权限。'
          : err instanceof Error
            ? err.message
            : '无法访问麦克风设备。';
      setErrorMessage(message);
    }
  }, [selectedDeviceId, stopTest, refreshDevices]);

  // 初始化设备枚举
  useEffect(() => {
    void refreshDevices();

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }
  }, [refreshDevices]);

  // 组件卸载时安全回收资源
  useEffect(() => {
    return () => {
      stopTest();
    };
  }, [stopTest]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    permissionState,
    isTesting,
    inputLevel,
    errorMessage,
    startTest,
    stopTest,
    refreshDevices,
  };
}
