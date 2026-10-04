import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

/** Secondary controls use the same disclosure pattern throughout the import flow. */
export function ImportOptions({ title, summary, children, defaultOpen = false }: {
  title: string; summary?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-line-soft bg-paper-soft text-ink">
    <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-xl p-4 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>{summary && <span className="mt-1 block text-xs leading-5 text-ink-muted">{summary}</span>}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted ${open ? 'rotate-180' : ''}`} />
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-4 border-t border-line-soft p-4">{children}</CollapsibleContent>
  </Collapsible>;
}
