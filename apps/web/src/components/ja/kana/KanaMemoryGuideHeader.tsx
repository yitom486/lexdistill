import { BookOpen } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog.js';
export function KanaMemoryGuideHeader() { return (
          <DialogHeader className="shrink-0 border-b border-line-amber-900o10 bg-linear-to-br from-grad-amber-50-amber-950o40 via-paper-soft to-grad-orange-50-orange-950o30 p-5 pr-12 dark:border-wash-amber-500o15 sm:p-7 sm:pr-14 transition-colors">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="amber" className="gap-1">
                <BookOpen className="h-3 w-3" />
                五十音记忆法
              </Badge>
              <span className="text-xs font-mono text-ink-ghost">
                先看地图，再开始练
              </span>
            </div>
            <DialogTitle className="mt-2 text-2xl leading-tight sm:text-3xl">
              五十音，其实没有你想的那么多
            </DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-relaxed">
              它不是 46 个需要排队挨个背的陌生符号，而是一套“元音打地基、辅音来组队”的声音地图。
              先看懂这张地图，记忆就不会变成和表格硬碰硬。
            </DialogDescription>
          </DialogHeader>
); }
