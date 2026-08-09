'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { createClient } from '@/lib/supabase/client';
import { requestUploadTicket } from '@/lib/projects/actions';
import { MAX_UPLOAD_BYTES } from '@/lib/sources/upload';

type Phase = 'idle' | 'preparing' | 'uploading' | 'ingesting';

/**
 * Caricamento in tre tempi:
 *   1. il server verifica la richiesta ed emette un URL firmato;
 *   2. il browser invia l'archivio direttamente a Supabase Storage;
 *   3. il server estrae e cataloga.
 *
 * L'archivio non attraversa mai il server applicativo: le Vercel Function
 * accettano al massimo circa 4,5 MB di corpo.
 */
export function SourceUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== 'idle';

  async function handleFile(file: File) {
    setError(null);

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Sono ammessi solo archivi .zip.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('L’archivio supera il limite di 1 GiB.');
      return;
    }

    try {
      setPhase('preparing');
      const ticket = await requestUploadTicket({
        projectId,
        filename: file.name,
        byteSize: file.size,
        mimeType: file.type,
      });

      if (!ticket.ok) {
        setError(ticket.message);
        setPhase('idle');
        return;
      }

      setPhase('uploading');
      setProgress(0);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file);

      if (uploadError) {
        setError(`Caricamento non riuscito: ${uploadError.message}`);
        setPhase('idle');
        return;
      }

      setProgress(100);
      setPhase('ingesting');

      const response = await fetch(
        `/api/projects/${projectId}/sources/${ticket.sourceId}/ingest`,
        { method: 'POST' },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        chaptersCreated?: number;
        stats?: { extracted: number; rejected: number; ignored: number };
      };

      if (!response.ok || !result.ok) {
        setError(result.error ?? 'Estrazione non riuscita.');
        setPhase('idle');
        router.refresh();
        return;
      }

      toast.success(
        `Archivio importato: ${result.stats?.extracted ?? 0} file, ${result.chaptersCreated ?? 0} capitoli.`,
      );
      setPhase('idle');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message || 'Operazione non riuscita.');
      setPhase('idle');
    }
  }

  const labels: Record<Phase, string> = {
    idle: 'Seleziona archivio ZIP',
    preparing: 'Preparazione…',
    uploading: 'Caricamento in corso…',
    ingesting: 'Analisi dell’archivio…',
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />

      <Button onClick={() => inputRef.current?.click()} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
        {labels[phase]}
      </Button>

      {phase === 'uploading' || phase === 'ingesting' ? (
        <div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === 'ingesting' ? 100 : progress}
            aria-label={labels[phase]}
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: phase === 'ingesting' ? '100%' : `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {phase === 'ingesting'
              ? 'Verifica dei percorsi, calcolo degli hash e ricostruzione della struttura. Può richiedere qualche minuto.'
              : 'Invio diretto allo storage privato.'}
          </p>
        </div>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
