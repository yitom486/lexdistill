import React from 'react';
import { ChatSettingsMenu, type ChatSetting } from '@yitom/chat-ui';
import { sound } from '../../utils/audio.js';
import { APPROVAL_OPTIONS, effortLabel } from './chat-shared.js';

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

/**
 * 会话参数：弹层形态与单选交互由 `@yitom/chat-ui` 的 `ChatSettingsMenu` 提供，
 * 这里只把审批策略与思考深度翻译成「分组 + 当前值 + 选项」。
 */
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

  const effortOptions = [
    { value: '__auto__', label: '运行时默认' },
    // 已保存但运行时尚未确认的档位：展示出来但不允许重复选中
    ...(effort && !effortChoices.includes(effort)
      ? [{ value: effort, label: `${effortLabel(effort)}（待确认）`, disabled: true }]
      : []),
    ...effortChoices.map((e) => ({ value: e, label: effortLabel(e) })),
  ];

  const settings: ChatSetting[] = [
    {
      id: 'approval',
      label: '审批',
      value: approvalPolicy || 'never',
      options: APPROVAL_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      onChange: onApprovalPolicyChange,
      ...(disabled ? { disabled: true } : {}),
    },
    {
      id: 'effort',
      label: '思考深度',
      value: effortValue,
      options: effortOptions,
      onChange: (v) => onEffortChange(v === '__auto__' ? '' : v),
      ...(disabled || effortChoices.length === 0
        ? {
            disabled: true,
            hint: effort ? '已保存值未确认 · 运行时未探测到可用档位' : '运行时未探测到可用档位',
          }
        : {}),
    },
  ];

  return (
    <ChatSettingsMenu
      open={open}
      onOpenChange={(next) => {
        if (next) sound.playClick();
        onOpenChange(next);
      }}
      nonDefault={nonDefault}
      triggerLabel="会话设置"
      title="会话参数"
      description="设置仅影响后续发送的消息"
      settings={settings}
    />
  );
}
