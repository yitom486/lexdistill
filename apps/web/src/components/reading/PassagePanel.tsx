import { AnimatePresence, motion } from 'framer-motion';
import {
  Newspaper,
  Volume2,
  Square,
  Highlighter,
  CreditCard,
  Languages,
  ExternalLink,
  Bookmark,
  Lightbulb,
} from 'lucide-react';
import { Button, buttonVariants } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { cn } from '../../lib/utils.js';
import { sound, speechStudio } from '../../utils/audio.js';
import type { ReadingSession, SelectionAnchor } from './useReadingSession.js';

interface PassagePanelProps {
  session: ReadingSession;
  passageRef: React.RefObject<HTMLDivElement | null>;
  emptyHint: string;
  furiganaEnabled: boolean;
  onToggleFurigana: () => void;
}

/** 篇目来源徽标：结构化 sourceKind 优先，旧数据回退 sourceLabel 推断。 */
function SourceBadges({ session }: { session: ReadingSession }) {
  const activeSet = session.activeSet;
  if (!activeSet || activeSet.origin !== 'news') return null;
  if (activeSet.sourceKind === 'full_text' || activeSet.sourceLabel.includes('原文摘录')) {
    return (
      <Badge variant="outline" className="text-xs border-line-emerald-600o40 text-ink-emerald-800-emerald-300">
        原文摘录
      </Badge>
    );
  }
  if (activeSet.sourceKind === 'rss_summary' || activeSet.sourceLabel.includes('RSS')) {
    return (
      <Badge variant="outline" className="text-xs">
        RSS 摘要
      </Badge>
    );
  }
  if (activeSet.sourceKind === 'offline_template') {
    const label =
      activeSet.fetchStatus === 'timeout'
        ? '超时·模板兜底'
        : activeSet.fetchStatus === 'empty'
          ? '空源·模板兜底'
          : activeSet.fetchStatus === 'network_failed'
            ? '网络失败·模板兜底'
            : '模板兜底';
    const title =
      activeSet.fetchStatus === 'timeout'
        ? '抓取超时，已用合规模板兜底'
        : activeSet.fetchStatus === 'empty'
          ? '新闻源返回为空，已用合规模板兜底'
          : activeSet.fetchStatus === 'network_failed'
            ? '新闻源网络失败，已用合规模板兜底'
            : '新闻源暂不可用，已用合规模板兜底';
    return (
      <Badge
        variant="outline"
        className="text-xs border-line-amber-600o50 text-ink-amber-800-amber-300"
        title={title}
      >
        {label}
      </Badge>
    );
  }
  return null;
}

/** 左侧文章区（纯展示）：篇目信息、划词工具栏、正文、篇目切换。 */
export function PassagePanel({ session, passageRef, emptyHint, furiganaEnabled, onToggleFurigana }: PassagePanelProps) {
  const { activeSet, plainBody, combinedSets, selectionRange } = session;
  if (!activeSet) {
    return (
      <div className="h-full rounded-2xl border border-dashed border-line-amber-900o20-amber-500o20 bg-paper-soft flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Newspaper className="w-8 h-8 text-tone-amber-500o70" />
        <p className="text-sm font-medium text-ink-mute-deep">
          {emptyHint}
        </p>
        <p className="text-xs text-ink-stone-500">
          当前学习轨道暂无篇目 · 可点右上角「自适应生成」创建阅读材料
        </p>
      </div>
    );
  }
  return (
    <div
      ref={passageRef}
      onMouseUp={session.handleMouseUpPassage}
      onKeyUp={session.handleMouseUpPassage}
      data-manual-lookup="true"
      className="h-full rounded-2xl border border-line-accent bg-paper-soft shadow-xs flex flex-col overflow-hidden relative"
    >
      {/* 划词悬浮快捷栏 */}
      <AnimatePresence>
        {selectionRange && (
          <SelectionToolbar selection={selectionRange} session={session} />
        )}
      </AnimatePresence>

      {/* 顶部篇目信息栏与操作 */}
      <div className="px-4 py-3 border-b border-line-accent flex flex-wrap items-center gap-2 justify-between bg-wash-amber-500o5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={activeSet.origin === 'ai' ? 'amber' : 'emerald'}>
              {activeSet.origin === 'ai' ? 'AI 生成篇目' : '新闻材料'}
            </Badge>
            <SourceBadges session={session} />
            <Badge variant="secondary" className="font-mono text-xs">
              Lv.{activeSet.difficulty}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {activeSet.language === 'JA' ? '日文' : activeSet.language === 'KO' ? '韩文' : '英文'}
            </Badge>
            <span className="text-xs text-ink-stone-500 truncate">{activeSet.sourceLabel}</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold font-serif text-ink truncate">
            {activeSet.title}
          </h3>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* TTS 朗读控制 */}
          <Button
            variant={session.isPlayingAudio ? 'amber' : 'outline'}
            size="sm"
            onClick={session.handleTogglePlayAudio}
            className="text-xs gap-1"
          >
            {session.isPlayingAudio ? (
              <>
                <Square className="w-3.5 h-3.5 animate-pulse text-ink-amber-900-amber-100" />
                停止
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-accent-ink-warm" />
                全文朗读
              </>
            )}
          </Button>

          {/* 假名注音开关 (仅日文篇目可见) */}
          {activeSet.language === 'JA' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleFurigana}
              className={`text-xs gap-1 ${furiganaEnabled ? 'text-tone-amber-700 font-bold' : 'text-ink-stone-400'}`}
              title="切换假名注音辅助"
              aria-pressed={furiganaEnabled}
            >
              <Languages className="w-3.5 h-3.5" />
              注音
            </Button>
          )}

          {activeSet.sourceUrl && (
            <a
              href={activeSet.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={activeSet.sourceUrl}
              onClick={() => sound.playClick()}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-xs gap-1')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              查看原文
            </a>
          )}
        </div>
      </div>

      {/* 篇目列表切换胶囊 */}
      {combinedSets.length > 1 && (
        <div className="px-4 py-2 border-b border-line-stone-200o50-stone-800o50 flex items-center gap-2 overflow-x-auto bg-veil-stone-100o40-stone-900o30">
          <Bookmark className="w-3 h-3 text-ink-stone-400 shrink-0" />
          <span className="text-xs text-ink-stone-400 shrink-0">当前精选：</span>
          <div className="flex items-center gap-1.5 flex-nowrap">
            {combinedSets.map((s) => (
              <button
                key={s.id}
                onClick={() => session.switchToSet(s.id)}
                aria-current={s.id === activeSet.id}
                className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all ${
                  s.id === activeSet.id
                    ? 'bg-tone-amber-600 text-tone-white font-medium shadow-xs'
                    : 'text-ink-faint-soft hover:bg-veil-stone-200o70-stone-800'
                }`}
              >
                {s.title.slice(0, 14)}...
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 正文呈现区 */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 select-text">
        <p className="text-[15px] sm:text-base leading-8 whitespace-pre-wrap font-serif text-ink-soft selection:bg-tone-amber-500o25 selection:text-ink-amber-900-amber-100">
          {plainBody}
        </p>
      </div>

      <div className="px-4 py-2 text-xs text-ink-hint border-t border-line-amber-900o5-amber-500o5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 shrink-0" />
          选中文字可朗读、保存重点或制作记忆卡
          {activeSet.sourceUrl ? ' · 右上角可打开媒体原文核对' : ''}
        </span>
        <span className="shrink-0">共 {plainBody.length} 字/词</span>
      </div>
    </div>
  );
}

function SelectionToolbar({ selection, session }: { selection: SelectionAnchor; session: ReadingSession }) {
  const activeSet = session.activeSet;
  if (!activeSet) return null;
  const speak = () => {
    sound.playClick();
    speechStudio.speak(selection.text, { lang: activeSet.language });
  };
  const itemClass =
    'flex items-center gap-1 px-2.5 py-1.5 hover:bg-tone-stone-800 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 4 }}
      style={{ left: selection.x, top: selection.y }}
      className="absolute z-30 flex items-center gap-1 p-1 bg-tone-stone-900 text-tone-white rounded-xl shadow-xl text-xs"
      role="toolbar"
      aria-label="划词工具"
    >
      <button onClick={speak} className={itemClass}>
        <Volume2 className="w-3.5 h-3.5 text-ink-amber-400" />
        朗读
      </button>
      <div className="w-[1px] h-3.5 bg-tone-stone-700" />
      <button disabled={session.annotationPending} onClick={session.handleMarkKeyPoint} className={itemClass}>
        <Highlighter className="w-3.5 h-3.5 text-ink-amber-400" />
        标重点
      </button>
      <div className="w-[1px] h-3.5 bg-tone-stone-700" />
      <button onClick={session.handleLookupSelection} className={itemClass}>
        <Languages className="w-3.5 h-3.5 text-tone-sky-400" />
        查词
      </button>
      <div className="w-[1px] h-3.5 bg-tone-stone-700" />
      <button disabled={session.cardPending} onClick={session.handleConvertToFlashcard} className={itemClass}>
        <CreditCard className="w-3.5 h-3.5 text-ink-emerald-400" />
        转闪卡
      </button>
    </motion.div>
  );
}
