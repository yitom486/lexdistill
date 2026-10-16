import { Sparkles } from 'lucide-react';
export function GuideSectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-wash-amber-500o15 text-accent-ink-strong">
        <Sparkles className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-ink-strong">
          {eyebrow}
        </p>
        <h3 className="mt-0.5 text-lg font-serif font-bold text-ink">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          {description}
        </p>
      </div>
    </div>
  );
}
