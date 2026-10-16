import type { TrackLanguage } from '../../learning/learning-shell.js';

interface CoachSnapshotInput {
  track: TrackLanguage;
  learnerLevel: string;
  activeTab: string;
  readingDocumentId: string | null;
  readingSurface: string | null;
}

/**
 * 自由导师客户端快照：FREE_COACH 意图 + coach 会话归属。
 * 仅阅读页附阅读 focus；题目 focus 永不出现（题目归属见题目导师快照）。
 */
export function buildCoachClientSnapshot(input: CoachSnapshotInput) {
  return {
    targetLanguage: input.track,
    learnerLevel: input.learnerLevel,
    locale: 'zh-CN' as const,
    ui: { activeTab: input.activeTab, openTutor: true },
    userIntentHint: 'FREE_COACH' as const,
    ...(input.readingDocumentId
      ? {
          focus: {
            kind: 'READING_PASSAGE' as const,
            surface: input.readingSurface ?? '阅读中',
            documentId: input.readingDocumentId,
          },
        }
      : {}),
  };
}
