import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, Save, Loader2 } from 'lucide-react';
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
import { BlockRow } from './PracticeBlockEditor.js';
import { BLOCK_KINDS, BLOCK_KIND_LABELS, VOCAB_KINDS } from './practice-plan-editor-options.js';
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
  const isObjective = kind === 'VOCAB_REVIEW' || kind === 'VOCAB_NEW' || kind === 'QUIZ' || kind === 'CLOZE' || kind === 'READING' || kind === 'DICTATION';
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
      <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{template ? '编辑练习计划' : '新建练习计划'}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-4 pr-1">
          <div className="flex items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：考研英语晚间 35 分钟"
              aria-label="模板名称"
              className="min-w-0 flex-1 rounded-md border border-line-slate-300 px-3 py-2 text-sm dark:border-ink-slate-600 transition-colors"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-slate-500">重复</span>
            <Select value={scheduleKind} onValueChange={(v) => v && setScheduleKind(v as 'daily' | 'weekly')}>
              <SelectTrigger aria-label="重复安排" className="w-[8rem]"><SelectValue>{scheduleKind === 'daily' ? '每天' : '按星期'}</SelectValue></SelectTrigger>
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

        <DialogFooter className="shrink-0 gap-2">
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
