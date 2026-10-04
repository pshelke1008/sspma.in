import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-1',
  {
    variants: {
      variant: {
        primary: 'bg-brand-primary text-white hover:bg-brand shadow-sm',
        secondary: 'bg-brand-light text-brand hover:bg-brand-light/70 border border-brand-light',
        // White on orange is only 2.5:1 — the dark ink keeps this legible.
        accent: 'bg-accent text-ink hover:bg-accent/90 shadow-sm',
        outline: 'border border-line bg-white text-ink hover:bg-canvas',
        ghost: 'text-ink-muted hover:bg-canvas hover:text-ink',
        danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
        'danger-outline': 'border border-danger/40 bg-white text-danger hover:bg-danger/5',
        success: 'bg-success text-white hover:bg-success/90 shadow-sm',
        link: 'text-brand-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[12.5px]',
        md: 'h-9 px-3.5',
        lg: 'h-11 px-5 text-[14px]',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
