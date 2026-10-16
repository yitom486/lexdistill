import type { LessonContent } from '@lexdistill/document-model';
import { Badge } from '../ui/badge.js';
export function ContentSource({ source, field }: { source: LessonContent['blocks'][number]['source']; field?: string }) {
  return <Badge variant="outline">{field ? `${field}：` : ''}{source === 'AI' ? 'AI 补充' : '原书整理'}</Badge>;
}
