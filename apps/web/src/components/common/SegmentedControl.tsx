import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';

export interface Segment {
  value: string;
  label: string;
  count?: number;
}

/**
 * A filter switch, not a tab set. Real tabs must own the panel they control —
 * using them to drive a filter leaves `aria-controls` pointing at a panel that
 * never exists, so this renders as a labelled group of toggle buttons instead.
 */
export function SegmentedControl({
  value,
  onChange,
  segments,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  segments: Segment[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-canvas p-1', className)}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(segment.value)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
              active ? 'bg-white text-brand shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {segment.label}
            {segment.count !== undefined && segment.count > 0 && (
              <Badge tone={segment.value === 'pending' ? 'accent' : 'neutral'}>{segment.count}</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
