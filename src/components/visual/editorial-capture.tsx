'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { confirmEditorialCapture, requestEditorialCaptureTicket } from '@/lib/visual/actions';

export function EditorialCapture({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<'procedure' | 'result'>('procedure');
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');

  function upload(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      const ticket = await requestEditorialCaptureTicket({ projectId, filename: file.name, byteSize: file.size, mimeType: file.type });
      if (!ticket.ok) { toast.error(ticket.message); return; }
      const { error } = await createClient().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file);
      if (error) { toast.error(error.message); return; }
      const result = await confirmEditorialCapture({ projectId, assetId: ticket.assetId, path: ticket.path, filename: file.name, role, caption, altText });
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(result.message); setCaption(''); setAltText('');
      if (fileInput.current) fileInput.current.value = '';
      router.refresh();
    });
  }

  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Camera className="size-4"/>Acquisisci interfaccia reale</CardTitle><CardDescription>Carica una schermata procedurale o lo stato finale che il lettore deve vedere. Entra nel libro solo dopo approvazione.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
    <select value={role} onChange={(event) => setRole(event.target.value as 'procedure' | 'result')} className="h-9 rounded-md border border-border-strong bg-surface px-3 text-sm"><option value="procedure">Procedura / dove cliccare</option><option value="result">Risultato atteso</option></select>
    <Input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Didascalia" />
    <Input value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Testo alternativo" />
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="h-9 text-sm" onChange={(event) => upload(event.target.files?.[0])} disabled={pending || caption.trim().length < 3 || altText.trim().length < 3}/>
    <p className="text-xs text-muted-foreground sm:col-span-2">Prima compila didascalia e testo alternativo, poi scegli il file. PNG, JPEG o WebP, massimo 10 MB.</p>
  </CardContent></Card>;
}
