import React from 'react';
import { ListOrdered } from 'lucide-react';
import { ChatComposer as ChatComposerShell } from '@yitom/chat-ui';
import { Button } from '../ui/button.js';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useAgentRuntimeOptionsQuery } from '../../queries/useAgentQueries.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import type { AgentStatusDto } from '../../queries/useAgentQueries.js';
import { chatMenuItem, compactSelect } from './chat-shared.js';
import { ComposerSettingsPopover } from './ComposerSettingsPopover.js';

export interface ChatComposerProps {
  input: string;
  setInput: (v: string) => void;
  send: (raw: string) => void;
  busy: boolean;
  composerSettingsOpen: boolean;
  setComposerSettingsOpen: (open: boolean) => void;
  composerSettingsNonDefault: boolean;
  coachApprovalPolicy: string;
  setCoachApprovalPolicy: (v: string) => void;
  coachEffort: string;
  setCoachEffort: (v: string) => void;
  coachModelId: string;
  setCoachModelId: (v: string) => void;
  enqueueQueued: () => void;
  interrupt: () => void;
  queueMessage: { isPending: boolean };
  coachThreadId: string;
  agentStatus?: AgentStatusDto | undefined;
  onRuntimeChange?: (() => void) | undefined;
}

/**
 * 输入区宿主薄适配：形态、键盘语义、发送/停止由 `@yitom/chat-ui` 的 `ChatComposer` 提供。
 * 这里只接业务——会话参数、运行时与模型选择、加入下一轮队列、底部能力提示。
 */
export function ChatComposer(props: ChatComposerProps) {
  const {
    input,
    setInput,
    send,
    busy,
    composerSettingsOpen,
    setComposerSettingsOpen,
    composerSettingsNonDefault,
    coachApprovalPolicy,
    setCoachApprovalPolicy,
    coachEffort,
    setCoachEffort,
    coachModelId,
    setCoachModelId,
    enqueueQueued,
    interrupt,
    queueMessage,
    coachThreadId,
    agentStatus,
    onRuntimeChange,
  } = props;

  const runtimeCaps = useSelectedRuntimeCaps();
  const agentRuntimeId = usePreferencesStore((state) => state.agentRuntimeId);
  const runtimeOptions = useAgentRuntimeOptionsQuery(
    agentRuntimeId || 'codex-acp',
    !!agentRuntimeId,
    coachModelId || undefined
  );

  const modelChoices = runtimeOptions.data?.models ?? [];
  const modelValue = modelChoices.some((m) => m.value === coachModelId) ? coachModelId : '__auto__';
  const resolvedModelLabel =
    modelValue === '__auto__'
      ? '运行时默认'
      : (modelChoices.find((m) => m.value === coachModelId)?.label ?? coachModelId);
  const probeError = runtimeOptions.data?.error;
  const effortChoices = runtimeOptions.data?.efforts ?? [];

  const capabilityHint = runtimeCaps.supportsHistory
    ? '历史与排队需要在线连接 · 用量暂不可用'
    : '历史、排队与用量暂不可用';
  // 就绪时网关消息多为英文诊断串，只在不可用时展示
  const hint =
    agentStatus && !agentStatus.available && agentStatus.message
      ? `${capabilityHint} · ${agentStatus.message}`
      : capabilityHint;

  return (
    <footer className="shrink-0 p-3 pt-1.5">
      <ChatComposerShell
        value={input}
        onValueChange={setInput}
        onSubmit={(val) => {
          const text = val.trim();
          if (!text) return false;
          void send(text);
          return true;
        }}
        running={busy}
        onStop={interrupt}
        aria-label="向导师发消息"
        hint={hint}
        toolbarStart={
          <>
            <ComposerSettingsPopover
              open={composerSettingsOpen}
              onOpenChange={setComposerSettingsOpen}
              nonDefault={composerSettingsNonDefault}
              approvalPolicy={coachApprovalPolicy}
              onApprovalPolicyChange={setCoachApprovalPolicy}
              effort={coachEffort}
              onEffortChange={setCoachEffort}
              effortChoices={effortChoices}
              disabled={busy}
            />

            <div className="min-w-0 max-w-[8rem] flex-1">
              <AgentRuntimeSelect
                disabled={busy}
                {...(onRuntimeChange ? { onRuntimeChange } : {})}
              />
            </div>

            <div className="min-w-0 max-w-[12rem] flex-1">
              <Select
                value={modelValue}
                onValueChange={(v) => setCoachModelId(v === '__auto__' ? '' : String(v ?? ''))}
                disabled={busy || modelChoices.length === 0}
              >
                <SelectTrigger
                  className={`${compactSelect} whitespace-nowrap`}
                  title={probeError || resolvedModelLabel}
                  aria-label="选择模型"
                >
                  <SelectValue placeholder="Model">
                    <span className="block min-w-0 truncate">{resolvedModelLabel}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="border-line bg-paper-soft text-ink">
                  <SelectItem value="__auto__" className={chatMenuItem}>
                    运行时默认
                  </SelectItem>
                  {modelChoices.map((m) => (
                    <SelectItem key={m.value} value={m.value} className={chatMenuItem}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        renderActions={() =>
          busy ? (
            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-full border border-line"
              variant="outline"
              title="加入下一轮队列"
              aria-label="加入下一轮队列"
              disabled={!input.trim() || !coachThreadId || queueMessage.isPending}
              onClick={enqueueQueued}
            >
              <ListOrdered className="size-4" />
            </Button>
          ) : null
        }
      />
    </footer>
  );
}
