import { toast } from 'sonner';
import { ChatHistoryMenu } from '@yitom/chat-ui';
import { sound } from '../../utils/audio.js';
import type { AgentSessionDto } from '../../queries/useAgentQueries.js';

interface ChatHistoryPopoverProps {
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  refetchThreads: () => void;
  sessions: AgentSessionDto[];
  coachThreadId: string;
  startNewChat: () => void;
  openSession: (sessionId: string) => void;
  compactThread: {
    isPending: boolean;
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: () => void }
    ) => void;
  };
  forkThread: {
    isPending: boolean;
    mutate: (
      vars: { sessionId: string; ephemeral?: boolean },
      opts?: { onSuccess?: (res: { sessionId: string }) => void; onError?: () => void }
    ) => void;
  };
  coachPersistThread: boolean;
  setCoachPersistThread: (v: boolean) => void;
  archiveThread: {
    mutate: (id: string, opts?: { onSuccess?: () => void }) => void;
  };
}

/**
 * 会话历史：列表与弹层形态由 `@yitom/chat-ui` 的 `ChatHistoryMenu` 提供，
 * 这里只接业务——压缩/分叉/归档的调用、提示音、toast，以及「保留新会话」开关。
 */
export function ChatHistoryPopover(props: ChatHistoryPopoverProps) {
  const {
    historyOpen,
    setHistoryOpen,
    refetchThreads,
    sessions,
    coachThreadId,
    startNewChat,
    openSession,
    compactThread,
    forkThread,
    coachPersistThread,
    setCoachPersistThread,
    archiveThread,
  } = props;

  return (
    <ChatHistoryMenu
      open={historyOpen}
      onOpenChange={setHistoryOpen}
      entries={sessions.map((t) => ({
        id: t.id,
        title: t.name || t.preview || t.id.slice(0, 12),
        ...(t.updatedAt ? { timestamp: t.updatedAt } : { subtitle: t.id.slice(0, 8) }),
      }))}
      activeId={coachThreadId}
      busy={compactThread.isPending || forkThread.isPending}
      onRefresh={() => {
        sound.playClick();
        void refetchThreads();
      }}
      onSelect={openSession}
      onCreate={() => {
        startNewChat();
        setHistoryOpen(false);
      }}
      onCompact={(id) => {
        sound.playClick();
        compactThread.mutate(id, {
          onSuccess: () => toast.success('已请求压缩会话上下文'),
          onError: () => toast.error('压缩失败'),
        });
      }}
      onFork={(id) => {
        sound.playClick();
        forkThread.mutate(
          { sessionId: id, ephemeral: !coachPersistThread },
          {
            onSuccess: (res) => {
              toast.success('已分叉新会话');
              openSession(res.sessionId);
            },
            onError: () => toast.error('分叉失败'),
          }
        );
      }}
      onArchive={(id) => {
        sound.playClick();
        archiveThread.mutate(id, {
          onSuccess: () => {
            if (coachThreadId === id) startNewChat();
          },
        });
      }}
      footer={
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={coachPersistThread}
            onChange={(e) => setCoachPersistThread(e.target.checked)}
          />
          保留新会话（关闭后可恢复）
        </label>
      }
    />
  );
}
