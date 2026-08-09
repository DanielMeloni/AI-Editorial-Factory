import { cn } from '@/lib/utils/cn';

/** Marchio dell'applicazione: SVG inline, nessuna richiesta di rete. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 32 32"
        className="size-8 shrink-0"
        role="img"
        aria-label="AI Editorial Factory"
      >
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M9 22V10h3.4l3.6 8 3.6-8H23v12h-2.6v-7.6L17 22h-2l-3.4-7.6V22H9Z" fill="white" />
      </svg>
      {!compact ? (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">AI Editorial Factory</span>
          <span className="text-[11px] text-muted-foreground">Redazione multi-agente</span>
        </span>
      ) : null}
    </span>
  );
}
