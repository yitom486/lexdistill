import { useState } from 'react';
import { BookOpen, ChevronRight, Download, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { sound } from '../../utils/audio.js';
import {
  useDictionaryPackagesQuery,
  useInstallDictionaryPackageMutation,
  useInstallCustomDictionaryMutation,
  useUpdateDictionaryPackageMutation,
} from '../../queries/useLearnerQueries.js';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select.js';
import { useLearningShell } from '../../hooks/useLearningShell.js';
import { AnkiTemplateWorkbench } from '../AnkiTemplateWorkbench.js';

interface SettingsDictionarySectionProps {
  isConnected: boolean;
  active: boolean;
}

function dictionaryLangLabel(language: string): string {
  return language === 'ja' ? '日语' : language === 'ko' ? '韩语' : '英语';
}

/** 离线词典包：目录以网关为准；读取中/失败/空/有数据四态，离线禁用原因明确。 */
export function SettingsDictionarySection({ isConnected, active }: SettingsDictionarySectionProps) {
  const shell = useLearningShell();
  const dictionaryPackages = useDictionaryPackagesQuery(active);
  const installDictionaryPackage = useInstallDictionaryPackageMutation();
  const updateDictionaryPackage = useUpdateDictionaryPackageMutation();
  const installCustomDictionary = useInstallCustomDictionaryMutation();
  const [customDictLicenseOk, setCustomDictLicenseOk] = useState(false);
  const [cardWorkbenchOpen, setCardWorkbenchOpen] = useState(false);
  const [customDictLang, setCustomDictLang] = useState<'ja' | 'en' | 'ko'>(shell.track);
  // 可安装包以 Gateway 目录为准（oewn-2025 / jmdict-e / kengdic-2021…），前端不写死 id。
  const installableDictionaries = dictionaryPackages.data?.packages ?? [];

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
    if (!file || !isConnected || installCustomDictionary.isPending) return;
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

  return (
    <div id="settings-dictionaries" className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-tone-amber-500" />
          <span>离线词典包</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-sm"
          onClick={() => {
            sound.playClick();
            setCardWorkbenchOpen(true);
          }}
        >
          卡片模板
          <ChevronRight className="w-3 h-3" />
        </Button>
      </div>
      {!isConnected && (
        <p className="text-xs text-ink-ghost">离线时不可安装或调整词典包，需连接网关。</p>
      )}
      {dictionaryPackages.isPending ? (
        <p className="text-sm text-ink-stone-500">正在读取词典包状态…</p>
      ) : dictionaryPackages.isError ? (
        <div className="text-sm text-ink-stone-500">
          <p>词典包状态读取失败，请检查网关后重试。</p>
          <button
            type="button"
            onClick={() => void dictionaryPackages.refetch()}
            className="mt-1 underline underline-offset-2 text-accent-ink-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
          >
            重新读取
          </button>
        </div>
      ) : installableDictionaries.length > 0 ? (
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
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-ghost">
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
                      className="h-7 w-7 p-0 text-sm"
                      disabled={!isConnected || updateDictionaryPackage.isPending}
                      title={!isConnected ? '离线时不可调整，需连接网关' : '优先（查词排序提前）'}
                      aria-label="优先查词排序"
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
                      className="h-7 gap-1 px-2 text-sm"
                      disabled={!isConnected || updateDictionaryPackage.isPending}
                      title={!isConnected ? '离线时不可调整，需连接网关' : dictionary.enabled === false ? '已禁用，点击启用' : '已启用，点击禁用'}
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
                    className="h-7 shrink-0 gap-1 px-2 text-sm"
                    disabled={!isConnected || installDictionaryPackage.isPending || dictionary.installerReady === false}
                    title={!isConnected ? '离线时不可安装，需连接网关' : undefined}
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
              <p className="mt-2 text-sm text-ink-stone-400">
                {dictionary.licenseName} · 已保留来源与署名
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-stone-500">网关暂无可安装词典包。</p>
      )}
      <div className="rounded-xl border border-dashed border-line-stone-300o80 p-2.5 dark:border-tone-stone-700 transition-colors">
        <p className="text-sm font-medium text-ink-mute">
          自备 Yomitan 词典包（bank v3 .zip）
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-lg bg-tone-amber-600 px-2 py-1 text-sm font-semibold text-tone-white hover:bg-tone-amber-700 focus-within:ring-2 focus-within:ring-focus-ring has-[:disabled]:opacity-50">
            <Download className="h-3 w-3" />
            {installCustomDictionary.isPending ? '安装中…' : '选择 zip 安装'}
            <input
              type="file"
              accept=".zip"
              aria-label="选择自备词典 zip 安装"
              title={!isConnected ? '离线时不可安装，需连接网关' : undefined}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              disabled={!isConnected || installCustomDictionary.isPending}
              onChange={handleCustomDictionaryFile}
            />
          </label>
          <Select
            value={customDictLang}
            onValueChange={(v) => {
              if (v === 'ja' || v === 'en' || v === 'ko') setCustomDictLang(v);
            }}
          >
            <SelectTrigger className="h-7 w-20 text-sm" aria-label="自备词典语种">
              <SelectValue>{dictionaryLangLabel(customDictLang)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ja">日语</SelectItem>
              <SelectItem value="en">英语</SelectItem>
              <SelectItem value="ko">韩语</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="mt-1.5 flex cursor-pointer items-start gap-1.5 text-sm leading-relaxed text-ink-stone-500">
          <input
            type="checkbox"
            checked={customDictLicenseOk}
            onChange={(e) => setCustomDictLicenseOk(e.target.checked)}
            className="mt-0.5"
          />
          <span>我确认有权使用该词典并接受其许可证（网关如实标注“未验证”）。</span>
        </label>
      </div>
      <AnkiTemplateWorkbench open={cardWorkbenchOpen} onOpenChange={setCardWorkbenchOpen} />
    </div>
  );
}
