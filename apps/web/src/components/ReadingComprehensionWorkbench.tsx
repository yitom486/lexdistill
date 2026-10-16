import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from './ui/button.js';
import { ResizableSplitPane } from './ui/resizable-split-pane.js';
import { sound } from '../utils/audio.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { NEWS_TOPICS } from '@lexdistill/protocol';
import { useNewsTopicsQuery } from '../queries/useLearnerQueries.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import { useReadingSession } from './reading/useReadingSession.js';
import { ReadingToolbar } from './reading/ReadingToolbar.js';
import { PassagePanel } from './reading/PassagePanel.js';
import { ReadingQuestionPanel } from './reading/ReadingQuestionPanel.js';

interface ReadingComprehensionWorkbenchProps {
  onOpenTutor?: (ctx: AiTutorContext) => void;
}

/**
 * 阅读理解工作台：容器只做来源/语种状态与加载编排，
 * 会话交互归 useReadingSession，展示归 Toolbar/Passage/Question 三列。
 */
export function ReadingComprehensionWorkbench({
  onOpenTutor,
}: ReadingComprehensionWorkbenchProps) {
  const shell = useLearningShell();
  const splitRatio = usePreferencesStore((s) => s.readingSplitRatio);
  const setReadingSplitRatio = usePreferencesStore((s) => s.setReadingSplitRatio);
  const furiganaEnabled = usePreferencesStore((s) => s.furiganaEnabled);
  const toggleFurigana = usePreferencesStore((s) => s.toggleFurigana);

  const [origin, setOrigin] = useState<'ai' | 'news'>('ai');
  // 阅读内容由当前学习轨道决定，不在工作台内提供跨语言切换。
  const readingLanguage = shell.defaultReadingLang;
  const [aiDifficulty, setAiDifficulty] = useState('2');
  const [newsTopic, setNewsTopic] = useState('world');

  // TanStack Query 服务端状态对接
  const { data: newsTopics = NEWS_TOPICS } = useNewsTopicsQuery();
  const passageRef = useRef<HTMLDivElement | null>(null);
  const session = useReadingSession({ origin, readingLanguage, passageRef });

  // 切换篇目来源
  const switchOrigin = (next: 'ai' | 'news') => {
    sound.playClick();
    session.stopAudio();
    setOrigin(next);
    session.resetAnswer();
  };

  const setsQuery = session.setsQuery;
  const subtitle = shell.featureFlags.koreanInterim
    ? '韩语：联合新闻等公开 RSS + 原文摘录；失败回退学习模板'
    : '阅读文章、完成配题；选中文字可查词或制作记忆卡。';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4 w-full max-w-6xl"
    >
      <PlanIntentBanner />
      <ReadingToolbar
        session={session}
        origin={origin}
        onSwitchOrigin={switchOrigin}
        readingLanguage={readingLanguage}
        aiDifficulty={aiDifficulty}
        onDifficultyChange={setAiDifficulty}
        newsTopic={newsTopic}
        onNewsTopicChange={setNewsTopic}
        newsTopics={newsTopics}
        subtitle={subtitle}
      />

      {setsQuery.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-ink-ghost">
          正在读取篇目…
        </p>
      ) : setsQuery.isError && !setsQuery.data?.length ? (
        <div role="alert" className="py-10 text-center text-sm text-ink-ghost space-y-2">
          <p>阅读篇目读取失败，请重试。</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void setsQuery.refetch()} className="gap-1 text-xs">
            重新读取
          </Button>
        </div>
      ) : (
        <>
        {setsQuery.isError && <p role="alert" className="text-xs text-ink-ghost">更新篇目失败，以下是已读取内容。<Button size="sm" variant="outline" onClick={() => void setsQuery.refetch()}>重新读取</Button></p>}
        <ResizableSplitPane
          ratio={splitRatio}
          onRatioChange={setReadingSplitRatio}
          enableBracketShortcuts
          left={
            <PassagePanel
              session={session}
              passageRef={passageRef}
              emptyHint={shell.copy.readingEmptyHint}
              furiganaEnabled={furiganaEnabled}
              onToggleFurigana={toggleFurigana}
            />
          }
          right={<ReadingQuestionPanel session={session} {...(onOpenTutor ? { onOpenTutor } : {})} />}
        />
        </>
      )}
    </motion.div>
  );
}
