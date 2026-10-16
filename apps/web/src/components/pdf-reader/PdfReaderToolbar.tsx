import {
  BookOpen,
  Layers,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Highlighter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import type { ReaderViewMode } from './useReadingProgress.js';

interface PdfReaderToolbarProps {
  viewMode: ReaderViewMode;
  onViewModeChange: (mode: ReaderViewMode) => void;
  /** 有结构化内容时隐藏“原版排版”切换 */
  structuredAvailable: boolean;
  showTranslation: boolean;
  onToggleTranslation: () => void;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showZoom: boolean;
  annotationsCount: number | undefined;
  onStartQuiz: () => void;
}

function PdfPageControls({
  currentPage,
  totalPages,
  onPrev,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onPrev}
        disabled={currentPage <= 1}
        aria-label="上一页"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md border border-line-hairline bg-surface/80 text-ink-faint-soft">
        {String(currentPage).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
      </span>
      <Button
        variant="outline"
        size="icon"
        onClick={onNext}
        disabled={currentPage >= totalPages}
        aria-label="下一页"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

/** 沉浸式紧凑阅读控制栏：模式切换 + 对照显隐 + 缩放 + 批注计数 + 本课测验。 */
export function PdfReaderToolbar({
  viewMode,
  onViewModeChange,
  structuredAvailable,
  showTranslation,
  onToggleTranslation,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  showZoom,
  annotationsCount,
  onStartQuiz,
}: PdfReaderToolbarProps) {
  return (
    <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl">
      <Tabs
        value={viewMode}
        onValueChange={(val) => {
          if (!val) return;
          sound.playClick();
          onViewModeChange(val as ReaderViewMode);
        }}
      >
        <TabsList className="bg-veil-stone-200o70-stone-800o80">
          <TabsIndicator />
          {!structuredAvailable && <TabsTrigger value="PDF_PAGE" className="px-3 py-1.5 text-xs gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            课文排版
          </TabsTrigger>}
          <TabsTrigger value="STRUCTURED" className="px-3 py-1.5 text-xs gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            结构分解导读
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            sound.playClick();
            onToggleTranslation();
          }}
          className="gap-1.5"
          aria-label={showTranslation ? '隐藏中文对照' : '显示中文对照'}
        >
          {showTranslation ? (
            <>
              <Eye className="w-3.5 h-3.5 text-gold-warm" />
              <span>中文对照: 开启</span>
            </>
          ) : (
            <>
              <EyeOff className="w-3.5 h-3.5" />
              <span>中文对照: 隐藏</span>
            </>
          )}
        </Button>

        {showZoom && (
          <div className="flex items-center gap-1 border border-line-hairline rounded-xl px-1 py-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={onZoomOut}
              className="h-7 w-7"
              title="缩小"
              aria-label="缩小字号"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs font-mono font-semibold px-1 text-ink-faint-soft">
              {zoomLevel}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onZoomIn}
              className="h-7 w-7"
              title="放大"
              aria-label="放大字号"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {annotationsCount !== undefined && annotationsCount > 0 && (
          <Badge variant="amber" className="text-xs gap-1 px-2.5 py-1">
            <Highlighter className="w-3 h-3" />
            <span>{annotationsCount ?? '—'} 条重点批注</span>
          </Badge>
        )}

        <Button
          variant="amber"
          size="sm"
          onClick={() => {
            sound.playClick();
            onStartQuiz();
          }}
          className="gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          练习本课测验
        </Button>
      </div>
    </div>
  );
}

export { PdfPageControls };
