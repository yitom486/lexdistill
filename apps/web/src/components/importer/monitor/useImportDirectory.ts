import { z } from 'zod';
import { ContentDirectoryNodeSchema, TextbookPipelineSettingsSchema, type ImportEvent } from '@study-studio/document-model';
import { useImportEventDetail } from '../../../queries/textbook-import-monitor.js';

const snapshotSchema = z.object({ directory: z.array(ContentDirectoryNodeSchema), settings: TextbookPipelineSettingsSchema });
export function useImportDirectory(userId: string, traceId: string, events: ImportEvent[], enabled: boolean) {
  const snapshot = events.filter(event => event.category === 'task' && event.name === 'started').at(-1);
  const query = useImportEventDetail(userId, traceId, snapshot?.sequence ?? 0, enabled && !!snapshot);
  const parsed = snapshotSchema.safeParse(query.data?.detail);
  return parsed.success ? parsed.data : null;
}
