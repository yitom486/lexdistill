import type { TextbookLearningContent } from '@study-studio/document-model';
import { BookOpen, BookText, Languages, ListChecks, MessageSquareText, ChevronRight, ArrowRight, Route, CheckCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs.js';
import { Badge } from '../../ui/badge.js';
import { Switch } from '../../ui/switch.js';
import { Button } from '../../ui/button.js';
import { PreviewGrammar, PreviewSentences, PreviewVocabulary, PreviewMaterial } from './PreviewContentSections.js';
import { PreviewExercises } from './PreviewExercises.js';
import { useTextbookNavigationStore, type LearningSection } from '../../../stores/useTextbookNavigationStore.js';
import { InteractiveReading } from './InteractiveReading.js';
import { StudyExplanation } from './StudyExplanation.js';
import { StudyGuide } from './StudyGuide.js';
import type { ChapterStudy, StudyDetail } from './study-view.js';

export function LearningPreviewPage({ content, bookTitle, bookId = '', chapterTitle, chapterId, subtitle, language, study, onAskAiTutor, temporary = true }: {
  content: TextbookLearningContent; bookTitle: string; chapterTitle: string; chapterId: string; subtitle: string; language: string; temporary?: boolean;
  bookId?: string;
  study?: ChapterStudy | undefined; onAskAiTutor?: ((text: string, context: string) => void) | undefined;
}) {
  const categories = ([
    { key: 'overview', title: '本课导学', count: study?.goals.length ?? 0, unit: '个目标', icon: Route, note: '先看目标和学习主线，再开始本课。' },
    { key: 'articles', title: '文章与会话', count: content.articles.length, unit: '篇', icon: BookOpen, note: '先读完整内容，理解这一章的语境。' },
    { key: 'vocabulary', title: '词汇', count: content.vocabulary.length, unit: '个', icon: Languages, note: '结合词义和例句学习，把需要复习的词留下。' },
    { key: 'grammar', title: '知识点', count: content.grammar.length, unit: '项', icon: BookText, note: '把规则、接续和例句放在一起理解。' },
    { key: 'sentences', title: '句子', count: content.sentences.length, unit: '句', icon: MessageSquareText, note: '用完整句子练习表达，按需查看译文与用法。' },
    { key: 'exercises', title: '练习', count: content.exercises.length, unit: '道', icon: ListChecks, note: '先尝试作答，再对照答案和解析。' },
    { key: 'summary', title: '总结与自检', count: study?.selfCheck.length ?? 0, unit: '个问题', icon: CheckCheck, note: '串联本课知识，检查自己能否独立表达。' },
  ] as const).filter(category => category.count > 0);
  const navigation = useTextbookNavigationStore();
  const active = categories.find(category => category.key === navigation.sectionsByChapter[chapterId])?.key ?? categories[0]?.key ?? '';
  const setActive = (section: LearningSection) => { if (categories.some(category => category.key === section)) navigation.selectSection(chapterId, section); };
  const showTranslation = navigation.showTranslation;
  const selected = categories.find(category => category.key === active);
  const next = categories[categories.findIndex(category => category.key === active) + 1];
  const explain = (detail: StudyDetail, label: string, disabled = false) => <StudyExplanation key={`${detail.title}-${detail.text}`} detail={detail} label={label} disabled={disabled} content={content} language={language} onAsk={onAskAiTutor ? (text, context) => onAskAiTutor(text, `教材：${bookTitle}\n章节：${chapterTitle}\n语种：${language}\n${context}\n请解释当前选中表达，结合本课语境说明用法与注意点。`) : undefined} />;
  const props = { content, showTranslation, language, explain, ask: onAskAiTutor ? (text: string, context: string) => onAskAiTutor(text, `教材：${bookTitle}\n章节：${chapterTitle}\n语种：${language}\n${context}\n请围绕当前知识点回答，结合例句说明。`) : undefined };
  return <div className="flex min-h-0 flex-1 flex-col bg-surface-warm text-ink" data-testid="learning-preview-page">
    <header className="border-b border-line-soft bg-paper-soft px-7 py-6 sm:px-9">
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted"><BookOpen className="h-4 w-4 text-accent-ink" /><span>{bookTitle}</span><ChevronRight className="h-3 w-3" /><span>本课学习</span></div>
      <div className="flex flex-wrap items-center gap-3"><h2 className="font-serif text-2xl font-bold sm:text-3xl">{chapterTitle}</h2>{temporary && <Badge variant="amber">临时演示</Badge>}</div>
      <p className="mt-3 text-sm text-ink-muted">{subtitle}</p>
    </header>
    {categories.length ? <Tabs value={active} onValueChange={value => { const category = categories.find(item => item.key === value); if (category) setActive(category.key); }} orientation="vertical" className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-line-soft bg-paper-soft px-4 py-6">
        <p className="mb-4 px-3 text-xs font-semibold tracking-wider text-ink-muted">本课内容</p>
        <TabsList aria-label="学习内容分类" className="flex w-full flex-col items-stretch gap-2 rounded-none border-0 bg-transparent p-0">
          {categories.map(category => <TabsTrigger key={category.key} value={category.key} className="w-full justify-start rounded-xl px-3 py-3.5 text-sm text-ink-muted data-[selected]:bg-wash-amber-500o15 data-[selected]:text-accent-ink"><category.icon className="h-4 w-4 shrink-0" />{category.title}<span className="ml-auto text-xs tabular-nums opacity-70">{category.count}</span></TabsTrigger>)}
        </TabsList>
        {content.material && <div className="mt-4 px-3"><PreviewMaterial text={content.material} /></div>}
        {!!content.grammar.length && <div className="mt-5 space-y-1 border-t border-line-soft pt-4"><p className="px-3 text-xs font-semibold text-ink-muted">本课重点</p>{content.grammar.map(point => <Button key={point.id} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left text-xs leading-6" onClick={() => setActive('grammar')}>{point.title}</Button>)}</div>}
        <p className="mt-auto px-3 pt-6 text-xs leading-6 text-ink-muted">先理解，再记忆，再练习。<br />可以随时切换本课内容。</p>
      </aside>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-7 sm:px-9">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-baseline gap-3"><h2 className="text-xl font-bold">{selected?.title}</h2><span className="text-xs text-ink-muted">{selected?.count} {selected?.unit}</span></div><p className="mt-2 text-xs leading-6 text-ink-muted">{selected?.note}</p></div>{active !== 'exercises' && active !== 'overview' && active !== 'summary' && <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted"><Switch checked={showTranslation} onCheckedChange={navigation.setShowTranslation} aria-label="显示译文与词义" />显示译文与词义</label>}</div>
          {study && <TabsContent value="overview" keepMounted className="m-0"><StudyGuide study={study} summary={false} onNavigate={setActive} /></TabsContent>}
          <TabsContent value="articles" keepMounted className="m-0"><InteractiveReading {...props} study={study} /></TabsContent>
          <TabsContent value="vocabulary" keepMounted className="m-0"><PreviewVocabulary {...props} /></TabsContent>
          <TabsContent value="grammar" keepMounted className="m-0"><PreviewGrammar {...props} /></TabsContent>
          <TabsContent value="sentences" keepMounted className="m-0"><PreviewSentences {...props} /></TabsContent>
          <TabsContent value="exercises" keepMounted className="m-0"><PreviewExercises exercises={content.exercises} temporary={temporary} scope={{ documentId: bookId, chapterId, chapterTitle, language: language.toLowerCase() === 'en' ? 'en' : language.toLowerCase() === 'ko' ? 'ko' : 'ja', knowledge: content.grammar.map(point => ({ title: point.title, explanation: point.explanation })), rubricVersion: 'textbook-grade-v1' }} /></TabsContent>
          {study && <TabsContent value="summary" keepMounted className="m-0"><StudyGuide study={study} summary onNavigate={setActive} /></TabsContent>}
          {next && <div className="mt-7 flex justify-end"><Button variant="outline" onClick={() => setActive(next.key)}>继续学习{next.title}<ArrowRight className="h-4 w-4" /></Button></div>}
        </div>
      </div>
    </Tabs> : <p className="p-9 text-sm text-ink-muted">本章尚无学习内容。</p>}
    <footer className="border-t border-line-soft bg-paper-soft px-7 py-3 text-xs text-ink-muted">{temporary ? '临时演示内容 · 不写入正式学情；AI 批改需主动点击。' : '正式提交保留作答历史；失败不计分，重试不新增作答次数。'}</footer>
  </div>;
}
