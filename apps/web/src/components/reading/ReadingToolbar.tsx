import { useId, useRef } from 'react';
import { Newspaper, Sparkles, SlidersHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { sound } from '../../utils/audio.js';
import type { NewsTopic } from '@study-studio/protocol';
import type { ReadingSession } from './useReadingSession.js';

interface ReadingToolbarProps {
  session: ReadingSession;
  origin: 'ai' | 'news';
  onSwitchOrigin: (next: 'ai' | 'news') => void;
  readingLanguage: 'JA' | 'EN' | 'KO';
  aiDifficulty: string;
  onDifficultyChange: (v: string) => void;
  newsTopic: string;
  onNewsTopicChange: (v: string) => void;
  newsTopics: readonly NewsTopic[];
  subtitle: string;
}

function generateLoadingToast(
  origin: 'ai' | 'news',
  readingLanguage: 'JA' | 'EN' | 'KO',
  aiDifficulty: string,
  newsTopic: string
): string {
  if (origin === 'ai') {
    if (readingLanguage === 'EN') return `AI 正在按 CET/考研向难度 Lv.${aiDifficulty} 生成英语精读篇...`;
    if (readingLanguage === 'KO') return `AI 正在生成韩语轨道脚手架篇目（interim）Lv.${aiDifficulty}...`;
    return `AI 正在按难度 Lv.${aiDifficulty} 生成日语自适应长文...`;
  }
  if (readingLanguage === 'EN') return `正在从英语媒体抓取「${newsTopic}」原文（多源回退；失败则用 RSS 摘要）...`;
  if (readingLanguage === 'KO') return `正在从韩语公开源抓取「${newsTopic}」原文（联合新闻等；失败回退摘要）...`;
  return `正在从 NHK 等日语源抓取「${newsTopic}」正文（失败则回退 RSS）...`;
}

/** 顶部控制栏与生成器（纯展示 + 生成编排回调由容器传入 query 状态）。 */
export function ReadingToolbar(props: ReadingToolbarProps) {
  const { session } = props;
  const generateMutation = session.generateMutation;
  const generating = useRef(false);
  const generationToastId = useId();

  // 动态生成篇目：迟到回执只刷新列表，不抢用户已切换的新上下文
  const handleGenerateNewPassage = async () => {
    if (generating.current || generateMutation.isPending) return;
    generating.current = true;
    sound.playClick();
    const epoch = session.generateEpoch.current;
    const genOrigin = props.origin;
    const genLanguage = props.readingLanguage;
    try {
      toast.loading(
        generateLoadingToast(genOrigin, genLanguage, props.aiDifficulty, props.newsTopic),
        { id: generationToastId }
      );
      const generated = await generateMutation.mutateAsync({
        origin: genOrigin,
        difficulty: Number(props.aiDifficulty),
        language: genLanguage,
        topic:
          genOrigin === 'news'
            ? props.newsTopic
            : genLanguage === 'EN'
              ? 'education and media literacy'
              : genLanguage === 'KO'
                ? '시사·생활'
                : '日常生活与文化',
      });
      if (!session.isMounted()) return;
      if (epoch !== session.generateEpoch.current) {
        // 用户已切走：列表已由 mutation 失效刷新，只提示，不抢当前篇目
        toast.success('新篇目已生成，可在对应来源中查看。', { id: generationToastId });
        return;
      }
      toast.success(
        genOrigin === 'ai'
          ? genLanguage === 'KO'
            ? '韩语轨道 interim 篇目与配题已生成'
            : '自适应阅读长文与配套测试题生成成功！'
          : genLanguage === 'KO'
            ? '韩语公开新闻已就绪（原文摘录或 RSS 摘要）'
            : '真实新闻篇目抓取与排版完成！',
        { id: generationToastId }
      );
      if (generated?.id) {
        session.applyGeneratedSet(generated.id);
      }
    } catch (e) {
      if (!session.isMounted()) return;
      toast.error(e instanceof Error ? e.message : '生成篇目失败，请检查网关连接状态', { id: generationToastId });
    } finally {
      generating.current = false;
      if (!session.isMounted()) toast.dismiss?.(generationToastId);
    }
  };

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-2xl border border-line-accent bg-paper-soft shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center">
            <Newspaper className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold font-serif text-ink">
                阅读理解工作室 (Reading Studio)
              </h2>
              <Badge variant="amber" className="text-xs">
                双栏拖拽可调宽
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost mt-0.5">
              {props.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 篇目来源切换 */}
          <Tabs value={props.origin} onValueChange={(v) => v && props.onSwitchOrigin(v as 'ai' | 'news')}>
            <TabsList className="bg-veil-stone-200o60-stone-800">
              <TabsIndicator />
              <TabsTrigger value="ai" className="text-xs gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI 写文章
              </TabsTrigger>
              <TabsTrigger value="news" className="text-xs gap-1">
                <Newspaper className="w-3.5 h-3.5" /> 今日新闻
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {props.origin === 'ai' ? (
            <Select value={props.aiDifficulty} onValueChange={(v) => v && props.onDifficultyChange(v)}>
              <SelectTrigger className="w-[7.5rem]" aria-label="难度">
                <SelectValue>{`难度 Lv.${props.aiDifficulty}`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    难度 Lv.{d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={props.newsTopic} onValueChange={(v) => v && props.onNewsTopicChange(v)}>
              <SelectTrigger className="w-[8.5rem]" aria-label="栏目">
                <SelectValue>{props.newsTopics.find((t) => t.id === props.newsTopic)?.label ?? '栏目'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {props.newsTopics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={generateMutation.isPending}
            onClick={handleGenerateNewPassage}
            className="text-xs gap-1"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-3.5 h-3.5 text-tone-amber-600" />
                {props.origin === 'ai' ? '自适应生成' : '抓取新闻'}
              </>
            )}
          </Button>
        </div>
      </div>

      <p className="text-xs text-ink-stone-400 hidden md:block px-1">
        拖拽中间分隔条，或按 <kbd className="px-1 rounded bg-tone-stone-200o80-stone-800 font-mono">[</kbd>
        {' / '}
        <kbd className="px-1 rounded bg-tone-stone-200o80-stone-800 font-mono">]</kbd>
        微调双栏宽度（Shift 加大步进；偏好已本地持久化）。
      </p>
      <p className="text-xs text-ink-stone-400 md:hidden px-1">
        手机端为上下布局；桌面端可拖拽中间分隔条调整宽度（分栏偏好已自动本地持久化）。
      </p>
    </>
  );
}
