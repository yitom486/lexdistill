import { z } from 'zod';
import type { ImportEvent } from '@study-studio/document-model';

const messageSchema = z.object({ text: z.string().optional(), reasoning: z.string().optional() });
const failureSchema = z.object({ code: z.string().optional(), message: z.string(), retryable: z.boolean().optional(), details: z.unknown().optional() });
const openedSchema = z.object({ model: z.string().nullable(), effort: z.string().nullable().optional(), tools: z.unknown().optional(), toolDescriptions: z.array(z.object({ name: z.string(), description: z.string() })).optional() });
const nativeTurnSchema = z.object({ nativeTurnId: z.string() });
const requestSchema = z.object({ name: z.string(), input: z.unknown() });
const checkSchema = z.object({ check: z.string() });
const committedSchema = z.object({ stats: z.object({ vocabCount: z.number(), grammarCount: z.number(), exerciseCount: z.number(), hasPassage: z.boolean() }) });
const waitSchema = z.object({ elapsedMs: z.number(), idleMs: z.number(), timeoutMs: z.number(), nativeTurnAccepted: z.boolean(), nativeTurnId: z.string().nullable(), lastModelEvent: z.string().nullable(), engineRetryCount: z.number(), inputCharacters: z.number(), attachmentCount: z.number(), attachmentBytes: z.number(), lastEngineError: z.object({ code: z.string(), message: z.string() }).nullable() });
const checks: Record<string, string> = { field_format: '内容字段与枚举', task_identity: '系统绑定身份', directory_membership: '目录归属', directory_coverage: '目录覆盖', source_references: '原页引用', content_format: '正文、来源与答案结构' };
export function ImportRecordView({ event, detail }: { event: ImportEvent; detail: unknown }) {
  if (event.name === 'opened') {
    const parsed = openedSchema.safeParse(detail);
    if (parsed.success) return <section className="space-y-2" data-testid="native-tool-declarations">
      <p>模型 {parsed.data.model ?? '运行时默认'} · 思考等级 {parsed.data.effort ?? '运行时默认'}</p>
      {parsed.data.toolDescriptions?.map(tool => <div key={tool.name}><p className="font-medium">{tool.name}</p><p className="whitespace-pre-wrap">{tool.description}</p></div>)}
      {parsed.data.tools ? <details><summary className="cursor-pointer">引擎实际注入的工具声明</summary><JsonValue value={parsed.data.tools} /></details> : <p className="text-ink-muted">引擎未返回完整工具声明；以上为 Gateway 注册的使用说明。</p>}
    </section>;
  }
  if (event.name === 'message') {
    const parsed = messageSchema.safeParse(detail);
    if (parsed.success) return <>{parsed.data.text && <pre className="max-h-72 overflow-auto whitespace-pre-wrap">{parsed.data.text}</pre>}{parsed.data.reasoning && <details><summary className="cursor-pointer">引擎公开的推理摘要</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{parsed.data.reasoning}</pre></details>}</>;
  }
  if (event.name === 'runtime_retry') {
    const parsed = failureSchema.safeParse(detail);
    if (parsed.success) return <section className="space-y-1"><p>{parsed.data.message}</p><p className="text-ink-muted">{parsed.data.code} · 引擎仍在当前轮次内重试；此通知不刷新模型输出等待期限。</p></section>;
  }
  if (['rejected', 'repair_limit', 'failed', 'error', 'commit_failed'].includes(event.name)) {
    const parsed = failureSchema.safeParse(detail);
    const wait = parsed.success ? waitSchema.safeParse(parsed.data.details) : undefined;
    if (parsed.success) return <section className="space-y-2" role="alert"><p>{parsed.data.message}</p><p className="text-ink-muted">{parsed.data.code}{parsed.data.retryable === undefined ? '' : parsed.data.retryable ? ' · 可重试' : ' · 本调用不可重试'}</p>
      {wait?.success && <div className="space-y-1 text-ink-muted"><p>{wait.data.nativeTurnAccepted ? '引擎已接受并启动原生轮次' : '尚未收到原生轮次启动确认'} · 本轮已等待 {Math.round(wait.data.elapsedMs / 1000)} 秒 · 无有效模型活动 {Math.round(wait.data.idleMs / 1000)} 秒 · 配置期限 {Math.round(wait.data.timeoutMs / 1000)} 秒</p>
        <p>输入 {wait.data.inputCharacters} 字符 · {wait.data.attachmentCount} 张附件 / {(wait.data.attachmentBytes / 1024 / 1024).toFixed(1)} MiB · 引擎重试 {wait.data.engineRetryCount} 次</p>
        <p>最近模型事件：{wait.data.lastModelEvent ?? '未收到有效模型输出'}{wait.data.lastEngineError ? `；最后引擎原因：${wait.data.lastEngineError.message}` : ''}</p>
      </div>}
      {parsed.data.details !== undefined && <details><summary className="cursor-pointer">反馈字段、合法值与失败详情</summary><JsonValue value={parsed.data.details} /></details>}
    </section>;
  }
  if (event.name === 'turn_started') { const parsed = nativeTurnSchema.safeParse(detail); if (parsed.success) return <p className="break-all">原生轮次 {parsed.data.nativeTurnId}</p>; }
  if (event.name === 'check_passed') { const parsed = checkSchema.safeParse(detail); if (parsed.success) return <p>已通过：{checks[parsed.data.check] ?? parsed.data.check}</p>; }
  if (event.name === 'accepted') return <p>内容和目录格式已通过；保存结果以事务回执为准。</p>;
  if (event.name === 'committed') { const parsed = committedSchema.safeParse(detail); if (parsed.success) return <p>事务已提交 · 生词 {parsed.data.stats.vocabCount} · 知识点 {parsed.data.stats.grammarCount} · 习题 {parsed.data.stats.exerciseCount} · 正文 {parsed.data.stats.hasPassage ? '已保存' : '无正文块'}</p>; }
  if (event.name === 'requested' || event.name === 'proposal') {
    const parsed = requestSchema.safeParse(detail);
    return <details><summary className="cursor-pointer">{parsed.success ? parsed.data.name + ' · 实际参数' : '模型提交的实际参数'}</summary><JsonValue value={parsed.success ? parsed.data.input : detail} /></details>;
  }
  if (event.name === 'result') return <details><summary className="cursor-pointer">返回模型的工具回执</summary><JsonValue value={detail} /></details>;
  return <details><summary className="cursor-pointer">详细记录</summary><JsonValue value={detail} /></details>;
}
function JsonValue({ value }: { value: unknown }) { return <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-muted">{JSON.stringify(value, null, 2) ?? '本事件没有附加内容'}</pre>; }
