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

export type CodexTurnHealth =
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

/** Agent 面板恒为深色底，不依赖 html.dark；高亮项强制浅色字 */
export const darkMenuItem =
  'text-ink-stone-200 data-[highlighted]:bg-tone-stone-700 data-[highlighted]:text-tone-white focus:bg-tone-stone-700 focus:text-tone-white';

export const compactSelect =
  'h-7 min-w-0 w-full gap-1 overflow-hidden rounded-md border border-line-stone-700o80 bg-transparent px-2 text-[11px] text-tone-stone-300 hover:border-ink-stone-500 hover:bg-veil-stone-800o60 focus:ring-0 shadow-none';
