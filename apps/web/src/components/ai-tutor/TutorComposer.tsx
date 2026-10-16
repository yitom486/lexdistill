import { Send, Square } from 'lucide-react';
import { Button } from '../ui/button.js';

interface TutorComposerProps {
  isTyping: boolean;
  inputText: string;
  onInputChange: (value: string) => void;
  onQuizMe: () => void;
  onExpandAsk: () => void;
  onSend: () => void;
  onInterrupt: () => void;
}

/** 题目导师快捷动作 + 输入行：考一题 / 拓展追问 / 输入发送 / 生成中打断。 */
export function TutorComposer({
  isTyping,
  inputText,
  onInputChange,
  onQuizMe,
  onExpandAsk,
  onSend,
  onInterrupt,
}: TutorComposerProps) {
  return (
    <>
      <div className="px-4 py-2 bg-veil-stone-100o60-stone-900o40 border-t border-line-amber-900o10-amber-500o10 flex flex-wrap gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onQuizMe}
          disabled={isTyping}
          className="h-7 rounded-full text-xs px-2.5 border-tone-amber-500o50 text-accent-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          title="让导师按本次讲解现场出一道单选题"
        >
          就本轮考我一题
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExpandAsk}
          disabled={isTyping}
          className="h-7 rounded-full text-xs px-2.5 border-tone-amber-500o50 text-accent-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          title="让导师按本次问答给出值得深挖的拓展问题"
        >
          拓展追问
        </Button>
      </div>

      <div className="p-3 border-t border-line-accent shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="向导师追问（例如：请解释和『に関して』的区别）..."
            aria-label="向导师追问"
            className="flex-1 py-2.5 px-3.5 bg-surface-stone-100-stone-900 text-ink rounded-xl border border-line-soft text-xs sm:text-sm outline-none focus:border-tone-amber-500 transition-all"
          />
          {isTyping ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onInterrupt}
              aria-label="停止生成"
              title="停止生成"
              className="border-line-amber-500o30 text-tone-amber-600 hover:bg-wash-amber-500o10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Square className="w-4 h-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!inputText.trim()}
              aria-label="发送"
              title="发送"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      </div>
    </>
  );
}
