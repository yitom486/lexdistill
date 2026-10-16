import type { ToolCallTrace } from '../../lib/chat-transcript.js';

/** P2-1 拆分：AgentChatPanel 与其子组件共享的类型、常量与样式（纯搬运）。 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'approval';
  text: string;
  reasoning?: string;
  streaming?: boolean;
  source?: string;
  toolCalls?: ToolCallTrace[];
  approval?: {
    approvalId: string;
    action: string;
    description: string;
    riskLevel: string;
    status: 'pending' | 'accepted' | 'accepted_session' | 'declined' | 'timed_out' | 'cancelled';
    expiresAt?: number;
  };
}

export type AgentTurnHealth =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'healthy' }
  | { state: 'fallback'; message: string }
  | { state: 'failed'; message: string };

export const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export const APPROVAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'never', label: 'Approve for me' },
  { value: 'on-request', label: 'Ask for approval' },
  { value: 'untrusted', label: 'Untrusted' },
];

export function effortLabel(v: string): string {
  const map: Record<string, string> = {
    none: 'None',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'xHigh',
    ultra: 'Ultra',
  };
  return map[v.toLowerCase()] || v;
}

/** Agent 菜单使用随全局主题切换的表面与前景色。 */
export const chatMenuItem =
  'text-ink-soft data-[highlighted]:bg-surface-slate-50-slate-800 data-[highlighted]:text-ink focus:bg-surface-slate-50-slate-800 focus:text-ink';

export const compactSelect =
  'h-7 min-w-0 w-full gap-1 overflow-hidden rounded-md border border-line bg-transparent px-2 text-xs text-ink-soft hover:border-tone-amber-500o40 hover:bg-surface-stone-100-stone-900 focus:ring-0 shadow-none';
