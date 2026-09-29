import React, { useState, useEffect } from 'react';
import {
  SlidersHorizontal,
  Volume2,
  Wifi,
  WifiOff,
  User,
  Play,
  Check,
  ChevronRight,
  Flame,
  CheckCircle2,
  BookOpen,
  Download,
  LoaderCircle,
  DatabaseBackup,
  Plug,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { Button, buttonVariants } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { Slider } from './ui/slider.js';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './ui/select.js';
import { sound } from '../utils/audio.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { getPreviewText, trackToSpeechLang } from '../config/tts-voice-personas.js';
import {
  useDictionaryPackagesQuery,
  useInstallDictionaryPackageMutation,
  useInstallCustomDictionaryMutation,
  useUpdateDictionaryPackageMutation,
  useAnkiStatusQuery,
  useSaveAnkiSettingsMutation,
} from '../queries/useLearnerQueries.js';
import { Switch } from './ui/switch.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { AnkiTemplateWorkbench } from './AnkiTemplateWorkbench.js';
import { getPlatform } from '../platform/capabilities.js';
import { backupDesktopDatabase } from '../platform/tauri-capabilities.js';
import { checkForAppUpdate } from '../platform/app-updater.js';

export function SystemSettingsPopover() {
  const [open, setOpen] = useState(false);
  const isConnected = useGatewayStore((s) => s.isConnected);
  const latencyMs = useGatewayStore((s) => s.latencyMs);

  // 用户偏好由 Zustand 持久化；模型、音色选择与兜底均交给 gemini-tts-studio。
  const gender = useTtsStore((state) => state.gender);
  const rate = useTtsStore((state) => state.rate);
  const preferredService = useTtsStore((state) => state.preferredService);
  const geminiApiKey = useTtsStore((state) => state.geminiApiKey);
  const azureKey = useTtsStore((state) => state.azureKey);
  const azureRegion = useTtsStore((state) => state.azureRegion);
  const localBaseUrl = useTtsStore((state) => state.localBaseUrl);
  const localApiKey = useTtsStore((state) => state.localApiKey);
  const voiceId = useTtsStore((state) => state.voiceId);
  const setGender = useTtsStore((state) => state.setGender);
  const setRate = useTtsStore((state) => state.setRate);
  const setPreferredService = useTtsStore((state) => state.setPreferredService);
  const setGeminiApiKey = useTtsStore((state) => state.setGeminiApiKey);
  const setAzureKey = useTtsStore((state) => state.setAzureKey);
  const setAzureRegion = useTtsStore((state) => state.setAzureRegion);
  const setLocalBaseUrl = useTtsStore((state) => state.setLocalBaseUrl);
  const setLocalApiKey = useTtsStore((state) => state.setLocalApiKey);
  const setVoiceId = useTtsStore((state) => state.setVoiceId);
  const speak = useTtsStore((state) => state.speak);

  // 学情与画像
  const profile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setProfileModalOpen = useUserProfileStore((s) => s.setProfileModalOpen);
  const shell = useLearningShell();
  const speechLang = trackToSpeechLang(shell.track);
  const dictionaryPackages = useDictionaryPackagesQuery(open);
  const installDictionaryPackage = useInstallDictionaryPackageMutation();
  const updateDictionaryPackage = useUpdateDictionaryPackageMutation();
  const installCustomDictionary = useInstallCustomDictionaryMutation();
  const ankiStatus = useAnkiStatusQuery(open);
  const saveAnkiSettings = useSaveAnkiSettingsMutation();
  const [customDictLicenseOk, setCustomDictLicenseOk] = useState(false);
  const [cardWorkbenchOpen, setCardWorkbenchOpen] = useState(false);
  const [customDictLang, setCustomDictLang] = useState<'ja' | 'en' | 'ko'>(shell.track);
  // 可安装包以 Gateway 目录为准（oewn-2025 / jmdict-e / kengdic-2021…），前端不写死 id。
  const installableDictionaries = dictionaryPackages.data?.packages ?? [];
  const dictionaryLangLabel = (language: string): string =>
    language === 'ja' ? '日语' : language === 'ko' ? '韩语' : '英语';

  // P4-B：桌面端专属（Web 端不渲染）。getPlatform 在 Tauri WebView 内返回桌面实现。
  const [isDesktop, setIsDesktop] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  useEffect(() => {
    try {
      setIsDesktop(getPlatform().isDesktop());
    } catch {
      setIsDesktop(false);
    }
  }, []);

  const handleInstallDictionary = (packageId: string) => {
    const target = installableDictionaries.find((item) => item.id === packageId);
    if (!target || installDictionaryPackage.isPending) return;
    sound.playClick();
    installDictionaryPackage.mutate(target.id, {
      onSuccess: (installed) => {
        toast.success(
          `${dictionaryLangLabel(target.language)}离线词典已安装：${installed.entryCount?.toLocaleString() ?? ''} 条词条`
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '词典包安装失败，请稍后重试。');
      },
    });
  };

  const handleCustomDictionaryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || installCustomDictionary.isPending) return;
    if (!customDictLicenseOk) {
      toast.error('请先勾选许可证确认，再安装自备词典。');
      return;
    }
    sound.playClick();
    installCustomDictionary.mutate(
      { file, language: customDictLang },
      {
        onSuccess: (installed) => {
          toast.success(
            `自备词典已安装：${installed.entryCount?.toLocaleString() ?? ''} 条（许可证未验证）`
          );
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : '自备词典安装失败。');
        },
      }
    );
  };

  const handleBackupDatabase = async () => {
    if (backupPending) return;
    sound.playClick();
    setBackupPending(true);
    try {
      const dest = await backupDesktopDatabase();
      toast.success('学习数据库已备份', { description: dest });
    } catch (e) {
      // 用户取消保存对话框不算错误，不打扰
      const message = e instanceof Error ? e.message : '备份失败，请稍后重试。';
      if (!message.includes('未选择保存路径')) {
        toast.error(message);
      }
    } finally {
      setBackupPending(false);
    }
  };

  const handleCheckForUpdate = async () => {
    if (updateChecking) return;
    sound.playClick();
    setUpdateChecking(true);
    try {
      const update = await checkForAppUpdate();
      if (!update) {
        toast.success('当前已是最新版本');
        return;
      }
      toast(`Lingua Studio ${update.version} 已可用`, {
        description: update.notes || '包含稳定性改进与学习体验优化。',
        duration: 12_000,
        action: {
          label: '立即更新',
          onClick: () => {
            void update.install().catch(() => {
              toast.error('更新安装失败，当前版本仍可继续使用。');
            });
          },
        },
      });
    } catch {
      toast.error('暂时无法检查更新，请稍后再试。');
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={() => sound.playClick()}
        className={buttonVariants({
          variant: 'outline',
          size: 'sm',
          className: 'gap-1.5 text-ink-mute border-line-soft hover:border-tone-amber-500o40 cursor-pointer h-8 sm:h-9 px-2.5 sm:px-3 text-xs',
        })}
        title="系统与语音设置"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-ink-ghost" />
        <span className="hidden md:inline font-medium">设置</span>
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isConnected ? 'bg-tone-emerald-500' : 'bg-ink-amber-400'
          }`}
        />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-80 max-h-[calc(100dvh-2rem)] p-0 flex flex-col border border-line-stone-200o90-stone-800o90 shadow-xl rounded-2xl bg-veil-whiteo95 dark:bg-surface-h1a1917o95 backdrop-blur-md overflow-hidden z-50 transition-colors"
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-tone-stone-100-stone-800o80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-tone-amber-500" />
            <h4 className="font-semibold text-xs text-ink-soft">
              系统控制中心
            </h4>
          </div>
          {/* 网关轻量状态指示 */}
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            {isConnected ? (
              <span className="inline-flex items-center gap-1 text-ink-emerald-600-emerald-400">
                <Wifi className="w-3 h-3" />
                <span>已联通{latencyMs ? ` (${latencyMs}ms)` : ''}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-accent-ink">
                <WifiOff className="w-3 h-3" />
                <span>离线模式</span>
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
          {isDesktop && (
            <div className="space-y-2 rounded-xl border border-tone-amber-500o25 bg-wash-amber-50o60-amber-950o20 p-2.5 dark:border-line-amber-400o20 transition-colors">
              <div className="flex items-center justify-between font-medium text-ink-mute">
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-tone-amber-500" />
                  <span>应用更新</span>
                </div>
                <Badge
                  variant="outline"
                  className="border-line-amber-500o30 px-1.5 py-0 text-[10px] text-accent-ink"
                >
                  桌面端
                </Badge>
              </div>
              <p className="text-[10px] leading-relaxed text-ink-ghost">
                启动时会自动检查更新；你也可以随时手动检查。更新应用不会覆盖学习数据和本地配置。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full gap-1.5 border-line-amber-500o30 text-[11px] text-tone-amber-700 hover:bg-wash-amber-100o70 dark:text-ink-amber-300 dark:hover:bg-grad-amber-950o40 transition-colors"
                disabled={updateChecking}
                onClick={() => void handleCheckForUpdate()}
              >
                <RefreshCw className={updateChecking ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                {updateChecking ? '正在检查…' : '检查更新'}
              </Button>
            </div>
          )}

          {/* 1. TTS 设置：宿主仅保存偏好并调用包，不在本地选择模型或音色。 */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 font-medium text-ink-mute">
              <Volume2 className="w-3.5 h-3.5 text-tone-amber-500" />
              <span>语音朗读</span>
              <Badge variant="outline" className="text-[10px]">{speechLang}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {([
                { value: 'gemini', label: 'Gemini' },
                { value: 'azure', label: 'Azure' },
                { value: 'local', label: '本地 TTS' },
              ] as const).map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  size="sm"
                  variant={preferredService === item.value ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => setPreferredService(item.value)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant={gender === 'FEMALE' ? 'default' : 'outline'} onClick={() => setGender('FEMALE')}>女声</Button>
              <Button size="sm" variant={gender === 'MALE' ? 'default' : 'outline'} onClick={() => setGender('MALE')}>男声</Button>
            </div>
            {preferredService === 'gemini' && (
              <input type="password" autoComplete="off" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder="Gemini API Key（可留空，使用网关环境变量）" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
            )}
            {preferredService === 'azure' && (
              <>
                <input type="password" autoComplete="off" value={azureKey} onChange={(event) => setAzureKey(event.target.value)} placeholder="Azure API Key" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
                <input type="text" value={azureRegion} onChange={(event) => setAzureRegion(event.target.value)} placeholder="Azure 区域，如 japaneast" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
              </>
            )}
            <input type="text" value={localBaseUrl} onChange={(event) => setLocalBaseUrl(event.target.value)} placeholder="本地 TTS 地址（可留空，使用网关 LOCAL_TTS_ENDPOINT）" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
            <input type="password" autoComplete="off" value={localApiKey} onChange={(event) => setLocalApiKey(event.target.value)} placeholder="本地 TTS API Key（可选）" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
            <input type="text" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} placeholder="音色 ID（可留空，由 TTS 包选择）" className="w-full p-2 text-[11px] rounded-lg bg-surface-coal border border-line-stone-300-stone-700 text-ink-soft" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-ghost">播放速度 {rate.toFixed(1)}x</span>
              <Slider value={rate} min={0.5} max={1.5} step={0.1} onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (typeof next === 'number') setRate(next);
              }} />
            </div>
            <p className="text-[10px] text-ink-ghost">首选服务失败时，包只尝试本地 TTS；失败原因会显示。播放速度在客户端调整，0.3.0 尚不支持合成语速。</p>
            <Button type="button" size="sm" variant="outline" className="w-full h-7 text-[11px]" onClick={() => {
              sound.playClick();
              void speak(getPreviewText(speechLang, gender), { lang: speechLang, gender, purpose: 'preview' });
            }}>试听当前配置</Button>
          </div>

          <div className="h-px bg-tone-stone-100-stone-800o80" />

          {/* 3. 词典包：内容按需进入 SQLite，避免初装体积与无授权数据混入。 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-medium text-ink-mute">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-tone-amber-500" />
                <span>离线词典包</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => {
                  sound.playClick();
                  setCardWorkbenchOpen(true);
                }}
              >
                卡片模板
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
            {installableDictionaries.length > 0 ? (
              <div className="space-y-2">
                {installableDictionaries.map((dictionary) => (
                  <div
                    key={dictionary.id}
                    className="rounded-xl border border-line-stone-200o80 bg-veil-stone-50o70 p-2.5 dark:border-tone-stone-800 dark:bg-veil-stone-900o50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-soft">
                          {dictionaryLangLabel(dictionary.language)}释义 · {dictionary.provider}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-ink-ghost">
                          {dictionary.installed
                            ? `已写入本机 SQLite${dictionary.entryCount ? ` · ${dictionary.entryCount.toLocaleString()} 条` : ''}`
                            : dictionary.installerReady === false
                              ? '安装器即将推出，暂不可安装。'
                              : '未预装；仅在你点击安装后下载并写入本机 SQLite。'}
                        </p>
                      </div>
                      {dictionary.installed ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-[11px]"
                            disabled={!isConnected || updateDictionaryPackage.isPending}
                            title="优先（查词排序提前）"
                            onClick={() => {
                              sound.playClick();
                              updateDictionaryPackage.mutate({
                                packageId: dictionary.id,
                                priority: (dictionary.priority ?? 0) + 1,
                              });
                            }}
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-[11px]"
                            disabled={!isConnected || updateDictionaryPackage.isPending}
                            title={dictionary.enabled === false ? '已禁用，点击启用' : '已启用，点击禁用'}
                            onClick={() => {
                              sound.playClick();
                              updateDictionaryPackage.mutate({
                                packageId: dictionary.id,
                                enabled: !(dictionary.enabled ?? true),
                              });
                            }}
                          >
                            {dictionary.enabled === false ? '已禁用' : '已启用'}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                          disabled={!isConnected || installDictionaryPackage.isPending || dictionary.installerReady === false}
                          onClick={() => handleInstallDictionary(dictionary.id)}
                        >
                          {installDictionaryPackage.isPending ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          安装
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-[10px] text-ink-stone-400">
                      {dictionary.licenseName} · 已保留来源与署名
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-stone-500">正在读取词典包状态…</p>
            )}
            <div className="rounded-xl border border-dashed border-line-stone-300o80 p-2.5 dark:border-tone-stone-700 transition-colors">
              <p className="text-[11px] font-medium text-ink-mute">
                自备 Yomitan 词典包（bank v3 .zip）
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-tone-amber-600 px-2 py-1 text-[11px] font-semibold text-tone-white hover:bg-tone-amber-700">
                  <Download className="h-3 w-3" />
                  {installCustomDictionary.isPending ? '安装中…' : '选择 zip 安装'}
                  <input
                    type="file"
                    accept=".zip"
                    className="hidden"
                    disabled={installCustomDictionary.isPending}
                    onChange={handleCustomDictionaryFile}
                  />
                </label>
                <Select
                  value={customDictLang}
                  onValueChange={(v) => {
                    if (v === 'ja' || v === 'en' || v === 'ko') setCustomDictLang(v);
                  }}
                >
                  <SelectTrigger className="h-7 w-20 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">日语</SelectItem>
                    <SelectItem value="en">英语</SelectItem>
                    <SelectItem value="ko">韩语</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="mt-1.5 flex cursor-pointer items-start gap-1.5 text-[10px] leading-relaxed text-ink-stone-500">
                <input
                  type="checkbox"
                  checked={customDictLicenseOk}
                  onChange={(e) => setCustomDictLicenseOk(e.target.checked)}
                  className="mt-0.5"
                />
                <span>我确认有权使用该词典并接受其许可证（网关如实标注“未验证”）。</span>
              </label>
            </div>
          </div>

          <div className="h-px bg-tone-stone-100-stone-800o80" />

          {/* 3b. Anki 推送（EXTERNAL 桥接，默认关闭；只连本机 AnkiConnect）。 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-medium text-ink-mute">
              <div className="flex items-center gap-1.5">
                <Plug className="w-3.5 h-3.5 text-tone-amber-500" />
                <span>推送到 Anki</span>
              </div>
              {ankiStatus.data && (
                <Badge
                  variant="outline"
                  className="border-line-amber-500o30 px-1.5 py-0 text-[10px] text-accent-ink"
                >
                  {ankiStatus.data.connected
                    ? `已连接 v${ankiStatus.data.ankiVersion ?? '?'}`
                    : '本机 Anki 未连接'}
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line-stone-200o80 bg-veil-stone-50o70 p-2.5 dark:border-tone-stone-800 dark:bg-veil-stone-900o50 transition-colors">
              <p className="text-[10px] leading-relaxed text-ink-ghost">
                把生词本卡片推送到本机 Anki（需打开 Anki + 安装 AnkiConnect 插件）。关闭时查词面板不显示推送入口。
              </p>
              <Switch
                checked={ankiStatus.data?.enabled ?? false}
                disabled={!isConnected || saveAnkiSettings.isPending}
                onCheckedChange={(v) => {
                  sound.playClick();
                  saveAnkiSettings.mutate(
                    { enabled: v },
                    {
                      onError: (e) =>
                        toast.error(e instanceof Error ? e.message : 'Anki 设置保存失败。'),
                    }
                  );
                }}
              />
            </div>
          </div>

          <div className="h-px bg-tone-stone-100-stone-800o80" />

          {/* 4. 学情画像与打卡目标入口 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-medium text-ink-mute">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-tone-amber-500" />
                <span>学习者画像与打卡</span>
              </div>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-line-amber-500o30 text-accent-ink">
                {profile.studyGoal.replace('JLPT_', '')}
              </Badge>
            </div>

            <div
              onClick={() => {
                sound.playClick();
                setOpen(false);
                setProfileModalOpen(true);
              }}
              className="p-2.5 rounded-xl border border-tone-stone-200o80-stone-800 hover:border-tone-amber-500o40 bg-veil-stone-50o70-stone-900o50 flex items-center justify-between cursor-pointer group transition-all"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 text-tone-stone-950 font-bold flex items-center justify-center text-xs shrink-0">
                  {profile.displayName.slice(0, 1) || '学'}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-ink-soft truncate">
                    {profile.displayName || '学员'}
                  </div>
                  <div className="text-[10px] text-ink-ghost flex items-center gap-1.5">
                    <span className="flex items-center gap-0.5 text-accent-ink font-medium">
                      <Flame className="w-2.5 h-2.5 fill-current" />
                      {profile.streakDays} 天连续
                    </span>
                    <span>·</span>
                    <span>
                      {dailyTask.quizzesCount + dailyTask.cardsReviewedCount}/
                      {dailyTask.dailyGoalQuizzes + dailyTask.dailyGoalCards} 任务
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 text-[11px] text-ink-stone-400 group-hover:text-tone-amber-500 transition-colors shrink-0">
                <span>管理</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* 5. 桌面端数据管理（仅 Tauri 壳内可见） */}
          {isDesktop && (
            <>
              <div className="h-px bg-tone-stone-100-stone-800o80" />
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-medium text-ink-mute">
                  <DatabaseBackup className="w-3.5 h-3.5 text-tone-amber-500" />
                  <span>学习数据管理</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-line-amber-500o30 text-accent-ink">
                    桌面端
                  </Badge>
                </div>
                <div className="rounded-xl border border-line-stone-200o80 bg-veil-stone-50o70 p-2.5 dark:border-tone-stone-800 dark:bg-veil-stone-900o50 transition-colors">
                  <p className="text-[10px] leading-relaxed text-ink-ghost">
                    学习库保存在本机应用数据目录，随应用重启保留。建议定期备份；恢复时把备份文件放回原目录并重启应用即可。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 gap-1 px-2 text-[11px]"
                    disabled={backupPending}
                    onClick={() => void handleBackupDatabase()}
                  >
                    {backupPending ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    备份学习数据库
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        <AnkiTemplateWorkbench open={cardWorkbenchOpen} onOpenChange={setCardWorkbenchOpen} />
      </PopoverContent>
    </Popover>
  );
}
