import React from 'react';
import { Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { sound } from '../../utils/audio.js';
import { APPROVAL_OPTIONS, chatMenuItem, compactSelect, effortLabel } from './chat-shared.js';

export interface ComposerSettingsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nonDefault: boolean;
  approvalPolicy: string;
  onApprovalPolicyChange: (policy: string) => void;
  effort: string;
  onEffortChange: (effort: string) => void;
  effortChoices: string[];
  disabled?: boolean;
}

/** 会话参数弹层（审批策略 + 思考深度），独立拆分以遵循单文件 < 300 行与分治原则。 */
export function ComposerSettingsPopover({
  open,
  onOpenChange,
  nonDefault,
  approvalPolicy,
  onApprovalPolicyChange,
  effort,
  onEffortChange,
  effortChoices,
  disabled = false,
}: ComposerSettingsPopoverProps) {
  const effortValue = effort || '__auto__';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink ${
          open ? 'bg-surface-slate-50-slate-800 text-ink' : ''
        }`}
        title="Mode / 审批 / 思考"
        aria-label="会话设置"
        onClick={() => sound.playClick()}
      >
        <Settings2 className="size-3.5" />
        {nonDefault && !open ? (
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
          <p className="mt-0.5 text-xs text-ink-ghost">设置仅影响后续发送的消息</p>
        </div>

        <div className="space-y-2">
          <div className="space-y-0.5">
            <span className="block px-0.5 text-xs text-ink-ghost">审批</span>
            <Select
              value={approvalPolicy || 'never'}
              onValueChange={(v) => v && onApprovalPolicyChange(String(v))}
              disabled={disabled}
            >
              <SelectTrigger className={compactSelect}>
                <SelectValue>
                  {APPROVAL_OPTIONS.find((o) => o.value === approvalPolicy)?.label ||
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
            <span className="block px-0.5 text-xs text-ink-ghost">
              思考深度
              {effortChoices.length === 0
                ? effort
                  ? '（已保存值未确认）'
                  : '（运行时默认）'
                : ''}
            </span>
            <Select
              value={effortValue}
              onValueChange={(v) => v && onEffortChange(v === '__auto__' ? '' : String(v))}
              disabled={disabled || effortChoices.length === 0}
            >
              <SelectTrigger className={compactSelect}>
                <SelectValue>
                  {effortValue === '__auto__'
                    ? '运行时默认'
                    : `${effortLabel(effortValue)}${effortChoices.includes(effortValue) ? '' : '（待确认）'}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                <SelectItem value="__auto__" className={chatMenuItem}>
                  运行时默认
                </SelectItem>
                {effort && !effortChoices.includes(effort) && (
                  <SelectItem value={effort} className={chatMenuItem} disabled>
                    {effortLabel(effort)}（待确认）
                  </SelectItem>
                )}
                {effortChoices.map((e) => (
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
  );
}

