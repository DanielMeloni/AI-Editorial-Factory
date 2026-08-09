import { z } from 'zod';

/**
 * Validazione delle variabili di ambiente.
 *
 * La validazione e' volutamente PIGRA (eseguita alla prima chiamata, non
 * all'import) per due motivi:
 *  - `next build` non deve fallire su una macchina priva di segreti;
 *  - l'errore deve comparire alla prima richiesta reale, con un messaggio utile.
 *
 * I riferimenti a `process.env.NEXT_PUBLIC_*` sono letterali: Next.js li
 * sostituisce staticamente in fase di build.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url({ error: 'NEXT_PUBLIC_APP_URL deve essere un URL assoluto' }),
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL deve essere un URL assoluto' }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sembra troppo corta'),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY sembra troppo corta')
    .optional(),
  AI_TEXT_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  AI_TEXT_MODEL: z.string().min(1).default('mock-text-1'),
  AI_IMAGE_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  AI_IMAGE_MODEL: z.string().min(1).default('mock-image-1'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

class EnvError extends Error {
  constructor(scope: string, issues: z.core.$ZodIssue[]) {
    super(
      `Configurazione ${scope} non valida.\n${formatIssues(issues)}\n` +
        'Copia .env.example in .env.local e compila i valori mancanti.',
    );
    this.name = 'EnvError';
  }
}

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

/** Variabili esposte al browser. Nessun segreto deve comparire qui. */
export function getPublicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;

  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) throw new EnvError('pubblica', parsed.error.issues);
  cachedPublic = parsed.data;
  return cachedPublic;
}

/** Variabili riservate al server. Non importare questo modulo da codice client. */
export function getServerEnv(): ServerEnv {
  if (cachedServer) return cachedServer;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    AI_TEXT_PROVIDER: process.env.AI_TEXT_PROVIDER,
    AI_TEXT_MODEL: process.env.AI_TEXT_MODEL,
    AI_IMAGE_PROVIDER: process.env.AI_IMAGE_PROVIDER,
    AI_IMAGE_MODEL: process.env.AI_IMAGE_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });

  if (!parsed.success) throw new EnvError('server', parsed.error.issues);
  cachedServer = parsed.data;
  return cachedServer;
}

/** Vero se la configurazione pubblica minima e' presente. Non lancia eccezioni. */
export function isSupabaseConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}
