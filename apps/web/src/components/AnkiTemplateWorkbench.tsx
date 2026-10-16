import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
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
import { AnkiTemplateEditor, type TemplateEditorField } from './anki-template/AnkiTemplateEditor.js';
import { AnkiTemplatePreview } from './anki-template/AnkiTemplatePreview.js';

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
 * 卡片模板工作台（设置页入口）：容器只做状态编排与领域命令，
 * 编辑列与预览列为纯展示子组件。
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

  const applyFormat = (format: AnkiCardFormatInfo) => {
    setLoadedKey(`${format.id}@${format.templateVersion}`);
    setSelectedId(format.id);
    setName(format.name);
    setFieldsJson(JSON.stringify(format.fields, null, 2));
    setFront(format.frontTemplate);
    setBack(format.backTemplate);
    setCss(format.css);
    setFieldsError(null);
  };

  const selected = formats.find((f) => f.id === selectedId) ?? formats[0];
  useEffect(() => {
    if (!selected) return;
    const key = `${selected.id}@${selected.templateVersion}`;
    if (key === loadedKey) return;
    applyFormat(selected);
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

  const setByField = (field: TemplateEditorField, value: string) => {
    if (field === 'fields') setFieldsJson(value);
    else if (field === 'front') setFront(value);
    else if (field === 'back') setBack(value);
    else setCss(value);
  };

  const insertMarker = (marker: string) => {
    const token = `{${marker}}`;
    const area = lastAreaRef.current;
    if (!area || !area.isConnected) {
      setFront((v) => v + token);
      frontRef.current?.focus();
      return;
    }
    const field = (area.dataset['field'] ?? 'front') as TemplateEditorField;
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
          applyFormat(r.format);
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
        applyFormat(r.format);
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
        ) : formatsQuery.isError ? (
          <div className="text-xs text-ink-stone-500 space-y-2">
            <p>模板列表读取失败，请检查网关后重试。</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void formatsQuery.refetch()} className="gap-1 text-xs">
              重新读取
            </Button>
          </div>
        ) : !selected ? (
          <p className="text-xs text-ink-stone-500">暂无可用模板。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AnkiTemplateEditor
              formats={formats}
              selectedId={selected.id}
              onSelectId={setSelectedId}
              selectedName={selected.name}
              name={name}
              onNameChange={setName}
              fieldsJson={fieldsJson}
              onFieldsChange={setFieldsJson}
              fieldsError={fieldsError}
              front={front}
              onFrontChange={setFront}
              frontRef={frontRef}
              back={back}
              onBackChange={setBack}
              css={css}
              onCssChange={setCss}
              onAreaFocus={(_field, area) => {
                lastAreaRef.current = area;
              }}
              onInsertMarker={insertMarker}
              onSave={handleSave}
              onReset={handleReset}
              savePending={saveFormat.isPending}
              resetPending={resetFormat.isPending}
            />
            <AnkiTemplatePreview
              sampleHeadword={SAMPLE_ENTRY.headword}
              previewPending={preview.isPending}
              previewDoc={previewDoc}
              issues={preview.data?.issues ?? []}
              previewError={
                preview.isError
                  ? preview.error instanceof Error
                    ? preview.error.message
                    : '预览失败。'
                  : null
              }
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
