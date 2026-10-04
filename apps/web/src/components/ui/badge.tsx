import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-canvas text-ink-muted border border-line',
        brand: 'bg-brand-light text-brand border border-brand-light',
        success: 'bg-success/10 text-success border border-success/20',
        warning: 'bg-warning/10 text-[#986812] border border-warning/25',
        danger: 'bg-danger/10 text-danger border border-danger/20',
        info: 'bg-info/10 text-info border border-info/20',
        accent: 'bg-accent-light text-accent-ink border border-accent/25',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
