'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { getImageProvider } from '@/lib/ai/registry';
import { recordAudit } from '@/lib/security/audit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { buildIsbnBarcode } from '@/lib/cover/barcode';

/**
 * Generazione e approvazione degli asset visuali.
 *
 * Ogni immagine finisce in un bucket **privato** e conserva tutto ciò che serve
 * a riprodurla: prompt, negative prompt, provider, modello, seme, dimensioni,
 * stile. Nessun asset è utilizzabile prima dell'approvazione umana.
 */

export interface VisualActionResult {
  ok: boolean;
  message: string;
  assetId?: string;
}

const generateSchema = z.object({
  projectId: z.string().uuid(),
  chapterId: z.string().uuid().nullable(),
  prompt: z.string().trim().min(10, 'Il prompt deve essere più descrittivo').max(2000),
  negativePrompt: z.string().trim().max(1000).nullable(),
  width: z.number().int().min(128).max(2048),
  height: z.number().int().min(128).max(2048),
  style: z.string().trim().max(120).nullable(),
  caption: z.string().trim().max(500),
  altText: z.string().trim().min(1, 'Il testo alternativo è obbligatorio').max(500),
  /** Se valorizzato, il nuovo asset è una variante di quello indicato. */
  parentAssetId: z.string().uuid().nullable(),
  seed: z.number().int().nullable(),
});

export type GenerateImageInput = z.infer<typeof generateSchema>;

/**
 * Genera un'illustrazione tramite l'adapter visuale configurato.
 *
 * Il testo importante non va mai dentro l'immagine: titoli, didascalie e dati
 * si compongono programmaticamente sopra di essa.
 */
export async function generateIllustration(
  input: GenerateImageInput,
): Promise<VisualActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', parsed.data.projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const limite = await checkRateLimit(supabase, 'imageGeneration', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  const { provider, degraded } = getImageProvider();

  let immagine;
  try {
    immagine = await provider.generate({
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt ?? undefined,
      width: parsed.data.width,
      height: parsed.data.height,
      style: parsed.data.style ?? undefined,
      seed: parsed.data.seed ?? undefined,
    });
  } catch (error) {
    console.error('Generazione immagine fallita', (error as Error).message);
    return { ok: false, message: 'Generazione non riuscita. Riprova più tardi.' };
  }

  // La versione cresce di uno rispetto all'ultima variante dello stesso ramo.
  const { data: precedente } = await supabase
    .from('visual_assets')
    .select('version')
    .eq('project_id', parsed.data.projectId)
    .eq('generator', 'ai')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  const version = (precedente?.version ?? 0) + 1;
  const assetId = crypto.randomUUID();
  const storagePath = `${organization.id}/${parsed.data.projectId}/assets/${assetId}.png`;

  const { error: uploadError } = await supabase.storage
    .from('generated-assets')
    .upload(storagePath, immagine.bytes, { contentType: immagine.mimeType, upsert: false });

  if (uploadError) {
    return { ok: false, message: `Salvataggio dell’immagine non riuscito: ${uploadError.message}` };
  }

  const { error: insertError } = await supabase.from('visual_assets').insert({
    id: assetId,
    project_id: parsed.data.projectId,
    organization_id: organization.id,
    chapter_id: parsed.data.chapterId,
    kind: 'illustration',
    generator: 'ai',
    // Nessun asset entra nell'opera senza che una persona lo abbia guardato.
    status: 'pending_approval',
    version,
    parent_asset_id: parsed.data.parentAssetId,
    title: parsed.data.caption.slice(0, 200) || 'Illustrazione',
    caption: parsed.data.caption,
    alt_text: parsed.data.altText,
    prompt: parsed.data.prompt,
    negative_prompt: parsed.data.negativePrompt,
    provider: immagine.provider,
    model: immagine.model,
    seed: immagine.seed,
    width: immagine.width,
    height: immagine.height,
    style: parsed.data.style,
    storage_bucket: 'generated-assets',
    storage_path: storagePath,
    cost_usd: immagine.estimatedCostUsd,
    created_by: user.id,
  });

  if (insertError) {
    // L'immagine è già su Storage: senza la riga resterebbe orfana.
    await supabase.storage.from('generated-assets').remove([storagePath]);
    return { ok: false, message: 'Registrazione dell’asset non riuscita.' };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'visual.generated',
    entityType: 'visual_asset',
    entityId: assetId,
    metadata: { provider: immagine.provider, model: immagine.model, seed: immagine.seed, version },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/visual-studio`);

  return {
    ok: true,
    assetId,
    message: degraded
      ? `Immagine generata. ${degraded}`
      : 'Immagine generata: ora richiede approvazione.',
  };
}

// ---------------------------------------------------------------------------
// Approvazione
// ---------------------------------------------------------------------------

export async function decideAsset(
  assetId: string,
  decision: 'approved' | 'rejected',
): Promise<VisualActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('visual_assets')
    .select('id, project_id, organization_id, chapter_id, kind, status')
    .eq('id', assetId)
    .maybeSingle<{
      id: string; project_id: string; organization_id: string;
      chapter_id: string | null; kind: string; status: string;
    }>();

  if (!asset || asset.organization_id !== organization.id) {
    return { ok: false, message: 'Asset non trovato.' };
  }

  const now = new Date().toISOString();

  await supabase
    .from('visual_assets')
    .update({
      status: decision,
      approved_by: decision === 'approved' ? user.id : null,
      approved_at: decision === 'approved' ? now : null,
    })
    .eq('id', assetId);

  // Approvando una figura, le precedenti dello stesso capitolo e tipo vengono
  // superate: resta una sola versione valida per volta.
  if (decision === 'approved' && asset.chapter_id) {
    await supabase
      .from('visual_assets')
      .update({ status: 'superseded' })
      .eq('chapter_id', asset.chapter_id)
      .eq('kind', asset.kind)
      .eq('status', 'approved')
      .neq('id', assetId);
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: `visual.${decision}`,
    entityType: 'visual_asset',
    entityId: assetId,
  });

  revalidatePath(`/projects/${asset.project_id}/visual-studio`);
  return {
    ok: true,
    message: decision === 'approved' ? 'Asset approvato.' : 'Asset rifiutato.',
  };
}

// ---------------------------------------------------------------------------
// URL firmato per la visualizzazione
// ---------------------------------------------------------------------------

/**
 * Gli asset stanno in bucket privati: la visualizzazione passa da un URL
 * firmato a breve scadenza, emesso solo dopo la verifica di appartenenza.
 */
export async function getAssetSignedUrl(assetId: string): Promise<string | null> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('visual_assets')
    .select('storage_bucket, storage_path, organization_id')
    .eq('id', assetId)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null; organization_id: string }>();

  if (!asset?.storage_path || asset.organization_id !== organization.id) return null;

  const { data } = await supabase.storage
    .from(asset.storage_bucket ?? 'generated-assets')
    .createSignedUrl(asset.storage_path, 300);

  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Copertina
// ---------------------------------------------------------------------------

const coverSchema = z.object({
  projectId: z.string().uuid(),
  trimWidthMm: z.number().positive().max(1000),
  trimHeightMm: z.number().positive().max(1000),
  bleedMm: z.number().min(0).max(20),
  safetyMarginMm: z.number().min(0).max(50),
  pageCount: z.number().int().positive().max(5000).nullable(),
  paperType: z.string().trim().max(120).nullable(),
  spineFormula: z.enum(['mm_per_page', 'pages_per_inch', 'fixed']),
  spineFactor: z.number().positive().nullable(),
  title: z.string().trim().max(200),
  subtitle: z.string().trim().max(300).nullable(),
  author: z.string().trim().max(200),
  seriesName: z.string().trim().max(200).nullable(),
  backDescription: z.string().trim().max(3000).nullable(),
  biography: z.string().trim().max(2000).nullable(),
  isbn: z.string().trim().max(20).nullable(),
  price: z.number().min(0).max(100000).nullable(),
});

export type CoverInput = z.infer<typeof coverSchema>;

export async function saveCover(input: CoverInput): Promise<VisualActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = coverSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  // L'ISBN viene validato subito: un codice a barre sbagliato stampato non si
  // corregge.
  if (parsed.data.isbn) {
    const barcode = buildIsbnBarcode(parsed.data.isbn);
    if (!barcode.ok) return { ok: false, message: barcode.reason };
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', parsed.data.projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const { calculateSpine } = await import('@/lib/cover/spine');
  let spineWidthMm: number | null = null;

  if (parsed.data.pageCount && parsed.data.spineFactor) {
    const esito = calculateSpine({
      formula: parsed.data.spineFormula,
      factor: parsed.data.spineFactor,
      pageCount: parsed.data.pageCount,
      coverThicknessMm: 0,
    });
    if (!esito.ok) return { ok: false, message: esito.reason };
    spineWidthMm = esito.spineMm;
  }

  const record = {
    project_id: parsed.data.projectId,
    organization_id: organization.id,
    trim_width_mm: parsed.data.trimWidthMm,
    trim_height_mm: parsed.data.trimHeightMm,
    bleed_mm: parsed.data.bleedMm,
    safety_margin_mm: parsed.data.safetyMarginMm,
    page_count: parsed.data.pageCount,
    paper_type: parsed.data.paperType,
    spine_formula: parsed.data.spineFormula,
    spine_factor: parsed.data.spineFactor,
    spine_width_mm: spineWidthMm,
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    author: parsed.data.author,
    series_name: parsed.data.seriesName,
    back_description: parsed.data.backDescription,
    biography: parsed.data.biography,
    isbn: parsed.data.isbn ? parsed.data.isbn.replace(/[\s-]/g, '') : null,
    price: parsed.data.price,
    created_by: user.id,
  };

  const { data: esistente } = await supabase
    .from('cover_projects')
    .select('id')
    .eq('project_id', parsed.data.projectId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { error } = esistente
    ? await supabase.from('cover_projects').update(record).eq('id', esistente.id)
    : await supabase.from('cover_projects').insert(record);

  if (error) return { ok: false, message: `Salvataggio non riuscito: ${error.message}` };

  revalidatePath(`/projects/${parsed.data.projectId}/cover-studio`);

  return {
    ok: true,
    message: spineWidthMm
      ? `Copertina salvata. Dorso calcolato: ${spineWidthMm} mm.`
      : 'Copertina salvata. Il dorso resta da calcolare: serve il numero definitivo di pagine.',
  };
}
