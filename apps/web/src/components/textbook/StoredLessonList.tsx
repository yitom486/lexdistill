import { Layers, ChevronRight, BookOpen } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import type { TextbookLesson } from '../../models/textbook.js';

interface LessonListProps {
  lessons: TextbookLesson[];
  selectedLessonId: string;
  onSelect: (id: string) => void;
}

/** 课次导航（纯展示）：大纲课次列表。 */
export function StoredLessonList({ lessons, selectedLessonId, onSelect }: LessonListProps) {
  return (
    <div className="lg:col-span-4 space-y-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-sm font-bold text-ink-mute flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-accent-ink" />
          课程大纲结构
        </h3>
        <span className="text-xs text-ink-hint">
          {lessons.length} 个单元
        </span>
      </div>

      <div className="space-y-2">
        {lessons.map((lesson) => {
          const isSelected = lesson.id === selectedLessonId;
          return (
            <Button
              key={lesson.id}
              variant="ghost"
              onClick={() => {
                sound.playClick();
                onSelect(lesson.id);
              }}
              aria-current={isSelected}
              className={`w-full h-auto text-left p-3.5 rounded-xl border justify-start transition-colors ${
                isSelected
                  ? 'bg-wash-amber-500o10 dark:bg-tone-amber-500o20 border-tone-amber-500o40 shadow-sm hover:bg-wash-amber-500o15'
                  : 'bg-paper-soft border-line-amber-900o10-amber-500o10 hover:border-line-amber-500o30'
              }`}
            >
              <div className="w-full">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge variant="amber" className="rounded text-xs font-mono">
                      {lesson.kind === 'section' ? '独立部分' : '课次'}
                    </Badge>
                    <h4 className="text-sm font-bold text-ink mt-1">
                      {lesson.title}
                    </h4>
                    <p className="text-xs text-ink-ghost mt-0.5">
                      {lesson.subTitle}
                    </p>
                  </div>
                  {isSelected && (
                    <ChevronRight className="w-4 h-4 text-accent-ink shrink-0 mt-1" />
                  )}
                </div>

                <div className="flex items-center gap-3 mt-2 text-xs text-ink-hint">
                  <span>词汇: {lesson.vocabularies.length}</span>
                  <span>文法: {lesson.grammarPoints.length}</span>
                  <span>会话: {lesson.dialogues.length}</span>
                </div>
              </div>
            </Button>
          );
        })}
        {lessons.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center space-y-2">
            <BookOpen className="w-6 h-6 mx-auto text-ink-ghost" />
            <p className="text-xs text-ink-ghost">该教材暂无课次</p>
          </div>
        )}
      </div>
    </div>
  );
}
