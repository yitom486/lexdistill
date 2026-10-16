import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from './ui/tabs.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { trackToSpeechLang } from '../config/speech-language.js';
import { TtsStudioSettings } from './TtsStudioSettings.js';
import { AudioInputSettings } from './audio/AudioInputSettings.js';
import { ProviderSettingsSection } from './ProviderSettingsSection.js';
import { getPlatform } from '../platform/capabilities.js';
import { SettingsAppUpdateCard } from './settings/SettingsAppUpdateCard.js';
import { SettingsDictionarySection } from './settings/SettingsDictionarySection.js';
import { SettingsAnkiSection } from './settings/SettingsAnkiSection.js';
import { SettingsProfileCard } from './settings/SettingsProfileCard.js';
import { SettingsDataCard } from './settings/SettingsDataCard.js';
import { SettingsSoundEffectsCard } from './settings/SettingsSoundEffectsCard.js';

/**
 * 系统设置页：语音设置（常用置顶）/ 其他设置（高级与维护）。
 * 各区独立负责查询与操作，本容器只做分区与显隐，不持有表单状态。
 */
export function SystemSettingsPage() {
  const isConnected = useGatewayStore((s) => s.isConnected);
  const latencyMs = useGatewayStore((s) => s.latencyMs);

  const shell = useLearningShell();
  const speechLang = trackToSpeechLang(shell.track);
  const [section, setSection] = useState<'speech' | 'more'>('speech');
  const moreActive = section === 'more';

  // P4-B：桌面端专属（Web 端不渲染）。getPlatform 在 Tauri WebView 内返回桌面实现。
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    try {
      setIsDesktop(getPlatform().isDesktop());
    } catch {
      setIsDesktop(false);
    }
  }, []);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-ink">设置</h1>
        <div className="flex items-center gap-1.5 text-base font-medium">
          {isConnected ? (
            <span
              className="inline-flex items-center gap-1 text-ink-emerald-600-emerald-400"
              title={latencyMs ? `网关延迟 ${latencyMs}ms（技术详情，按需查看）` : '网关已连接'}
            >
              <Wifi className="h-4 w-4" />
              <span>已连接</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-accent-ink" title="网关未连接，安装/推送等在线操作不可用">
              <WifiOff className="h-4 w-4" />
              <span>离线模式</span>
            </span>
          )}
        </div>
      </header>

      <Tabs value={section} onValueChange={(value) => setSection(value === 'more' ? 'more' : 'speech')}>
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsIndicator />
          <TabsTrigger value="speech" className="px-6 py-3 text-base">语音设置</TabsTrigger>
          <TabsTrigger value="more" className="px-6 py-3 text-base">其他设置</TabsTrigger>
        </TabsList>
        <TabsContent value="speech" className="mt-6 space-y-6">
          <TtsStudioSettings lang={speechLang} />
          <AudioInputSettings />
        </TabsContent>
        <TabsContent value="more" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="space-y-6">
              {isDesktop && <SettingsAppUpdateCard />}
              <SettingsDictionarySection isConnected={isConnected} active={moreActive} />
            </div>
            <div className="space-y-6">
              <SettingsAnkiSection isConnected={isConnected} active={moreActive} />
              <ProviderSettingsSection />
              <SettingsProfileCard />
              <SettingsSoundEffectsCard />
              {isDesktop && <SettingsDataCard />}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
