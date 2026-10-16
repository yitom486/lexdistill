import { Bot, Wifi, WifiOff, X } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { SheetHeader } from '../ui/sheet.js';
import type { AiTutorContext } from '../../stores/tutor-context.js';

interface TutorDrawerHeaderProps {
  trackName: string;
  headerHint: string;
  skillTag: string;
  questionText: string;
  correctAnswer: string;
  userAnswer?: string | undefined;
  isGatewayConnected: boolean;
  onClose: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}

/** 题目导师头：标题 + 连接状态 + 关闭；下方为当前题目上下文条。 */
export function TutorDrawerHeader({
  trackName,
  headerHint,
  skillTag,
  questionText,
  correctAnswer,
  userAnswer,
  isGatewayConnected,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: TutorDrawerHeaderProps) {
  return (
    <>
      <SheetHeader
        className="bg-wash-amber-500o10-amber-500o15 p-4 border-b border-line-amber-900o10-amber-500o10 shrink-0 cursor-move select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="flex items-center justify-between pr-8">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-tone-amber-500 text-tone-stone-950 shadow-sm">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="flex items-center gap-1.5 text-base font-bold font-serif leading-none tracking-tight text-ink">
                {trackName}题目导师 · 专属追问
              </h2>
              <p className="text-xs text-ink-ghost">
                {headerHint} · 聚焦：{skillTag}
                <span className="ml-1 text-ink-stone-500">· 关闭保留会话</span>
              </p>
            </div>
          </div>
          <Badge
            variant={isGatewayConnected ? 'emerald' : 'outline'}
            className="text-xs gap-1 px-2 py-0.5"
          >
            {isGatewayConnected ? (
              <>
                <Wifi className="w-2.5 h-2.5" />
                服务已连接
              </>
            ) : (
              <>
                <WifiOff className="w-2.5 h-2.5 text-ink-stone-400" />
                未连接
              </>
            )}
          </Badge>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭题目导师"
            title="关闭（保留会话）"
            className="rounded-xl p-1.5 text-ink-stone-400 transition-colors hover:bg-veil-stone-200o60 hover:text-tone-stone-700 dark:hover:bg-tone-stone-800 dark:hover:text-ink-stone-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </SheetHeader>

      <div className="p-3 bg-wash-amber-50o70-stone-900o70 border-b border-line-amber-900o10-amber-500o10 text-xs space-y-1 shrink-0">
        <p className="text-xs font-semibold text-ink-soft">正在讲解的题目</p>
        <p className="text-ink-soft font-medium">
          {questionText}
        </p>
        <div className="flex items-center gap-3 text-xs text-ink-stone-500 pt-0.5">
          <span>
            标准答案：
            <strong className="text-ink-emerald-700-emerald-400">
              {correctAnswer}
            </strong>
          </span>
          {userAnswer && (
            <span>
              你的提交：
              <strong className="text-ink-rose-600">{userAnswer}</strong>
            </span>
          )}
        </div>
      </div>
    </>
  );
}
