import { useState } from 'react';
import { toast } from 'sonner';
import { FolderInput, LoaderCircle } from 'lucide-react';
import { FIELD_MARKERS } from '@lexdistill/learner-core';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import {
  useAnalyzeApkgMutation,
  useImportApkgNotesMutation,
  useSaveCardFormatMutation,
  type ApkgAnalysis,
} from '../queries/useLearnerQueries.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { sound } from '../utils/audio.js';

interface ApkgImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function slugifyModel(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `apkg-${slug || 'model'}`;
}

/**
 * `.apkg` 导入对话框（生词本入口）。
 * 分析（只读）→ 选牌组搬家 / 逐模板确认映射后保存，两条路径互不阻塞。
 */
export function ApkgImportDialog({ open, onOpenChange }: ApkgImportDialogProps) {
  const shell = useLearningShell();
  const analyze = useAnalyzeApkgMutation();
  const importNotes = useImportApkgNotesMutation();
  const saveFormat = useSaveCardFormatMutation();
  const [filePath, setFilePath] = useState('');
  const [analysis, setAnalysis] = useState<ApkgAnalysis | null>(null);
  const [selectedDecks, setSelectedDecks] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, Record<string, string | null>>>({});

  const handleAnalyze = () => {
    const path = filePath.trim();
    if (!path) {
      toast.error('请先填写本机 .apkg 绝对路径。');
      return;
    }
    sound.playClick();
    analyze.mutate(path, {
      onSuccess: (a) => {
        setAnalysis(a);
        setSelectedDecks(a.decks.map((d) => d.name));
        const next: Record<string, Record<string, string | null>> = {};
        for (const m of a.models) next[m.modelName] = { ...m.fieldMapping };
        setMappings(next);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : '.apkg 分析失败。'),
    });
  };

  const handleImport = () => {
    if (!analysis) return;
    sound.playClick();
    importNotes.mutate(
      {
        filePath: filePath.trim(),
        language: shell.track,
        deckNames: selectedDecks,
      },      {
        onSuccess: (r) => {
          toast.success(
            `导入完成：新建 ${r.created} 张${r.skippedDuplicate ? `（去重 ${r.skippedDuplicate}）` : ''}${r.mediaSkipped ? `（媒体 ${r.mediaSkipped} 处待 S4 底座）` : ''}`
          );
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '.apkg 导入失败。'),
      }
    );
  };

  const handleSaveTemplate = (modelName: string) => {
    const model = analysis?.models.find((m) => m.modelName === modelName);
    const mapping = mappings[modelName];
    if (!model || !mapping) return;
    const fields: Record<string, string> = {};
    for (const [ankiField, marker] of Object.entries(mapping)) {
      if (marker) fields[ankiField] = `{${marker}}`;
    }
    if (Object.keys(fields).length === 0) {
      toast.error('至少映射一个字段，否则保存的模板渲染全空。');
      return;
    }
    sound.playClick();
    saveFormat.mutate(
      {
        id: slugifyModel(modelName),
        name: `${modelName}（Anki 导入）`,
        entryType: 'term',
        fields,
        frontTemplate: model.front,
        backTemplate: model.back,
        css: model.css,
        templateVersion: 0,
        userModified: true,
      },
      {
        onSuccess: (r) => toast.success(`模板已保存：${r.format.name}，可在卡片模板中选用。`),
        onError: (e) => toast.error(e instanceof Error ? e.message : '模板保存失败。'),
      }
    );
  };

  const toggleDeck = (name: string) => {
    setSelectedDecks((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>从 Anki 搬家（.apkg）</DialogTitle>
          <DialogDescription>
            只读分析后分两步走：笔记搬进生词本（进度重排为 NEW，去重），模板确认字段映射后保存复用。媒体文件暂只计数，待媒体底座。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="例如 C:\Users\你\Downloads\deck.apkg"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 rounded-xl border border-ink-stone-200 bg-tone-white px-3 font-mono text-xs dark:border-tone-stone-700 dark:bg-tone-stone-900 transition-colors"
            />
            <Button type="button" size="sm" onClick={handleAnalyze} disabled={analyze.isPending} className="gap-1.5">
              {analyze.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
              分析
            </Button>
          </div>

          {analysis && (
            <>
              <div className="rounded-xl border border-line-stone-200o80 p-3 text-xs dark:border-tone-stone-800 transition-colors">
                <p className="font-semibold">
                  {analysis.fileLabel}：{analysis.noteCount} 条笔记 / {analysis.cardCount} 张卡
                  {analysis.mediaFileCount ? ` / 媒体 ${analysis.mediaFileCount} 个（${analysis.mediaRefCount} 处引用暂跳过）` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {analysis.decks.map((d) => (
                    <label
                      key={d.name}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-stone-200 px-2.5 py-1 text-[11px] dark:border-tone-stone-700 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDecks.includes(d.name)}
                        onChange={() => toggleDeck(d.name)}
                      />
                      {d.name}（{d.noteCount}）
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleImport}
                  disabled={importNotes.isPending || selectedDecks.length === 0}
                  className="mt-2 gap-1.5"
                >
                  {importNotes.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                  导入选中牌组到生词本（{shell.track}）
                </Button>
                {importNotes.data && (
                  <p className="mt-1.5 text-[11px] text-tone-emerald-600">
                    新建 {importNotes.data.created} · 去重 {importNotes.data.skippedDuplicate} · 空正面{' '}
                    {importNotes.data.skippedEmpty} · 媒体入库 {importNotes.data.mediaStored} / 跳过{' '}
                    {importNotes.data.mediaSkipped}
                    {importNotes.data.truncated ? ' · 达到上限被截断' : ''}
                  </p>
                )}
              </div>

              {analysis.models.map((m) => (
                <div key={m.modelName} className="rounded-xl border border-line-stone-200o80 p-3 dark:border-tone-stone-800 transition-colors">
                  <p className="text-xs font-semibold">
                    {m.modelName}（{m.exampleNoteCount} 条笔记用此模板）
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {m.ankiFields.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-[11px]">
                        <code className="w-32 shrink-0 truncate font-mono text-ink-faint">{f}</code>
                        <span className="text-ink-stone-400">→</span>
                        <Select
                          value={mappings[m.modelName]?.[f] ?? '__none'}
                          onValueChange={(v) => {
                            if (typeof v !== 'string') return;
                            setMappings((prev) => ({
                              ...prev,
                              [m.modelName]: { ...prev[m.modelName], [f]: v === '__none' ? null : v },
                            }));
                          }}
                        >
                          <SelectTrigger className="h-7 flex-1 font-mono text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">不映射</SelectItem>
                            {FIELD_MARKERS.map((marker) => (
                              <SelectItem key={marker} value={marker}>
                                {`{${marker}}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  {m.compatIssues.length > 0 && (
                    <div className="mt-2 rounded-lg border border-tone-amber-500o40 bg-wash-amber-500o5 p-2 text-[11px] text-accent-ink-strong">
                      {m.compatIssues.map((issue) => (
                        <p key={issue}>⚠ {issue}</p>
                      ))}
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleSaveTemplate(m.modelName)}
                    disabled={saveFormat.isPending}
                    className="mt-2"
                  >
                    保存为我的模板
                  </Button>
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
