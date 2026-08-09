'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SubmitButton({ children, block = true }: { children: string; block?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" block={block} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? 'Attendere…' : children}
    </Button>
  );
}
