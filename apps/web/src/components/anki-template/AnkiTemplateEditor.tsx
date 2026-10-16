import type { FocusEvent, RefObject } from 'react';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { Button } from '../ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import type { AnkiCardFormatInfo } from '../../queries/useLearnerQueries.js';

export type TemplateEditorField = 'fields' | 'front' | 'back' | 'css';

/** 字段标记清单（与 learner-core FIELD_MARKERS 同步；Web 侧只做插入菜单，不做渲染）。 */
export const FIELD_MARKERS = [
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

interface AnkiTemplateEditorProps {
  formats: AnkiCardFormatInfo[];
  selectedId: string;
  onSelectId: (id: string) => void;
  selectedName: string;
  name: string;
  onNameChange: (v: string) => void;
  fieldsJson: string;
  onFieldsChange: (v: string) => void;
  fieldsError: string | null;
  front: string;
  onFrontChange: (v: string) => void;
  frontRef: RefObject<HTMLTextAreaElement | null>;
  back: string;
  onBackChange: (v: string) => void;
  css: string;
  onCssChange: (v: string) => void;
  onAreaFocus: (field: TemplateEditorField, area: HTMLTextAreaElement) => void;
  onInsertMarker: (marker: string) => void;
  onSave: () => void;
  onReset: () => void;
  savePending: boolean;
  resetPending: boolean;
}

const AREA_CLASS =
  'w-full rounded-lg border border-ink-stone-200 bg-tone-white p-2 font-mono text-xs dark:border-tone-stone-700 dark:bg-tone-stone-900 transition-colors';

/**
 * 模板编辑列（纯展示）：模板选择、名称、字段标记插入、四个模板区、保存/恢复。
 * 校验、渲染与持久化归容器；此处只做视图与事件分发。
 */
export function AnkiTemplateEditor(props: AnkiTemplateEditorProps) {
  const areaProps = (field: TemplateEditorField) => ({
    'data-field': field,
    onFocus: (e: FocusEvent<HTMLTextAreaElement>) => {
      props.onAreaFocus(field, e.currentTarget);
    },
  });
  return (
    <fieldset className="space-y-3 min-w-0" disabled={props.savePending || props.resetPending}>
      <div className="flex items-center gap-2">
        <Select
          value={props.selectedId}
          onValueChange={(v) => {
            if (typeof v === 'string') props.onSelectId(v);
          }}
        >
          <SelectTrigger className="h-8 flex-1 text-xs" aria-label="选择卡片模板">
            <SelectValue>{props.selectedName}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {props.formats.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
                {f.userModified ? '（已修改）' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
          aria-label="模板名称"
          className="h-8 w-32 rounded-lg border border-ink-stone-200 bg-tone-white px-2 text-xs dark:border-tone-stone-700 dark:bg-tone-stone-900 transition-colors"
          placeholder="模板名"
        />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-ink-faint">
          插入字段标记（点按插入到光标处）
        </p>
        <div className="flex flex-wrap gap-1">
          {FIELD_MARKERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => props.onInsertMarker(m)}
              className="rounded-md border border-ink-stone-200 px-1.5 py-0.5 font-mono text-xs text-ink-stone-500 hover:border-tone-amber-500o50 hover:text-tone-amber-600 dark:border-tone-stone-700 dark:text-ink-stone-400 transition-colors"
            >
              {`{${m}}`}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-faint">
          字段映射（JSON：Anki 字段名 → 字段模板）
        </span>
        <textarea
          value={props.fieldsJson}
          onChange={(e) => props.onFieldsChange(e.target.value)}
          {...areaProps('fields')}
          rows={5}
          spellCheck={false}
          className={AREA_CLASS}
        />
      </label>
      {props.fieldsError && <p className="text-xs text-ink-rose-600">{props.fieldsError}</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-faint">
          正面模板
        </span>
        <textarea
          ref={props.frontRef}
          value={props.front}
          onChange={(e) => props.onFrontChange(e.target.value)}
          {...areaProps('front')}
          rows={3}
          spellCheck={false}
          className={AREA_CLASS}
        />
      </label>
      <EditorArea
        label="背面模板"
        field="back"
        value={props.back}
        onChange={props.onBackChange}
        rows={5}
        onFocusArea={(area) => props.onAreaFocus('back', area)}
      />
      <EditorArea
        label="样式（CSS，仅作用于卡片预览与导出）"
        field="css"
        value={props.css}
        onChange={props.onCssChange}
        rows={6}
        onFocusArea={(area) => props.onAreaFocus('css', area)}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={props.onSave}
          disabled={props.savePending}
          className="gap-1"
        >
          {props.savePending ? (
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
          onClick={props.onReset}
          disabled={props.resetPending}
          className="gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复内置
        </Button>
      </div>
    </fieldset>
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
      <span className="mb-1 block text-xs font-medium text-ink-faint">
        {props.label}
      </span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        data-field={props.field}
        onFocus={(e) => props.onFocusArea(e.currentTarget)}
        rows={props.rows}
        spellCheck={false}
        className={AREA_CLASS}
      />
    </label>
  );
}
