import { Layers, BookOpen, Search, Inbox, Sparkles } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import type { AnkiCardFormatInfo } from '../queries/useLearnerQueries.js';

export type WorkbenchTab = 'study' | 'review' | 'library' | 'dictionary' | 'queue';

interface WorkbenchNavHeaderProps {
  workbenchTab: WorkbenchTab;
  cardsCount: number;
  practiceCollectionsCount: number;
  formats?: AnkiCardFormatInfo[] | undefined;
  reviewFormatId?: string | undefined;
  onFormatChange: (id: string) => void;
  onOpenApkg: () => void;
  onExportApkg: () => void;
  isExporting: boolean;
}

/**
 * 闪卡工作台顶部导航栏与操作区：
 * 包含分区 Tab（今日学词、闪卡复习、词汇总库、词典查词、练习队列）以及 Anki 导入导出与模板选择。
 */
export function WorkbenchNavHeader({
  workbenchTab,
  cardsCount,
  practiceCollectionsCount,
  formats = [],
  reviewFormatId = 'study-basic',
  onFormatChange,
  onOpenApkg,
  onExportApkg,
  isExporting,
}: WorkbenchNavHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-amber-900o10 pb-3">
      <TabsList className="bg-veil-stone-200o60-stone-900">
        <TabsIndicator />
        <TabsTrigger value="study" className="gap-1.5 px-3 py-1.5 text-xs">
          <Sparkles className="h-3.5 w-3.5 text-accent-ink-warm" />
          <span>今日学词</span>
        </TabsTrigger>
        <TabsTrigger value="review" className="gap-1.5 px-3 py-1.5 text-xs">
          <Layers className="h-3.5 w-3.5" />
          <span>闪卡复习</span>
          {cardsCount > 0 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-mono leading-tight">
              {cardsCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-1.5 px-3 py-1.5 text-xs">
          <BookOpen className="h-3.5 w-3.5" />
          <span>词汇总库</span>
        </TabsTrigger>
        <TabsTrigger value="dictionary" className="gap-1.5 px-3 py-1.5 text-xs">
          <Search className="h-3.5 w-3.5" />
          <span>词典查词</span>
        </TabsTrigger>
        <TabsTrigger value="queue" className="gap-1.5 px-3 py-1.5 text-xs">
          <Inbox className="h-3.5 w-3.5" />
          <span>练习队列</span>
          {practiceCollectionsCount > 0 && (
            <Badge variant="amber" className="px-1.5 py-0 text-[10px] font-mono leading-tight">
              {practiceCollectionsCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {workbenchTab === 'review' && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onOpenApkg}
          >
            从 Anki 搬家
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={isExporting}
            title="导出当前语种生词本为 .apkg（传到手机导入 Anki）"
            onClick={onExportApkg}
          >
            {isExporting ? '导出中…' : '导出 .apkg'}
          </Button>
          {formats.length > 0 && (
            <Select
              value={reviewFormatId}
              onValueChange={(v) => {
                if (typeof v === 'string') {
                  sound.playClick();
                  onFormatChange(v);
                }
              }}
            >
              <SelectTrigger className="h-7 w-28 text-[11px]" title="复习卡片模板">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formats.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
