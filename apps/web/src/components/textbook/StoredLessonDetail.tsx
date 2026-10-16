import { Sparkles, Zap, BookmarkCheck, BookmarkPlus, BookOpen, Lightbulb } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { ShimmerButton } from '../magicui/index.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';
import { InteractivePdfReader } from '../InteractivePdfReader.js';
import { LearningContentPanel } from './LearningContentPanel.js';
import { StructuredLessonPanel } from './StructuredLessonPanel.js';
import { StructuredExerciseList } from './StructuredExerciseList.js';
import { ContentSource } from './ContentSource.js';
import { VocabularyExplanation } from './VocabularyExplanation.js';
import { StructuredVocabularyList } from './StructuredVocabularyList.js';
import type { StoredLessonActions } from './useStoredLessonActions.js';

export type LessonSubTab = 'READER' | 'VOCAB' | 'GRAMMAR' | 'EXERCISES';

interface LessonDetailProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  subTab: LessonSubTab;
  onSubTabChange: (tab: LessonSubTab) => void;
  actions: StoredLessonActions;
  onAddCardFromTextbook: (vocab: { front: string; back: string; category: string; prompt: string }) => Promise<unknown>;
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
  onAskAiTutor?: ((selectedText: string, contextPrompt: string) => void) | undefined;
}

/** 课次详情（纯展示）：标题栏、出题/抽词、子选项卡与四块内容。 */
export function StoredLessonDetail({
  book,
  lesson,
  subTab,
  onSubTabChange,
  actions,
  onAddCardFromTextbook,
  onStartLessonQuiz,
  onAskAiTutor,
}: LessonDetailProps) {
  return (
    <div className="lg:col-span-8 space-y-4">
      {/* 课次标题与快速靶向测验启动栏 */}
      <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-accent-ink-warm font-semibold">
                场景：{lesson.scene}
              </span>
              <span className="text-xs text-ink-stone-400">•</span>
              <span className="text-xs text-ink-ghost">
                等级：{lesson.targetLevel}
              </span>
            </div>
            <h3 className="text-xl font-bold font-serif text-ink mt-1">
              {lesson.title}
            </h3>
          </div>

          {/* 针对本课出题按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            {lesson.vocabularies.length === 0 && book.documentId && (
              <Button
                variant="outline"
                size="sm"
                disabled={actions.enriching}
                onClick={actions.enrichCurrentLesson}
                className="gap-1.5"
                title="AI 按本课课文抽生词与文法（非法条目自动丢弃）"
              >
                <Sparkles className="w-3.5 h-3.5 text-tone-amber-500" />
                <span>{actions.enriching ? '抽取中…' : 'AI 抽生词'}</span>
              </Button>
            )}
            <ShimmerButton
              onClick={() => {
                sound.playClick();
                void actions.startRealLessonQuiz(
                  book?.documentId,
                  lesson.id,
                  lesson.title
                );
              }}
              disabled={actions.quizzing}
              className="px-4 py-2 text-xs font-semibold flex items-center gap-2 shadow-md shrink-0"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{actions.quizzing ? '出题中…' : '启动本课专属自测 (按课文出题)'}</span>
            </ShimmerButton>
          </div>
        </div>

        {/* 子选项卡：交互精读与原版排版 | 核心词汇 | 核心语法 */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-line-amber-900o10-amber-500o10">
          <Tabs
            value={subTab}
            onValueChange={(val) => {
              if (!val) return;
              sound.playClick();
              onSubTabChange(val as LessonSubTab);
            }}
          >
            <TabsList className="bg-transparent p-0 border-0">
              <TabsIndicator className="bg-tone-amber-500 shadow-sm" />
              <TabsTrigger
                value="READER"
                className="px-3 py-1.5 text-xs gap-1 aria-selected:text-tone-stone-950"
              >
                <BookOpen className="w-3.5 h-3.5" />
                交互精读与排版 ({lesson.dialogues.length})
              </TabsTrigger>
              <TabsTrigger
                value="VOCAB"
                className="px-3 py-1.5 text-xs gap-1 aria-selected:text-tone-stone-950"
              >
                <BookOpen className="w-3.5 h-3.5" />
                重点词汇库 ({lesson.vocabularies.length})
              </TabsTrigger>
              <TabsTrigger
                value="GRAMMAR"
                className="px-3 py-1.5 text-xs gap-1 aria-selected:text-tone-stone-950"
              >
                <Lightbulb className="w-3.5 h-3.5" />
                核心文法剖析 ({lesson.grammarPoints.length})
              </TabsTrigger>
              {lesson.content && <TabsTrigger value="EXERCISES" className="px-3 py-1.5 text-xs">教材练习 ({lesson.content.exercises.length})</TabsTrigger>}
            </TabsList>
          </Tabs>
        </div>
      </div>
      {/* 子内容 1: 交互式阅读器 (双模式：原版双栏排版 + 划词查词 + 闪卡 + AI 导师) */}
      {subTab === 'READER' && (
        <InteractivePdfReader
          book={book}
          lesson={lesson}
          onAddCard={onAddCardFromTextbook}
          onStartLessonQuiz={(lessonId, lessonTitle) =>
            void actions.startRealLessonQuiz(book?.documentId, lessonId, lessonTitle)
          }
          onAskAiTutor={onAskAiTutor ?? (() => {})}
        />
      )}


      {/* 子内容 2: 重点词汇库 */}
      {subTab === 'VOCAB' && (
        lesson.content ? <StructuredVocabularyList words={lesson.content.vocabularies} {...(lesson.directory ? { directory: lesson.directory } : {})} added={actions.addedCardsMap} enableAi
          onAdd={id => { const word = lesson.vocabularies.find(item => item.id === id); if (word) actions.handleAddCard(word); }} /> :
        <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {lesson.vocabularies.map((vocab) => {
              const isAdded = actions.addedCardsMap[vocab.id];
              const provenance = lesson.content?.vocabularies.find(item => item.id === vocab.id);
              return (
                <div
                  key={vocab.id}
                  className="p-3.5 rounded-xl bg-veil-stone-100o70-stone-900o50 border border-tone-stone-200o80-stone-800 flex flex-col justify-between gap-2"
                >
                  {provenance && <div className="flex flex-wrap gap-1"><ContentSource source={provenance.source} />{provenance.fieldSources?.gloss && <ContentSource source={provenance.fieldSources.gloss} field="释义" />}{provenance.fieldSources?.reading && <ContentSource source={provenance.fieldSources.reading} field="注音" />}</div>}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-bold text-ink">
                          {vocab.kanji}
                        </span>
                        <span className="text-xs text-accent-ink-warm font-mono">
                          {vocab.kana}
                        </span>
                      </div>
                      <p className="text-xs text-ink-faint-soft mt-1 font-serif">
                        {vocab.chinese}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className="rounded text-xs font-mono">
                        {vocab.pitchAccent} {vocab.pitchType}
                      </Badge>
                    </div>
                  </div>

                  {provenance ? <VocabularyExplanation word={provenance} /> : <div className="text-xs text-ink-ghost bg-veil-stone-200o50-stone-800o40 p-2 rounded-lg">
                    <p className="font-medium text-ink-mute">{vocab.exampleSentence}</p>
                    <p className="text-ink-stone-500">{vocab.exampleTranslation}</p>
                  </div>}

                  <div className="flex justify-end pt-1">
                    <Button
                      variant={isAdded ? 'secondary' : 'amber'}
                      size="sm"
                      onClick={() => actions.handleAddCard(vocab)}
                      disabled={isAdded || actions.collecting}
                      className="gap-1 h-7"
                    >
                      {isAdded ? (
                        <>
                          <BookmarkCheck className="w-3.5 h-3.5" />
                          <span>已加入复习</span>
                        </>
                      ) : (
                        <>
                          <BookmarkPlus className="w-3.5 h-3.5" />
                          <span>{actions.collecting ? '加入中…' : '加为 FSRS 闪卡'}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 子内容 3: 核心文法剖析 */}
      {subTab === 'GRAMMAR' && (
        lesson.learningContent ? <LearningContentPanel content={lesson.learningContent} section="GRAMMAR" /> : lesson.content ? <StructuredLessonPanel content={lesson.content} tab="GRAMMAR" {...(lesson.directory ? { directory: lesson.directory } : {})} /> :
        <div className="space-y-4">
          {lesson.grammarPoints.map((gp) => (
            <div
              key={gp.id}
              className="bg-paper-soft rounded-2xl p-5 border border-line-accent space-y-3"
            >
              <div className="flex items-start justify-between">
                <h4 className="text-base font-bold text-ink font-serif">
                  {gp.title}
                </h4>
                <Badge variant="amber" className="text-xs font-mono">
                  {gp.structure}
                </Badge>
              </div>

              <p className="text-xs sm:text-sm text-ink-mute leading-relaxed">
                {gp.explanation}
              </p>

              {gp.contrast && (
                <div className="p-2.5 rounded-xl bg-wash-amber-500o10-amber-500o15 border border-tone-amber-500o20 text-xs text-ink-amber-950-amber-200">
                  <p className="flex items-start gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span><span className="font-semibold">辨析要点：</span>{gp.contrast}</span>
                  </p>
                </div>
              )}

              <div className="space-y-1.5 pt-2">
                <p className="text-xs font-semibold text-ink-ghost">典型用例：</p>
                {gp.examples.map((ex, exIdx) => (
                  <div
                    key={exIdx}
                    className="p-2.5 rounded-lg bg-veil-stone-100o80-stone-900o60 text-xs space-y-0.5"
                  >
                    <p className="font-medium text-ink">{ex.ja}</p>
                    <p className="text-ink-ghost font-serif">{ex.zh}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {subTab === 'EXERCISES' && lesson.content && <StructuredExerciseList exercises={lesson.content.exercises} {...(lesson.directory ? { directory: lesson.directory } : {})} />}
    </div>
  );
}
