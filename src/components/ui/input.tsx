import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid ? true : undefined}
      className={cn(
        'flex h-10 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger' : 'border-border-strong',
        className,
      )}
      {...props}
    />
  );
}
