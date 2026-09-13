import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Play, Loader2, Sparkles, CopyPlus } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Switch } from '../ui/switch.js';
import { isTemplateDueOn } from '@study-studio/learning';
import { usePracticeTemplatesQuery, useDeletePracticeTemplateMutation, useStartPracticeRunMutation, useProposeTemplateMutation, useTogglePracticeTemplateMutation, useCopyPracticeTemplateMutation } from '../../queries/useLearnerQueries.js';
import { PracticePlanEditor } from './PracticePlanEditor.js';
import { PracticeRunWorkbench } from './PracticeRunWorkbench.js';
import type { PracticePlanTemplate, PracticeBlockSpec } from '@study-studio/protocol';

/** 本地日期 YYYY-MM-DD（排程到期判定用用户时区） */
function todayLocalDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** P5：练习计划面板。模板列表 + 新建/编辑/删除/开始今日运行；开始后进入运行工作台。 */

interface PracticePlanPanelProps {
  userId: string;
  language: 'en' | 'ja' | 'ko';
}

export function PracticePlanPanel({ userId, language }: PracticePlanPanelProps) {
  const { data: templates = [], isLoading, isError, error, refetch } = usePracticeTemplatesQuery(userId, language);
  const deleteMutation = useDeletePracticeTemplateMutation(userId);
  const startMutation = useStartPracticeRunMutation(userId);
  const proposeMutation = useProposeTemplateMutation(userId);
  const toggleMutation = useTogglePracticeTemplateMutation(userId);
  const copyMutation = useCopyPracticeTemplateMutation(userId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PracticePlanTemplate | null>(null);
  const [proposal, setProposal] = useState<{ suggestedName: string; blocks: PracticeBlockSpec[] } | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // P6-1：今日到期模板置顶（稳定排序，其余保持原顺序）
  const sortedTemplates = useMemo(() => {
    const today = todayLocalDate();
    return [...templates].sort((a, b) => {
      const dueA = isTemplateDueOn(a, today) ? 0 : 1;
      const dueB = isTemplateDueOn(b, today) ? 0 : 1;
      return dueA - dueB;
    });
  }, [templates]);
  const isDueToday = (tpl: PracticePlanTemplate) => isTemplateDueOn(tpl, todayLocalDate());

  const openNew = () => {
    setEditing(null);
    setProposal(null);
    setEditorOpen(true);
  };
  const openEdit = (tpl: PracticePlanTemplate) => {
    setEditing(tpl);
    setProposal(null);
    setEditorOpen(true);
  };
  const handlePropose = async () => {
    try {
      const p = await proposeMutation.mutateAsync(language);
      setEditing(null);
      setProposal({ suggestedName: p.suggestedName, blocks: p.blocks });
      setEditorOpen(true);
      toast.success('已生成智能建议草案，可在编辑器中调整后保存');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const handleDelete = async (tpl: PracticePlanTemplate) => {
    try {
      await deleteMutation.mutateAsync(tpl.id);
      toast.success('模板已删除');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const handleStart = async (tpl: PracticePlanTemplate) => {
    try {
      const run = await startMutation.mutateAsync({ language, templateId: tpl.id });
      toast.success('已开始练习运行');
      setActiveRunId(run.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const handleToggle = async (tpl: PracticePlanTemplate, enabled: boolean) => {
    try {
      await toggleMutation.mutateAsync({ templateId: tpl.id, enabled });
      toast.success(enabled ? '模板已启用' : '模板已停用');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const handleCopy = async (tpl: PracticePlanTemplate) => {
    try {
      await copyMutation.mutateAsync(tpl.id);
      toast.success('已创建副本（默认停用），可编辑后启用');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (activeRunId) {
    return (
      <PracticeRunWorkbench
        runId={activeRunId}
        userId={userId}
        language={language}
        onCompleted={() => {
          // 完成后留在工作台复盘视图，由用户主动返回；不再直接卸载
          toast.success('练习已完成');
        }}
        onExit={() => setActiveRunId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">我的练习计划</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={handlePropose} disabled={proposeMutation.isPending}>
            <Sparkles className="mr-1 h-3 w-3" />智能建议
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-3 w-3" />新建
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-xs text-ink-slate-400">加载中…</div>}
      {isError && (
        <div className="rounded-md border border-line-rose-200 p-3 text-xs text-ink-rose-600">
          练习计划加载失败：{(error as Error).message}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()}>重试</Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {sortedTemplates.map((tpl) => (
          <div key={tpl.id} className="flex items-center justify-between rounded-md border border-line-slate-200-slate-700 p-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={tpl.enabled}
                  onCheckedChange={(checked) => handleToggle(tpl, checked)}
                  disabled={toggleMutation.isPending}
                  title={tpl.enabled ? '点击停用该模板' : '点击启用该模板'}
                />
                <span className={tpl.enabled ? 'text-sm font-medium' : 'text-sm font-medium text-ink-slate-400'}>
                  {tpl.name}
                </span>
                {isDueToday(tpl) && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">今日适用</Badge>
                )}
                <Badge variant="secondary">revision {tpl.revision}</Badge>
              </div>
              <span className="text-xs text-ink-slate-500">
                {tpl.blocks.map((b) => `${b.kind}×${b.count}`).join(' · ')}
              </span>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => openEdit(tpl)} title="编辑模板"><Pencil className="h-3 w-3" /></Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(tpl)}
                disabled={copyMutation.isPending}
                title="复制模板"
              >
                <CopyPlus className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(tpl)} title="删除模板"><Trash2 className="h-3 w-3" /></Button>
              <Button
                size="sm"
                onClick={() => handleStart(tpl)}
                disabled={!tpl.enabled || startMutation.isPending}
              >
                {startMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                开始
              </Button>
            </div>
          </div>
        ))}
        {templates.length === 0 && !isLoading && !isError && (
          <div className="rounded-md border border-dashed border-line-slate-300 p-6 text-center text-sm text-ink-slate-400">
            还没有练习计划，点击「新建」创建第一个
          </div>
        )}
      </div>

      <PracticePlanEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        userId={userId}
        language={language}
        template={editing}
        proposal={proposal}
      />
    </div>
  );
}
