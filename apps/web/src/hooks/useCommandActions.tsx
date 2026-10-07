import React, { useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  BookOpen,
  Zap,
  Sparkles,
  Layers,
  Headphones,
  Mic,
  AlertTriangle,
  TrendingUp,
  Flame,
  Moon,
  Sun,
  Newspaper,
  PenLine,
  CalendarCheck,
  ClipboardList,
} from 'lucide-react';
import { sound } from '../utils/audio.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import type { CommandAction } from '../components/CommandPalette.js';

export function useCommandActions(unresolvedMistakeCount: number): CommandAction[] {
  const theme = usePreferencesStore((s) => s.theme);
  const toggleTheme = usePreferencesStore((s) => s.toggleTheme);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);
  const setIsCommandOpen = useStudySessionStore((s) => s.setIsCommandOpen);
  const toggleCommandOpen = useStudySessionStore((s) => s.toggleCommandOpen);

  // 全局 ⌘/Ctrl+K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        sound.playClick();
        toggleCommandOpen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCommandOpen]);

  const startLessonQuiz = (lessonId: string, lessonTitle: string) => {
    setActiveTab('QUIZ');
    if (lessonId === 'biaori-l1') setQuestionIndex(4);
    else if (lessonId === 'biaori-l2') setQuestionIndex(5);
    else setQuestionIndex(0);
    toast.success(`已为您载入《${lessonTitle}》专属测评题！`);
    setIsCommandOpen(false);
  };

  return useMemo(
    () => [
      {
        id: 'nav-today',
        category: '导航',
        title: '前往今日学习计划',
        subtitle: '按输入 → 精读 → 练习的顺序串联现有模块',
        icon: <CalendarCheck className="w-4 h-4" />,
        shortcut: 'Tab 0',
        onSelect: () => setActiveTab('TODAY'),
      },
      {
        id: 'nav-quiz',
        category: '导航',
        title: '前往自适应做题练习',
        subtitle: '多题型智能测评与客观秒判 (0ms)',
        icon: <Zap className="w-4 h-4" />,
        shortcut: 'Tab 1',
        onSelect: () => setActiveTab('QUIZ'),
      },
      {
        id: 'nav-generation',
        category: '导航',
        title: '前往 AI 出题',
        subtitle: '冻结配置后台出题 · 试卷作答与复盘',
        icon: <Sparkles className="w-4 h-4" />,
        onSelect: () => setActiveTab('GENERATION'),
      },
      {
        id: 'nav-cards',
        category: '导航',
        title: '前往 FSRS 卡片记忆工坊',
        subtitle: '支持 3D 翻转与 4 级间隔重复调度',
        icon: <Layers className="w-4 h-4" />,
        shortcut: 'Tab 2',
        onSelect: () => setActiveTab('CARDS'),
      },
      {
        id: 'nav-practice-plan',
        category: '导航',
        title: '前往我的练习计划',
        subtitle: '自定义块组合模板 · 客观秒判与主观 AI 批量批改',
        icon: <ClipboardList className="w-4 h-4" />,
        onSelect: () => setActiveTab('PRACTICE_PLAN'),
      },
      {
        id: 'nav-reading',
        category: '导航',
        title: '前往阅读理解工作室',
        subtitle: 'AI 文章 / 新闻双源 · 左文右题可调宽双栏',
        icon: <Newspaper className="w-4 h-4" />,
        onSelect: () => setActiveTab('READING'),
      },
      {
        id: 'nav-writing',
        category: '导航',
        title: '前往写作与翻译工作室',
        subtitle: '体裁难度可调 · 主观题多维批改',
        icon: <PenLine className="w-4 h-4" />,
        onSelect: () => setActiveTab('WRITING'),
      },
      {
        id: 'nav-textbook',
        category: '导航',
        title: '前往结构化教材精读 (标日 / 大家的日语)',
        subtitle: '课文注音精读、核心词汇库与一键课后测验',
        icon: <BookOpen className="w-4 h-4" />,
        onSelect: () => setActiveTab('TEXTBOOK'),
      },
      {
        id: 'nav-shadowing',
        category: '导航',
        title: '前往听力精听与影子跟读工作台',
        subtitle: '短句切片原声循环、假名遮罩与关键助词听写',
        icon: <Headphones className="w-4 h-4" />,
        shortcut: 'Tab 4',
        onSelect: () => setActiveTab('SHADOWING'),
      },
      {
        id: 'nav-pitch',
        category: '导航',
        title: '前往 AI 日语声调与口语纠音',
        subtitle: '高低起伏走势线与实时声波跟读打分',
        icon: <Mic className="w-4 h-4" />,
        shortcut: 'Tab 5',
        onSelect: () => setActiveTab('PITCH'),
      },
      {
        id: 'nav-mistakes',
        category: '导航',
        title: '前往错题智能攻坚台',
        subtitle: `当前有 ${unresolvedMistakeCount} 道待攻克疑难痛点`,
        icon: <AlertTriangle className="w-4 h-4" />,
        shortcut: 'Tab 6',
        onSelect: () => setActiveTab('MISTAKES'),
      },
      {
        id: 'nav-radar',
        category: '导航',
        title: '前往学情能力画像与打卡热力图',
        subtitle: '语法、词汇、听力多维雷达与弱项靶向加练',
        icon: <TrendingUp className="w-4 h-4" />,
        shortcut: 'Tab 7',
        onSelect: () => setActiveTab('RADAR'),
      },
      {
        id: 'drill-biaori-1',
        category: '教材直达',
        title: '《标准日本语 初级上》第 1 课 李さんは中国人です',
        subtitle: '肯定判断句与自我介绍专攻',
        icon: <BookOpen className="w-4 h-4" />,
        onSelect: () => startLessonQuiz('biaori-l1', '标日第 1 课'),
      },
      {
        id: 'drill-biaori-2',
        category: '教材直达',
        title: '《标准日本语 初级上》第 2 课 これは何ですか',
        subtitle: '这/那/那事物指示代词专攻',
        icon: <BookOpen className="w-4 h-4" />,
        onSelect: () => startLessonQuiz('biaori-l2', '标日第 2 课'),
      },
      {
        id: 'drill-particles',
        category: '专项攻坚',
        title: '格助词高频混淆专练 (で vs に vs を)',
        subtitle: '攻破外语学习最大母语负迁移陷阱',
        icon: <Flame className="w-4 h-4" />,
        onSelect: () => {
          setActiveTab('QUIZ');
          setQuestionIndex(0);
          toast.info('已为您切换至【格助词辨析】专项练习！');
        },
      },
      {
        id: 'sys-theme',
        category: '系统设置',
        title: theme === 'light' ? '切换为深焙炭石夜间模式' : '切换为温润纸面日间模式',
        subtitle: '纯自然护眼温润配色',
        icon: theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />,
        shortcut: 'Theme',
        onSelect: toggleTheme,
      },
    ],
    [theme, unresolvedMistakeCount, toggleTheme, setActiveTab, setQuestionIndex]
  );
}

export function useStartLessonQuiz() {
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);

  return (lessonId: string, lessonTitle: string) => {
    setActiveTab('QUIZ');
    if (lessonId === 'biaori-l1') setQuestionIndex(4);
    else if (lessonId === 'biaori-l2') setQuestionIndex(5);
    else setQuestionIndex(0);
    toast.success(`已为您载入《${lessonTitle}》专属测评题！`);
  };
}
