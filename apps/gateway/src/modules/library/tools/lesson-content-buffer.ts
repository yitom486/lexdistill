import { randomUUID } from 'node:crypto';
import { RequiredLessonContent, TextbookContentOperationSchemas, type TextbookContentChange, type TextbookContentKind, type TextbookLearningContent } from '@study-studio/document-model';
import { BusinessError, generateId } from '@study-studio/shared';

interface DraftRow { ref: string; id: string; content: Record<string, unknown>; source?: 'TEXTBOOK' | 'AI' }
export interface BufferedContentReceipt { status: 'staged' | 'view'; kind: TextbookContentKind; items: Array<Record<string, unknown>> }

/** One lesson/attempt only. Public references never reveal persistent identities. */
export class LessonContentBuffer {
  private readonly staged = new Map<string, TextbookContentChange>();
  get changes(): readonly TextbookContentChange[] { return [...this.staged.values()]; }
  readonly touched = new Set<TextbookContentKind>();
  private readonly rows = new Map<TextbookContentKind, DraftRow[]>();
  private readonly namespace = randomUUID().slice(0, 8);
  private counter = 0;
  constructor(content: TextbookLearningContent, replaceContent = false) {
    for (const kind of Object.keys(TextbookContentOperationSchemas) as TextbookContentKind[]) {
      if (kind === 'material') this.rows.set(kind, content.material ? [this.row(generateId('material'), { text: content.material })] : []);
      else this.rows.set(kind, content[kind].map(item => {
        const { id, ...fields } = item;
        const record: Record<string, unknown> = fields;
        const source = record['source']; delete record['source']; delete record['vocabularyId'];
        return this.row(id, record, source === 'TEXTBOOK' || source === 'AI' ? source : undefined);
      }));
    }
    if (replaceContent) for (const [kind, rows] of this.rows) {
      for (const row of rows) this.staged.set(row.id, { kind, action: 'delete', id: row.id });
      rows.length = 0;
    }
  }
  private row(id: string, content: Record<string, unknown>, source?: 'TEXTBOOK' | 'AI'): DraftRow {
    return { ref: `${this.namespace}-${++this.counter}`, id, content, ...(source ? { source } : {}) };
  }
  missing(): TextbookContentKind[] { return RequiredLessonContent.filter(kind => !this.touched.has(kind) || !this.rows.get(kind)?.length); }
  apply(kind: TextbookContentKind, raw: unknown, allowAiExercises: boolean): BufferedContentReceipt {
    const parsed = TextbookContentOperationSchemas[kind].safeParse(raw);
    if (!parsed.success) throw new BusinessError('E_CONTENT_FORMAT_INVALID', '内容字段不符合工具要求，请按具体字段修正', 'VALIDATION', true,
      { issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });
    const input = parsed.data, current = this.rows.get(kind)!;
    const explicitSource = 'source' in input && (input.source === 'AI' || input.source === 'TEXTBOOK') ? input.source : undefined;
    const publicRows = (rows: DraftRow[]) => rows.map(row => ({ ...row.content, ref: row.ref, ...(row.source ? { source: row.source } : {}) }));
    if (input.action === 'read') return { status: 'view', kind, items: publicRows(current) };
    if (input.action === 'delete') {
      const selected = input.refs!.map(ref => current.find(row => row.ref === ref));
      if (selected.some(row => !row)) throw new BusinessError('E_CONTENT_REF_INVALID', '引用不属于当前任务，请使用本课工具回执中的 ref', 'VALIDATION', true);
      for (const row of new Set(selected)) {
        if (!row) continue;
        if (this.staged.get(row.id)?.action === 'add') this.staged.delete(row.id);
        else this.staged.set(row.id, { kind, action: 'delete', id: row.id });
        current.splice(current.indexOf(row), 1);
      }
      return { status: 'staged', kind, items: [] };
    }
    const items = input.items!.map(item => {
      const { ref, ...fields } = item;
      const content: Record<string, unknown> = fields;
      const before = input.action === 'update' ? current.find(row => row.ref === ref) : undefined;
      if (input.action === 'update' && !before) throw new BusinessError('E_CONTENT_REF_INVALID', '引用不属于当前任务，请使用本课工具回执中的 ref', 'VALIDATION', true);
      const source = kind === 'vocabulary' || kind === 'material' ? undefined : explicitSource ?? before?.source ?? 'TEXTBOOK';
      if (kind === 'exercises' && source === 'AI' && !allowAiExercises) throw new BusinessError('E_AI_EXERCISES_DISABLED', '本次未启用新增 AI 练习', 'VALIDATION', true);
      return { before, content, source };
    });
    if (kind === 'material' && (items.length !== 1 || (input.action === 'add' && current.length && current[0]!.content['text'] !== items[0]!.content['text'])))
      throw new BusinessError('E_CONTENT_FORMAT_INVALID', '一课只有一份整理材料；已有材料请用 update 修改', 'VALIDATION', true);
    const output: DraftRow[] = [];
    for (const { before, content, source } of items) {
      const repeated = input.action === 'add' ? current.find(row => row.source === source && JSON.stringify(row.content) === JSON.stringify(content)) : undefined;
      if (repeated) { output.push(repeated); continue; }
      const row = before ?? this.row(generateId('content'), content, source);
      row.content = content; if (source) row.source = source;
      if (!before) current.push(row);
      const value = kind === 'material' ? content : { items: [content], ...(source ? { source } : {}) };
      this.staged.set(row.id, { kind, action: !before || this.staged.get(row.id)?.action === 'add' ? 'add' : 'update', id: row.id, input: value });
      output.push(row);
    }
    this.touched.add(kind);
    return { status: 'staged', kind, items: publicRows(output) };
  }
}
