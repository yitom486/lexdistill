import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog.js';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select.js';
import { Slider } from '../ui/slider.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { useSavePracticeTemplateMutation } from '../../queries/useLearnerQueries.js';
import type { PracticePlanTemplate, PracticeBlockSpec, PracticeBlockKind, GradingMode, PracticePlanSchedule } from '@study-studio/protocol';
import { generateId } from '@study-studio/shared';

/** P5：练习计划编辑器。配置有序练习块（1–8），预览题量/AI 批改次数/时长，保存为模板。 */

interface PracticePlanEditorProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  /** 编辑已有模板；不传则为新建 */
  template?: PracticePlanTemplate | null;
  /** P5-PhaseD：AI 建议草案预填（无 template 时生效） */
  proposal?: { suggestedName: string; blocks: PracticeBlockSpec[] } | null;
}

const BLOCK_KINDS: PracticeBlockKind[] = [
  'VOCAB_REVIEW',
  'VOCAB_NEW',
  'QUIZ',
  'TRANSLATION',
  'DICTATION',
  'READING',
  'WRITING',
];
/** 块类型中文名（界面只展示中文，存库仍用枚举值） */
const BLOCK_KIND_LABELS: Record<PracticeBlockKind, string> = {
  VOCAB_REVIEW: '到期复习',
  VOCAB_NEW: '新词学习',
  QUIZ: '综合做题',
  TRANSLATION: '翻译练习',
  DICTATION: '听写练习',
  READING: '阅读理解',
  WRITING: '写作练习',
};
const GRADING_MODES: GradingMode[] = ['AUTO_IMMEDIATE', 'AI_IMMEDIATE', 'AI_BATCH'];
/** 批改方式中文名 */
const GRADING_MODE_LABELS: Record<GradingMode, string> = {
  AUTO_IMMEDIATE: '即时判定',
  AI_IMMEDIATE: 'AI 即时批改',
  AI_BATCH: 'AI 批量批改',
};
/** 翻译方向语言选项（存库仍用 zh/en/ja/ko 代码） */
const TRANSLATION_LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];
const VOCAB_KINDS = new Set<PracticeBlockKind>(['VOCAB_REVIEW', 'VOCAB_NEW']);
/** P6-1：星期选择（0=周日…6=周六） */
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

function defaultBlock(kind: PracticeBlockKind, language: string): PracticeBlockSpec {
  const isObjective = kind === 'VOCAB_REVIEW' || kind === 'VOCAB_NEW' || kind === 'QUIZ';
  const grading: GradingMode = isObjective ? 'AUTO_IMMEDIATE' : 'AI_BATCH';
  const block: PracticeBlockSpec = { id: generateId('blk'), kind, count: 5, gradingMode: grading };
  if (kind === 'TRANSLATION') {
    // #31：新建翻译块默认方向跟随当前轨道（ja→zh / ko→zh / en→zh）；编辑器内仍可手改。
    block.translationDirection = { sourceLanguage: language, targetLanguage: 'zh' };
  }
  if (VOCAB_KINDS.has(kind)) block.vocabularySource = 'DUE_CARDS';
  return block;
}

export function PracticePlanEditor({ isOpen, onClose, userId, language, template, proposal }: PracticePlanEditorProps) {
  const saveMutation = useSavePracticeTemplateMutation(userId);
  const [name, setName] = useState(template?.name ?? proposal?.suggestedName ?? '');
  const [blocks, setBlocks] = useState<PracticeBlockSpec[]>(template?.blocks ?? proposal?.blocks ?? []);
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  // P6-1：排程（缺省每日；weekly 需选星期）
  const [scheduleKind, setScheduleKind] = useState<'daily' | 'weekly'>(template?.schedule?.kind ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(
    template?.schedule?.kind === 'weekly' ? [...template.schedule.weekdays] : [1, 2, 3, 4, 5]
  );

  React.useEffect(() => {
    setName(template?.name ?? proposal?.suggestedName ?? '');
    setBlocks(template?.blocks ?? proposal?.blocks ?? []);
    setEnabled(template?.enabled ?? true);
    setScheduleKind(template?.schedule?.kind ?? 'daily');
    setWeekdays(template?.schedule?.kind === 'weekly' ? [...template.schedule.weekdays] : [1, 2, 3, 4, 5]);
  }, [template, proposal, isOpen]);

  const updateBlock = (id: string, patch: Partial<PracticeBlockSpec>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const addBlock = (kind: PracticeBlockKind) => {
    if (blocks.length >= 8) {
      toast.info('一个模板最多 8 个练习块');
      return;
    }
    setBlocks((prev) => [...prev, defaultBlock(kind, language)]);
  };
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) =>
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });

  const preview = useMemo(() => {
    let total = 0;
    let ai = 0;
    let minutes = 0;
    for (const b of blocks) {
      total += b.count;
      if (b.gradingMode !== 'AUTO_IMMEDIATE') ai += b.count;
      const per = b.kind === 'TRANSLATION' || b.kind === 'WRITING' ? 2 : b.kind === 'READING' ? 1.5 : 0.5;
      minutes += b.count * per;
    }
    return { total, ai, minutes: Math.max(1, Math.round(minutes)) };
  }, [blocks]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    if (blocks.length === 0) {
      toast.error('至少需要一个练习块');
      return;
    }
    if (scheduleKind === 'weekly' && weekdays.length === 0) {
      toast.error('按星期重复时至少选择一天');
      return;
    }
    const now = new Date().toISOString();
    const schedule: PracticePlanSchedule =
      scheduleKind === 'weekly'
        ? { kind: 'weekly', weekdays: [...weekdays].sort((a, b) => a - b) }
        : { kind: 'daily' };
    const tpl: PracticePlanTemplate = {
      id: template?.id ?? generateId('tpl'),
      userId,
      language,
      name: name.trim(),
      enabled,
      revision: template?.revision ?? 0,
      blocks,
      schedule,
      createdAt: template?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      const saved = await saveMutation.mutateAsync(tpl);
      void saved;
      toast.success('模板已保存');
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? '编辑练习计划' : '新建练习计划'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：考研英语晚间 35 分钟"
              className="flex-1 rounded-md border border-line-slate-300 px-3 py-2 text-sm dark:border-ink-slate-600"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-slate-500">重复</span>
            <Select value={scheduleKind} onValueChange={(v) => v && setScheduleKind(v as 'daily' | 'weekly')}>
              <SelectTrigger className="w-[8rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">每天</SelectItem>
                <SelectItem value="weekly">按星期</SelectItem>
              </SelectContent>
            </Select>
            {scheduleKind === 'weekly' && (
              <div className="flex gap-1">
                {WEEKDAYS.map((d) => {
                  const active = weekdays.includes(d.value);
                  return (
                    <Button
                      key={d.value}
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      className="h-7 w-7 p-0 text-xs"
                      onClick={() =>
                        setWeekdays((prev) =>
                          prev.includes(d.value) ? prev.filter((w) => w !== d.value) : [...prev, d.value]
                        )
                      }
                    >
                      {d.label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {BLOCK_KINDS.map((k) => (
              <Button key={k} size="sm" variant="outline" onClick={() => addBlock(k)}>
                <Plus className="mr-1 h-3 w-3" />
                {BLOCK_KIND_LABELS[k]}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {blocks.map((b, i) => (
              <BlockRow
                key={b.id}
                block={b}
                index={i}
                onUpdate={(patch) => updateBlock(b.id, patch)}
                onRemove={() => removeBlock(b.id)}
                onUp={() => move(b.id, -1)}
                onDown={() => move(b.id, 1)}
              />
            ))}
            {blocks.length === 0 && (
              <div className="rounded-md border border-dashed border-line-slate-300 p-6 text-center text-sm text-ink-slate-400">
                点击上方按钮添加练习块
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 rounded-md bg-surface-slate-50-slate-800 p-3 text-sm">
            <Badge variant="secondary">预计 {preview.total} 题</Badge>
            <Badge variant="secondary">AI 批改 {preview.ai} 次</Badge>
            <Badge variant="secondary">约 {preview.minutes} 分钟</Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存模板
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BlockRowProps {
  block: PracticeBlockSpec;
  index: number;
  onUpdate: (patch: Partial<PracticeBlockSpec>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}

function BlockRow({ block, index, onUpdate, onRemove, onUp, onDown }: BlockRowProps) {
  const isVocab = VOCAB_KINDS.has(block.kind);
  return (
    <div className="rounded-md border border-line-slate-200-slate-700 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-slate-500">第 {index + 1} 块 · {BLOCK_KIND_LABELS[block.kind]}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onUp}><ArrowUp className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" onClick={onDown}><ArrowDown className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={block.kind} onValueChange={(v) => v && onUpdate({ kind: v as PracticeBlockKind })}>
          <SelectTrigger className="w-[8.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BLOCK_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{BLOCK_KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={block.gradingMode} onValueChange={(v) => v && onUpdate({ gradingMode: v as GradingMode })}>
          <SelectTrigger className="w-[8.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GRADING_MODES.map((g) => (
              <SelectItem key={g} value={g}>{GRADING_MODE_LABELS[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(block.difficulty ?? 3)}
          onValueChange={(v) => v && onUpdate({ difficulty: Number(v) })}
        >
          <SelectTrigger className="w-[6rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((d) => (
              <SelectItem key={d} value={String(d)}>难度 {d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-ink-slate-500">题量 {block.count}</span>
        <Slider
          value={[block.count]}
          min={1}
          max={20}
          step={1}
          onValueChange={(val) => {
            const n = Array.isArray(val) ? val[0] : typeof val === 'number' ? val : undefined;
            if (typeof n === 'number') onUpdate({ count: n });
          }}
          className="flex-1"
        />
      </div>
      {isVocab && (
        <div className="mt-2">
          <Select
            value={block.vocabularySource ?? 'DUE_CARDS'}
            onValueChange={(v) => v && onUpdate({ vocabularySource: v as PracticeBlockSpec['vocabularySource'] })}
          >
            <SelectTrigger className="w-[12rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DUE_CARDS">到期卡片</SelectItem>
              <SelectItem value="COLLECTED_WORDS">已收集生词</SelectItem>
              <SelectItem value="TOPIC_WORDS">指定主题新词</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {block.kind === 'TRANSLATION' && (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={block.translationDirection?.sourceLanguage ?? 'zh'}
            onValueChange={(v) =>
              v &&
              onUpdate({
                translationDirection: {
                  sourceLanguage: v,
                  targetLanguage: block.translationDirection?.targetLanguage ?? 'en',
                },
              })
            }
          >
            <SelectTrigger className="w-[7rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSLATION_LANG_OPTIONS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
              {TRANSLATION_LANG_OPTIONS.every((l) => l.value !== (block.translationDirection?.sourceLanguage ?? 'zh')) && (
                <SelectItem value={block.translationDirection?.sourceLanguage ?? 'zh'}>
                  {block.translationDirection?.sourceLanguage ?? 'zh'}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <span className="self-center text-ink-slate-400">→</span>
          <Select
            value={block.translationDirection?.targetLanguage ?? 'en'}
            onValueChange={(v) =>
              v &&
              onUpdate({
                translationDirection: {
                  sourceLanguage: block.translationDirection?.sourceLanguage ?? 'zh',
                  targetLanguage: v,
                },
              })
            }
          >
            <SelectTrigger className="w-[7rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSLATION_LANG_OPTIONS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
              {TRANSLATION_LANG_OPTIONS.every((l) => l.value !== (block.translationDirection?.targetLanguage ?? 'en')) && (
                <SelectItem value={block.translationDirection?.targetLanguage ?? 'en'}>
                  {block.translationDirection?.targetLanguage ?? 'en'}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
