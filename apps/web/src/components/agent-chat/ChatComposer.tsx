import { ArrowUp, ListOrdered, Settings2, Square } from 'lucide-react';
import { Button } from '../ui/button.js';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { sound } from '../../utils/audio.js';
import type {
  AgentCollaborationModeDto,
  AgentModelDto,
  AgentStatusDto,
} from '../../queries/useAgentQueries.js';
import { APPROVAL_OPTIONS, chatMenuItem, compactSelect, effortLabel } from './chat-shared.js';

interface ChatComposerProps {
  input: string;
  setInput: (v: string) => void;
  send: (raw: string) => void;
  busy: boolean;
  composerSettingsOpen: boolean;
  setComposerSettingsOpen: (open: boolean) => void;
  composerSettingsNonDefault: boolean;
  coachCollaborationMode: string;
  setCoachCollaborationMode: (v: string) => void;
  collabModes: AgentCollaborationModeDto[];
  coachApprovalPolicy: string;
  setCoachApprovalPolicy: (v: string) => void;
  coachEffort: string;
  setCoachEffort: (v: string) => void;
  effortOptions: readonly string[];
  coachModelId: string;
  setCoachModelId: (v: string) => void;
  modelLabel: string;
  models: AgentModelDto[];
  enqueueQueued: () => void;
  interrupt: () => void;
  queueMessage: { isPending: boolean };
  coachThreadId: string;
  agentStatus?: AgentStatusDto | undefined;
}

/** P2-1 拆分：输入区 + 会话参数弹层 + 模型选择 + 发送/排队/停止（纯搬运自 AgentChatPanel）。 */
export function ChatComposer(props: ChatComposerProps) {
  const {
    input,
    setInput,
    send,
    busy,
    composerSettingsOpen,
    setComposerSettingsOpen,
    composerSettingsNonDefault,
    coachCollaborationMode,
    setCoachCollaborationMode,
    collabModes,
    coachApprovalPolicy,
    setCoachApprovalPolicy,
    coachEffort,
    setCoachEffort,
    effortOptions,
    coachModelId,
    setCoachModelId,
    modelLabel,
    models,
    enqueueQueued,
    interrupt,
    queueMessage,
    coachThreadId,
    agentStatus,
  } = props;
  const runtimeCaps = useSelectedRuntimeCaps();
  return (
    <footer className="shrink-0 p-3 pt-1.5">
      <div className="rounded-2xl border border-line bg-surface focus-within:border-tone-amber-500o40">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={3}
          placeholder={
            busy
              ? '生成中：Enter=steer；队列按钮=下一轮排队 · Shift+Enter 换行'
              : '输入消息，Enter 发送 · Shift+Enter 换行'
          }
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] text-ink placeholder:text-ink-ghost outline-none min-h-[72px]"
        />
        <div className="flex items-center gap-0.5 border-t border-line px-1.5 py-1">
          <Popover open={composerSettingsOpen} onOpenChange={setComposerSettingsOpen}>
            <PopoverTrigger
              className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink ${
                composerSettingsOpen ? 'bg-surface-slate-50-slate-800 text-ink' : ''
              }`}
              title="Mode / 审批 / 思考"
              aria-label="会话设置"
              onClick={() => sound.playClick()}
            >
              <Settings2 className="size-3.5" />
              {composerSettingsNonDefault && !composerSettingsOpen ? (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ink-sky-700-sky-300" />
              ) : null}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-72 space-y-3 border-line bg-paper-soft p-3 text-ink"
            >
              <div>
                <p className="text-xs font-medium text-ink">会话参数</p>
                <p className="mt-0.5 text-[10px] text-ink-ghost">设置仅影响后续发送的消息</p>
              </div>

              <div className="space-y-2">
                <div className="space-y-0.5">
                  <span className="block px-0.5 text-[10px] text-ink-ghost">Mode</span>
                  <Select
                    value={coachCollaborationMode || '__none__'}
                    onValueChange={(v) =>
                      setCoachCollaborationMode(v === '__none__' ? '' : String(v ?? ''))
                    }
                    disabled={busy}
                  >
                    <SelectTrigger className={compactSelect}>
                      <SelectValue>{coachCollaborationMode || '默认'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="border-line bg-paper-soft text-ink">
                      <SelectItem value="__none__" className={chatMenuItem}>
                        Mode（默认）
                      </SelectItem>
                      <SelectItem value="default" className={chatMenuItem}>
                        default
                      </SelectItem>
                      <SelectItem value="plan" className={chatMenuItem}>
                        plan
                      </SelectItem>
                      {collabModes
                        .filter((m) => m.mode && m.mode !== 'default' && m.mode !== 'plan')
                        .map((m) => (
                          <SelectItem
                            key={m.name}
                            value={m.mode || m.name}
                            className={chatMenuItem}
                          >
                            {m.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-0.5">
                  <span className="block px-0.5 text-[10px] text-ink-ghost">审批</span>
                  <Select
                    value={coachApprovalPolicy || 'never'}
                    onValueChange={(v) => v && setCoachApprovalPolicy(String(v))}
                    disabled={busy}
                  >
                    <SelectTrigger className={compactSelect}>
                      <SelectValue>
                        {APPROVAL_OPTIONS.find((o) => o.value === coachApprovalPolicy)?.label ||
                          'Approve for me'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="border-line bg-paper-soft text-ink">
                      {APPROVAL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className={chatMenuItem}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-0.5">
                  <span className="block px-0.5 text-[10px] text-ink-ghost">
                    思考深度{runtimeCaps.supportsEffort ? '' : '（当前运行时用自带默认）'}
                  </span>
                  <Select
                    value={coachEffort || 'medium'}
                    onValueChange={(v) => v && setCoachEffort(String(v))}
                    disabled={busy || !runtimeCaps.supportsEffort}
                  >
                    <SelectTrigger className={compactSelect}>
                      <SelectValue>{effortLabel(coachEffort || 'medium')}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="border-line bg-paper-soft text-ink">
                      {effortOptions.map((e) => (
                        <SelectItem key={e} value={e} className={chatMenuItem}>
                          {effortLabel(e)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="min-w-0 flex-1">
            <AgentRuntimeSelect disabled={busy} />
          </div>

          <div className="min-w-0 flex-1">
            <Select
              value={coachModelId || '__default__'}
              onValueChange={(v) => setCoachModelId(v === '__default__' ? '' : String(v ?? ''))}
              disabled={busy || !runtimeCaps.supportsModelPicker}
            >
              <SelectTrigger
                className={`${compactSelect} max-w-[14rem]`}
                title={runtimeCaps.supportsModelPicker ? undefined : '当前运行时用自带默认模型'}
              >
                <SelectValue placeholder="Model">{modelLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                <SelectItem value="__default__" className={chatMenuItem}>
                  本机默认
                </SelectItem>
                {models.map((m) => (
                  <SelectItem
                    key={m.id || m.model}
                    value={m.id || m.model}
                    className={chatMenuItem}
                  >
                    {m.displayName || m.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {busy ? (
            <>
              <Button
                type="button"
                size="icon"
                className="size-7 shrink-0 rounded-full bg-tint-sky-600 hover:bg-tint-sky-500"
                title="注入引导 (steer)"
                disabled={!input.trim()}
                onClick={() => void send(input)}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="size-7 shrink-0 rounded-full bg-tint-violet-700 hover:bg-tint-violet-600"
                title="加入下一轮队列"
                disabled={!input.trim() || !coachThreadId || queueMessage.isPending}
                onClick={enqueueQueued}
              >
                <ListOrdered className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7 shrink-0 rounded-full border-line"
                title="停止"
                onClick={interrupt}
              >
                <Square className="size-3" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-7 shrink-0 rounded-full bg-tint-sky-600 hover:bg-tint-sky-500"
              title="发送"
              disabled={!input.trim()}
              onClick={() => void send(input)}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-ink-ghost">
        ~/.codex · queue/changed · compact · rateLimits
        {agentStatus?.message ? ` · ${agentStatus.message}` : ''}
      </p>
    </footer>
  );
}
