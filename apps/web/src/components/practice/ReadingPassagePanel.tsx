import type { GeneratedQuestion } from '@study-studio/protocol';

export function ReadingPassagePanel({ reading }: { reading: NonNullable<GeneratedQuestion['reading']> }) {
  return <details open className="border-l-2 border-line-soft pl-4">
    <summary className="cursor-pointer text-sm font-medium">{reading.title}</summary>
    <div className="max-h-80 overflow-y-auto whitespace-pre-wrap py-3 text-sm leading-relaxed">{reading.body}</div>
  </details>;
}
