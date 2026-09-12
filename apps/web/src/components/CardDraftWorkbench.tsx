import React, { useState } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, X, Inbox } from 'lucide-react';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { sound } from '../utils/audio.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import {
  useCardDraftsQuery,
  useUpdateCardDraftMutation,
  useAcceptCardDraftMutation,
  useDismissCardDraftMutation,
  type CardDraftItem,
} from '../queries/useLearnerQueries.js';

const SOURCE_LABEL: Record<string, string> = {
  'ai-enrich': 'AI 抽词',
  agent: 'AI 助手',
  import: '导入',
};

function DraftRow({ draft }: { draft: CardDraftItem }) {
  const update = useUpdateCardDraftMutation();
  const accept = useAcceptCardDraftMutation();
  const dismiss = useDismissCardDraftMutation();
  const [editing, setEditing] = useState(false);
  const [headword, setHeadword] = useState(draft.headword);
  const [reading, setReading] = useState(draft.reading);
  const [meaningsText, setMeaningsText] = useState(draft.meanings.join('；'));
  const dirty =
    headword.trim() !== draft.headword ||
    reading.trim() !== draft.reading ||
    meaningsText.trim() !== draft.meanings.join('；');

  const handleSave = () => {
    if (update.isPending || !dirty) return;
    sound.playClick();
    update.mutate(
      {
        draftId: draft.id,
        patch: {
          headword: headword.trim(),
          reading: reading.trim(),
          meanings: meaningsText
            .split(/[；;]/)
            .map((m) => m.trim())
            .filter((m) => m),
        },
      },
      {
        onSuccess: () => {
          sound.playCorrect();
          setEditing(false);
          toast.success('草稿已更新（你改过的字段 AI 不再覆盖）');
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '草稿更新失败');
        },
      }
    );
  };

  const handleAccept = () => {
    if (accept.isPending) return;
    sound.playClick();
    accept.mutate(
      { draftId: draft.id },
      {
        onSuccess: () => {
          sound.playCorrect();
          toast.success(`已入库：${draft.headword}，开始按 FSRS 复习`);
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '草稿入库失败');
        },
      }
    );
  };

  const handleDismiss = () => {
    if (dismiss.isPending) return;
    sound.playClick();
    dismiss.mutate(
      { draftId: draft.id },
      {
        onSuccess: () => toast.success('已丢弃该草稿'),
        onError: (e) => toast.error(e instanceof Error ? e.message : '草稿驳回失败'),
      }
    );
  };

  return (
    <div className="p-3 rounded-2xl border border-line bg-surface space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">
          {editing ? (
            <input
              value={headword}
              onChange={(e) => setHeadword(e.target.value)}
              className="w-32 h-7 px-2 rounded-lg border border-line bg-surface outline-none focus:border-tone-amber-500 text-sm font-bold"
            />
          ) : (
            draft.headword
          )}
        </span>
        {editing ? (
          <input
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            placeholder="读音"
            className="w-28 h-7 px-2 rounded-lg border border-line bg-surface outline-none focus:border-tone-amber-500 text-xs"
          />
        ) : (
          draft.reading && (
            <span className="text-xs text-ink-ghost">{draft.reading}</span>
          )
        )}
        {draft.partOfSpeech && <Badge variant="secondary">{draft.partOfSpeech}</Badge>}
        <Badge variant="outline">{SOURCE_LABEL[draft.source] ?? draft.source}</Badge>
        {draft.kind === 'sentence' && (
          <Badge variant="amber" title="句子草稿：接受后建成句子卡，不记相遇词">
            句子
          </Badge>
        )}
        {draft.editedFields.length > 0 && (
          <Badge variant="amber" title={`已改字段：${draft.editedFields.join('、')}`}>
            已改
          </Badge>
        )}
        <span className="flex-1" />
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} title="逐字段修改">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleAccept} disabled={accept.isPending} title="接受并入库成卡">
          <Check className="w-3.5 h-3.5 text-tone-emerald-600" />
          入库
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={dismiss.isPending} title="不要这条">
          <X className="w-3.5 h-3.5 text-ink-stone-400" />
        </Button>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            value={meaningsText}
            onChange={(e) => setMeaningsText(e.target.value)}
            placeholder={draft.kind === 'sentence' ? '译文' : '释义，用 ； 分隔'}
            className="flex-1 h-7 px-2 rounded-lg border border-line bg-surface outline-none focus:border-tone-amber-500 text-xs"
          />
          <Button size="sm" disabled={!dirty || update.isPending} onClick={handleSave}>
            保存修改
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setHeadword(draft.headword);
              setReading(draft.reading);
              setMeaningsText(draft.meanings.join('；'));
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">
          {draft.kind === 'sentence' && <span className="text-ink-stone-400">译文：</span>}
          {draft.meanings.join('；')}
        </p>
      )}
    </div>
  );
}

/**
 * 生词草稿箱（挂 CARDS 页顶部）：AI/导入提议的候选生词，用户逐条确认才入库。
 * 空草稿时不渲染，保持复习页干净。
 */
export function CardDraftWorkbench() {
  const shell = useLearningShell();
  const { data: drafts = [], isLoading } = useCardDraftsQuery(undefined, shell.track);
  if (isLoading || drafts.length === 0) return null;
  return (
    <section className="mb-4 p-4 rounded-2xl border border-dashed border-tone-amber-500o40 bg-wash-amber-500o5 space-y-2">
      <div className="flex items-center gap-2">
        <Inbox className="w-4 h-4 text-tone-amber-500" />
        <h3 className="text-sm font-bold text-ink">
          待确认生词（{drafts.length}）
        </h3>
        <span className="text-[11px] text-ink-ghost">
          AI 抽词/助手整理的候选，接受才入库成卡
        </span>
      </div>
      {drafts.map((d) => (
        <DraftRow key={d.id} draft={d} />
      ))}
    </section>
  );
}
