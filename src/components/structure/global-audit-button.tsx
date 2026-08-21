'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { startProjectAudit } from '@/lib/workflows/actions';

export function GlobalAuditButton({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Button disabled={disabled || pending} onClick={() => startTransition(async () => {
    const result = await startProjectAudit(projectId);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    router.refresh();
  })}><Play aria-hidden="true" />{pending ? 'Avvio degli audit…' : 'Avvia audit completo'}</Button>;
}
