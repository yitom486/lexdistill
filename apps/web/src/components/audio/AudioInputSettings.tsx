import { Mic, MicOff, RefreshCw, Volume2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { useMicrophoneTester } from '../../hooks/useMicrophoneTester.js';

export function AudioInputSettings() {
  const {
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
  } = useMicrophoneTester();

  return (
    <section id="settings-audio-input" className="mt-8 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-ink">语音输入</h2>
          <p className="mt-1 text-sm text-ink-mute">
            配置口语跟读与语音交互的麦克风采集设备，并实时检测拾音音量。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permissionState === 'granted' && (
            <Badge variant="emerald" className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              麦克风可用
            </Badge>
          )}
          {permissionState === 'denied' && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              权限受限
            </Badge>
          )}
          {permissionState === 'unsupported' && (
            <Badge variant="outline" className="gap-1 text-ink-mute">
              设备不支持
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-7 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        {/* 麦克风设备选择 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-base font-semibold text-ink">输入设备 (麦克风)</label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-ink-mute hover:text-ink"
              onClick={() => void refreshDevices()}
              title="重新检测麦克风硬件"
            >
              <RefreshCw className="h-3 w-3" />
              刷新设备
            </Button>
          </div>

          <Select
            value={selectedDeviceId || '__default'}
            onValueChange={(val) => {
              if (isTesting) stopTest();
              setSelectedDeviceId(val === '__default' || !val ? '' : val);
            }}
          >
            <SelectTrigger className="min-h-12 w-full text-base">
              <SelectValue placeholder="系统默认麦克风" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default">系统默认麦克风</SelectItem>
              {devices.map((device, index) => (
                <SelectItem key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `音频输入设备 ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-ink-mute">
            {devices.length > 0
              ? `已检测到 ${devices.length} 个拾音设备；未点击测试前部分系统可能隐去设备详细名称。`
              : '正在枚举麦克风设备…若未显示请点击测试以授予权限。'}
          </p>
        </div>

        {/* 麦克风测试触发按钮 */}
        <div className="flex items-end">
          <Button
            type="button"
            variant={isTesting ? 'default' : 'outline'}
            className="min-h-12 gap-2 px-6 text-base"
            onClick={() => {
              if (isTesting) {
                stopTest();
              } else {
                void startTest();
              }
            }}
          >
            {isTesting ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {isTesting ? '停止测试' : '测试麦克风'}
          </Button>
        </div>
      </div>

      {/* 实时电平 VU 表 */}
      <div className="mt-6 rounded-2xl border border-line bg-surface-soft p-4 sm:p-5">
        <div className="flex items-center justify-between text-sm font-medium text-ink">
          <span className="flex items-center gap-2">
            <Volume2 className={`h-4 w-4 ${isTesting ? 'text-tone-emerald-600' : 'text-ink-mute'}`} />
            实时拾音电平 (VU Meter)
          </span>
          <span className="font-mono text-xs text-ink-mute">
            {isTesting ? `${inputLevel}%` : '未开启测试'}
          </span>
        </div>

        {/* 音量指示条 */}
        <div className="mt-3 relative h-3 w-full overflow-hidden rounded-full bg-veil-stone-200o60-stone-800">
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              inputLevel > 80
                ? 'bg-tone-amber-500'
                : inputLevel > 15
                  ? 'bg-tone-emerald-500'
                  : 'bg-tone-emerald-400'
            }`}
            style={{ width: `${isTesting ? inputLevel : 0}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-ink-ghost">
          <span>静音 (0%)</span>
          <span>说话请观察跳动条（建议在 30%–80% 之间）</span>
          <span>满幅 (100%)</span>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-wash-rose-500o10 p-3 text-xs text-ink-rose-900 dark:text-ink-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </section>
  );
}
