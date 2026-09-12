import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { toast } from 'sonner';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
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
  useCardFormatsQuery,
  usePreviewCardMutation,
  useResetCardFormatMutation,
  useSaveCardFormatMutation,
  type AnkiCardFormatInfo,
  type CardPreviewEntry,
} from '../queries/useLearnerQueries.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { sound } from '../utils/audio.js';

/** 字段标记清单（与 learner-core FIELD_MARKERS 同步；Web 侧只做插入菜单，不做渲染）。 */
const FIELD_MARKERS = [
  'expression',
  'reading',
  'glossary',
  'sentence',
  'audio',
  'tags',
  'url',
  'pitch-accent',
  'frequency',
  'furigana',
] as const;

/** 预览示例条目（演示数据；STATIC-DATA-INVENTORY 登记）。 */
const SAMPLE_ENTRY: CardPreviewEntry = {
  headword: '食べる',
  reading: 'たべる',
  meanings: ['to eat', 'to live'],
  pitchLabel: '⓪',
  sentence: 'ご飯を食べる。',
  tags: ['jlpt-n5'],
};

interface AnkiTemplateWorkbenchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 卡片模板工作台（设置页入口）。
 * 左：模板编辑器（字段菜单点插 + 校验）＋右：实时预览（Gateway 渲染，沙箱 iframe，模板 JS 永不执行）。
 * 保存/恢复走领域命令；同一渲染链路供 flashcards.render Tool 复用。
 */
export function AnkiTemplateWorkbench({ open, onOpenChange }: AnkiTemplateWorkbenchProps) {
  const isConnected = useGatewayStore((s) => s.isConnected);
  const formatsQuery = useCardFormatsQuery(open);
  const formats = useMemo(() => formatsQuery.data?.formats ?? [], [formatsQuery.data]);
  const saveFormat = useSaveCardFormatMutation();
  const resetFormat = useResetCardFormatMutation();
  const preview = usePreviewCardMutation();

  const [selectedId, setSelectedId] = useState('study-basic');
  const [name, setName] = useState('');
  const [fieldsJson, setFieldsJson] = useState('{}');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [css, setCss] = useState('');
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const lastAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const frontRef = useRef<HTMLTextAreaElement | null>(null);

  const selected = formats.find((f) => f.id === selectedId) ?? formats[0];
  useEffect(() => {
    if (!selected) return;
    const key = `${selected.id}@${selected.templateVersion}`;
    if (key === loadedKey) return;
    setLoadedKey(key);
    setSelectedId(selected.id);
    setName(selected.name);
    setFieldsJson(JSON.stringify(selected.fields, null, 2));
    setFront(selected.frontTemplate);
    setBack(selected.backTemplate);
    setCss(selected.css);
    setFieldsError(null);
  }, [selected, loadedKey]);

  // 草稿变更防抖预览（只渲染不入库）。
  useEffect(() => {
    if (!open || !selected) return;
    let fields: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(fieldsJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
      fields = parsed as Record<string, string>;
      setFieldsError(null);
    } catch {
      setFieldsError('字段映射 JSON 解析失败，预览暂停。');
      return;
    }
    const draft: AnkiCardFormatInfo = {
      ...selected,
      name,
      fields,
      frontTemplate: front,
      backTemplate: back,
      css,
    };
    const timer = setTimeout(() => {
      preview.mutate({ inlineFormat: draft, entry: SAMPLE_ENTRY });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fieldsJson, front, back, css, name, selectedId]);

  type EditorField = 'fields' | 'front' | 'back' | 'css';
  const setByField = (field: EditorField, value: string) => {
    if (field === 'fields') setFieldsJson(value);
    else if (field === 'front') setFront(value);
    else if (field === 'back') setBack(value);
    else setCss(value);
  };
  const areaProps = (field: EditorField) => ({
    'data-field': field,
    onFocus: (e: FocusEvent<HTMLTextAreaElement>) => {
      lastAreaRef.current = e.currentTarget;
    },
  });

  const insertMarker = (marker: string) => {
    const token = `{${marker}}`;
    const area = lastAreaRef.current;
    if (!area || !area.isConnected) {
      setFront((v) => v + token);
      frontRef.current?.focus();
      return;
    }
    const field = (area.dataset['field'] ?? 'front') as EditorField;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    setByField(field, area.value.slice(0, start) + token + area.value.slice(end));
    requestAnimationFrame(() => {
      area.focus();
      const pos = start + token.length;
      area.setSelectionRange(pos, pos);
    });
  };

  const handleSave = () => {
    if (!selected) return;
    let fields: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(fieldsJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('bad');
      }
      fields = parsed as Record<string, string>;
    } catch {
      toast.error('字段映射 JSON 不正确，无法保存。');
      return;
    }
    sound.playClick();
    saveFormat.mutate(
      { ...selected, name: name.trim() || selected.name, fields, frontTemplate: front, backTemplate: back, css },
      {
        onSuccess: (r) => {
          setLoadedKey(`${r.format.id}@${r.format.templateVersion}`);
          toast.success(`模板已保存：${r.format.name}`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '模板保存失败。'),
      }
    );
  };

  const handleReset = () => {
    if (!selected) return;
    sound.playClick();
    resetFormat.mutate(selected.id, {
      onSuccess: (r) => {
        setLoadedKey(`${r.format.id}@${r.format.templateVersion}`);
        toast.success('已恢复内置模板。');
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : '恢复内置模板失败。'),
    });
  };

  const previewDoc = preview.data
    ? `<!doctype html><html><head><meta charset="utf-8"><style>${preview.data.format.css}</style></head><body><div class="card">${preview.data.rendered.frontHtml}</div><div class="card" style="margin-top:12px">${preview.data.rendered.backHtml}</div></body></html>`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>卡片模板</DialogTitle>
          <DialogDescription>
            字段模板决定 Anki 字段内容（单大括号），正反面模板决定卡片呈现（双大括号）。保存前右侧实时预览，所见即导出所得。
          </DialogDescription>
        </DialogHeader>
        {!isConnected ? (
          <p className="text-xs text-ink-stone-500">网关未连接，模板工作台需要网关渲染支持。</p>
        ) : formatsQuery.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-ink-stone-500">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 正在读取模板…
          </p>
        ) : !selected ? (
          <p className="text-xs text-ink-stone-500">暂无可用模板。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Select
                  value={selected.id}
                  onValueChange={(v) => {
                    if (typeof v === 'string') setSelectedId(v);
                  }}
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                        {f.userModified ? '（已修改）' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 w-32 rounded-lg border border-ink-stone-200 bg-tone-white px-2 text-xs dark:border-tone-stone-700 dark:bg-tone-stone-900"
                  placeholder="模板名"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-ink-faint">
                  插入字段标记（点按插入到光标处）
                </p>
                <div className="flex flex-wrap gap-1">
                  {FIELD_MARKERS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => insertMarker(m)}
                      className="rounded-md border border-ink-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-stone-500 hover:border-tone-amber-500o50 hover:text-tone-amber-600 dark:border-tone-stone-700 dark:text-ink-stone-400"
                    >
                      {`{${m}}`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-faint">
                  字段映射（JSON：Anki 字段名 → 字段模板）
                </span>
                <textarea
                  value={fieldsJson}
                  onChange={(e) => setFieldsJson(e.target.value)}
                  {...areaProps('fields')}
                  rows={5}
                  spellCheck={false}
                  className="w-full rounded-lg border border-ink-stone-200 bg-tone-white p-2 font-mono text-[11px] dark:border-tone-stone-700 dark:bg-tone-stone-900"
                />
              </label>
              {fieldsError && <p className="text-[11px] text-ink-rose-600">{fieldsError}</p>}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-faint">
                  正面模板
                </span>
                <textarea
                  ref={frontRef}
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  {...areaProps('front')}
                  rows={3}
                  spellCheck={false}
                  className="w-full rounded-lg border border-ink-stone-200 bg-tone-white p-2 font-mono text-[11px] dark:border-tone-stone-700 dark:bg-tone-stone-900"
                />
              </label>
              <EditorArea
                label="背面模板"
                field="back"
                value={back}
                onChange={setBack}
                rows={5}
                onFocusArea={(area) => {
                  lastAreaRef.current = area;
                }}
              />
              <EditorArea
                label="样式（CSS，仅作用于卡片预览与导出）"
                field="css"
                value={css}
                onChange={setCss}
                rows={6}
                onFocusArea={(area) => {
                  lastAreaRef.current = area;
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={saveFormat.isPending}
                  className="gap-1"
                >
                  {saveFormat.isPending ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  保存模板
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  disabled={resetFormat.isPending}
                  className="gap-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复内置
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-ink-faint">
                实时预览（示例词：{SAMPLE_ENTRY.headword}；模板脚本永不执行）
              </p>
              {preview.isPending && (
                <p className="flex items-center gap-1.5 text-[11px] text-ink-stone-400">
                  <LoaderCircle className="h-3 w-3 animate-spin" /> 渲染中…
                </p>
              )}
              {previewDoc && (
                <iframe
                  title="卡片预览"
                  sandbox=""
                  srcDoc={previewDoc}
                  className="h-72 w-full rounded-xl border border-ink-stone-200 bg-tone-white dark:border-tone-stone-700"
                />
              )}
              {preview.data && preview.data.issues.length > 0 && (
                <div className="rounded-xl border border-tone-amber-500o40 bg-wash-amber-500o5 p-2 text-[11px] text-accent-ink-strong">
                  {preview.data.issues.map((issue) => (
                    <p key={issue}>⚠ {issue}</p>
                  ))}
                </div>
              )}
              {preview.isError && (
                <p className="text-[11px] text-ink-rose-600">
                  {preview.error instanceof Error ? preview.error.message : '预览失败。'}
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorArea(props: {
  label: string;
  field: 'back' | 'css';
  value: string;
  rows: number;
  onChange: (v: string) => void;
  onFocusArea: (area: HTMLTextAreaElement) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-faint">
        {props.label}
      </span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        data-field={props.field}
        onFocus={(e) => props.onFocusArea(e.currentTarget)}
        rows={props.rows}
        spellCheck={false}
        className="w-full rounded-lg border border-ink-stone-200 bg-tone-white p-2 font-mono text-[11px] dark:border-tone-stone-700 dark:bg-tone-stone-900"
      />
    </label>
  );
}
