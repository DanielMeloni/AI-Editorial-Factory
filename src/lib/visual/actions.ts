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

  // Per le grafiche di copertina l'approvazione è anche la messa in opera:
  // approvare una copertina che poi resta da agganciare a mano sarebbe una
  // decisione presa e non applicata.
  const SLOT: Record<string, string> = {
    cover_front: 'front_asset_id',
    cover_spine: 'spine_asset_id',
    cover_back: 'back_asset_id',
  };
  const slot = SLOT[asset.kind];

  if (decision === 'approved' && slot) {
    await supabase
      .from('visual_assets')
      .update({ status: 'superseded' })
      .eq('project_id', asset.project_id)
      .eq('kind', asset.kind)
      .eq('status', 'approved')
      .neq('id', assetId);

    const { data: cover } = await supabase
      .from('cover_projects')
      .select('id')
      .eq('project_id', asset.project_id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (cover) {
      await supabase.from('cover_projects').update({ [slot]: assetId }).eq('id', cover.id);
    }
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: `visual.${decision}`,
    entityType: 'visual_asset',
    entityId: assetId,
  });

  revalidatePath(`/projects/${asset.project_id}/visual-studio`);
  revalidatePath(`/projects/${asset.project_id}/cover-studio`);

  return {
    ok: true,
    message:
      decision === 'approved'
        ? slot
          ? 'Grafica approvata e applicata alla copertina.'
          : 'Asset approvato.'
        : 'Asset rifiutato.',
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

// ---------------------------------------------------------------------------
// Grafica di copertina
// ---------------------------------------------------------------------------

const PARTI = [
  {
    kind: 'cover_front' as const,
    campo: 'front_asset_id' as const,
    etichetta: 'fronte',
    /** Il fronte è ciò che si vede in vetrina: immagine sola, senza testo. */
    intento:
      'Immagine di copertina per un manuale tecnico. Composizione verticale, ' +
      'soggetto centrale forte, ampio spazio libero nella metà superiore dove verranno ' +
      'composti titolo e sottotitolo.',
  },
  {
    kind: 'cover_spine' as const,
    campo: 'spine_asset_id' as const,
    etichetta: 'dorso',
    intento:
      'Texture verticale continua per il dorso di un libro: motivo uniforme, senza ' +
      'soggetti riconoscibili, che regga un ritaglio molto stretto senza perdere senso.',
  },
  {
    kind: 'cover_back' as const,
    campo: 'back_asset_id' as const,
    etichetta: 'quarta',
    intento:
      'Sfondo per la quarta di copertina: variazione più quieta e scura della stessa ' +
      'immagine di fronte, con ampie superfici uniformi su cui il testo resti leggibile.',
  },
];

/**
 * Genera le tre grafiche della copertina — fronte, dorso, quarta.
 *
 * Le tre parti nascono da una direzione visuale comune, così che sulle pieghe
 * non si veda uno stacco. Nessuna di esse contiene testo: titolo, autore e
 * codice a barre appartengono all'impaginato, che li compone in tipografia
 * reale sopra l'immagine. Un titolo disegnato dal modello sarebbe illeggibile
 * in stampa e impossibile da correggere.
 *
 * Le tre immagini nascono in attesa di approvazione, come ogni altro asset.
 */
export async function generateCoverArtwork(projectId: string): Promise<VisualActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  if (!z.string().uuid().safeParse(projectId).success) {
    return { ok: false, message: 'Progetto non valido.' };
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, subtitle, description')
    .eq('id', projectId)
    .maybeSingle<{
      id: string; organization_id: string; title: string;
      subtitle: string | null; description: string | null;
    }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const { data: cover } = await supabase
    .from('cover_projects')
    .select('id, trim_width_mm, trim_height_mm, spine_width_mm, title, subtitle, back_description, series_name')
    .eq('project_id', projectId)
    .limit(1)
    .maybeSingle<{
      id: string; trim_width_mm: number; trim_height_mm: number; spine_width_mm: number | null;
      title: string; subtitle: string | null; back_description: string | null; series_name: string | null;
    }>();

  // Le tre grafiche si agganciano alla copertina: senza, non avrebbero dove
  // essere registrate e resterebbero asset sciolti.
  if (!cover) {
    return {
      ok: false,
      message: 'Salva prima la copertina: le grafiche si agganciano alle sue specifiche.',
    };
  }

  const limite = await checkRateLimit(supabase, 'imageGeneration', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  const { provider, degraded } = getImageProvider();
  // I riferimenti visivi caricati dall'autore sono la base della generazione:
  // senza, ogni esecuzione ripartirebbe da una direzione visuale diversa.
  const { data: riferimenti } = await supabase
    .from('visual_assets')
    .select('storage_bucket, storage_path')
    .eq('project_id', projectId)
    .eq('kind', 'photo')
    .eq('generator', 'upload')
    .order('created_at', { ascending: true })
    .limit(8)
    .returns<{ storage_bucket: string | null; storage_path: string | null }[]>();

  const basi: { bytes: Uint8Array; mimeType: string }[] = [];
  for (const riferimento of riferimenti ?? []) {
    if (!riferimento.storage_path) continue;
    const { data: file } = await supabase.storage
      .from(riferimento.storage_bucket ?? 'generated-assets')
      .download(riferimento.storage_path);
    if (!file) continue;
    basi.push({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || 'image/png',
    });
  }

  // La direzione visuale è unica per le tre parti: è ciò che le tiene insieme
  // quando il libro viene chiuso.
  const soggetto = [
    `Manuale tecnico intitolato «${cover.title || project.title}».`,
    cover.subtitle || project.subtitle ? `Sottotitolo: ${cover.subtitle ?? project.subtitle}.` : '',
    project.description ? `Argomento: ${project.description.slice(0, 600)}.` : '',
    cover.series_name ? `Collana: ${cover.series_name}.` : '',
    'Registro sobrio e professionale, astratto o schematico, adatto a un lettore tecnico. ',
    'Palette coerente fra le tre parti.',
  ]
    .filter(Boolean)
    .join(' ');

  const avvisi: string[] = degraded ? [degraded] : [];
  const generati: { assetId: string; campo: string }[] = [];
  let costo = 0;

  for (const parte of PARTI) {
    const larghezzaMm =
      parte.kind === 'cover_spine' ? (cover.spine_width_mm ?? 10) : cover.trim_width_mm;

    let immagine;
    try {
      immagine = await provider.generate({
        prompt: `${parte.intento}\n\n${soggetto}`,
        width: Math.round(larghezzaMm * 12),
        height: Math.round(cover.trim_height_mm * 12),
        references: basi,
      });
    } catch (error) {
      // Ciò che è già stato generato resta: non si butta via lavoro pagato.
      const motivo = (error as Error).message;
      return {
        ok: generati.length > 0,
        message:
          generati.length > 0
            ? `Generate ${generati.length} grafiche su ${PARTI.length}; il ${parte.etichetta} è fallito: ${motivo}`
            : `Generazione del ${parte.etichetta} non riuscita: ${motivo}`,
      };
    }

    avvisi.push(...immagine.warnings.map((avviso) => `${parte.etichetta}: ${avviso}`));
    costo += immagine.estimatedCostUsd;

    const { data: precedente } = await supabase
      .from('visual_assets')
      .select('version')
      .eq('project_id', projectId)
      .eq('kind', parte.kind)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ version: number }>();

    const version = (precedente?.version ?? 0) + 1;
    const assetId = crypto.randomUUID();
    const storagePath = `${organization.id}/${projectId}/cover/${assetId}.png`;

    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(storagePath, immagine.bytes, { contentType: immagine.mimeType, upsert: false });

    if (uploadError) {
      return { ok: false, message: `Salvataggio del ${parte.etichetta} non riuscito: ${uploadError.message}` };
    }

    const { error: insertError } = await supabase.from('visual_assets').insert({
      id: assetId,
      project_id: projectId,
      organization_id: organization.id,
      chapter_id: null,
      kind: parte.kind,
      generator: 'ai',
      status: 'pending_approval',
      version,
      title: `Copertina — ${parte.etichetta}`,
      caption: `Grafica del ${parte.etichetta}, v${version}.`,
      alt_text: `Grafica astratta per il ${parte.etichetta} della copertina di «${cover.title || project.title}», senza testo.`,
      prompt: `${parte.intento}\n\n${soggetto}`,
      provider: immagine.provider,
      model: immagine.model,
      seed: immagine.seed,
      width: immagine.width,
      height: immagine.height,
      storage_bucket: 'generated-assets',
      storage_path: storagePath,
      cost_usd: immagine.estimatedCostUsd,
      created_by: user.id,
    });

    if (insertError) {
      await supabase.storage.from('generated-assets').remove([storagePath]);
      return { ok: false, message: `Registrazione del ${parte.etichetta} non riuscita.` };
    }

    generati.push({ assetId, campo: parte.campo });
  }

  // La generazione propone e basta: l'aggancio alla copertina avviene
  // all'approvazione, che è il momento in cui una persona ha guardato.
  // Generare non è scegliere.

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'cover.artwork_generated',
    entityType: 'cover_project',
    entityId: cover.id,
    metadata: { provider: provider.name, model: provider.model, parti: generati.length, costo },
  });

  revalidatePath(`/projects/${projectId}/cover-studio`);

  return {
    ok: true,
    assetId: generati[0]?.assetId,
    message: [
      `Tre grafiche proposte${basi.length > 0 ? ` da ${basi.length} riferiment${basi.length === 1 ? 'o' : 'i'}` : ' senza riferimenti visivi'} (${costo > 0 ? `$${costo.toFixed(4)}` : 'costo non stimato'}): selezionale per vederle in anteprima, approvale per applicarle.`,
      ...avvisi,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// Riferimenti visivi della copertina
// ---------------------------------------------------------------------------

const MIME_RIFERIMENTO = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTE_RIFERIMENTO = 10 * 1024 * 1024;

export interface CoverReferenceTicket {
  ok: true;
  assetId: string;
  bucket: string;
  path: string;
  token: string;
}

/**
 * Prepara il caricamento di un'immagine di riferimento.
 *
 * Il file non passa dal server applicativo: viene caricato dal browser
 * direttamente su Storage con un URL firmato, come già fanno gli archivi e i
 * PDF della biblioteca. Non è solo una questione di limiti — far transitare
 * dieci megabyte per una Server Action significa occupare il processo che
 * serve le pagine per il tempo del trasferimento.
 *
 * La riga dell'asset non nasce qui: nasce a caricamento avvenuto. Registrarla
 * prima lascerebbe, a ogni caricamento interrotto, un riferimento che punta a
 * un file inesistente.
 */
export async function requestCoverReferenceTicket(input: {
  projectId: string;
  filename: string;
  byteSize: number;
  mimeType: string;
}): Promise<CoverReferenceTicket | { ok: false; message: string }> {
  await requireUser();
  const organization = await requireOrganization();

  if (!z.string().uuid().safeParse(input.projectId).success) {
    return { ok: false, message: 'Progetto non valido.' };
  }
  if (!MIME_RIFERIMENTO.includes(input.mimeType as (typeof MIME_RIFERIMENTO)[number])) {
    return { ok: false, message: 'Formati ammessi: PNG, JPEG, WebP.' };
  }
  if (input.byteSize <= 0 || input.byteSize > MAX_BYTE_RIFERIMENTO) {
    return { ok: false, message: 'L’immagine supera i 10 MB.' };
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', input.projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const assetId = crypto.randomUUID();
  const estensione =
    input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType === 'image/webp' ? 'webp' : 'png';
  const path = `${organization.id}/${input.projectId}/cover-refs/${assetId}.${estensione}`;

  const { data: firmato, error } = await supabase.storage
    .from('generated-assets')
    .createSignedUploadUrl(path);

  if (error || !firmato) {
    return { ok: false, message: 'Impossibile preparare il caricamento. Riprova.' };
  }

  return { ok: true, assetId, bucket: 'generated-assets', path, token: firmato.token };
}

/**
 * Registra il riferimento a caricamento avvenuto.
 *
 * Se la registrazione fallisce il file viene rimosso: un oggetto su Storage che
 * nessuna riga menziona non è raggiungibile da nessuna parte dell'applicazione,
 * e continuerebbe a occupare spazio senza che nulla ne ricordi l'esistenza.
 */
export async function confirmCoverReference(input: {
  projectId: string;
  assetId: string;
  path: string;
  filename: string;
}): Promise<VisualActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  if (!input.path.startsWith(`${organization.id}/${input.projectId}/cover-refs/`)) {
    return { ok: false, message: 'Percorso non valido.' };
  }

  const { error } = await supabase.from('visual_assets').insert({
    id: input.assetId,
    project_id: input.projectId,
    organization_id: organization.id,
    chapter_id: null,
    kind: 'photo',
    generator: 'upload',
    // Nasce approvato perché non finisce nel libro: è materiale di direzione
    // visuale, e chiederne l'approvazione confonderebbe due cose diverse.
    status: 'approved',
    version: 1,
    title: input.filename.slice(0, 200) || 'Riferimento visivo',
    caption: 'Riferimento per la generazione della copertina.',
    alt_text: 'Immagine di riferimento caricata dall’autore.',
    storage_bucket: 'generated-assets',
    storage_path: input.path,
    cost_usd: 0,
    created_by: user.id,
  });

  if (error) {
    await supabase.storage.from('generated-assets').remove([input.path]);
    return { ok: false, message: `Registrazione del riferimento non riuscita: ${error.message}` };
  }

  revalidatePath(`/projects/${input.projectId}/cover-studio`);
  return { ok: true, assetId: input.assetId, message: 'Riferimento caricato.' };
}

/** Rimuove un riferimento visivo, file compreso. */
export async function deleteCoverReference(assetId: string): Promise<VisualActionResult> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('visual_assets')
    .select('id, project_id, organization_id, kind, generator, storage_bucket, storage_path')
    .eq('id', assetId)
    .maybeSingle<{
      id: string; project_id: string; organization_id: string; kind: string;
      generator: string; storage_bucket: string | null; storage_path: string | null;
    }>();

  if (!asset || asset.organization_id !== organization.id) {
    return { ok: false, message: 'Riferimento non trovato.' };
  }
  // Il vincolo è esplicito: da qui si cancellano i riferimenti, non gli asset
  // dell'opera, che hanno un percorso di approvazione tutto loro.
  if (asset.kind !== 'photo' || asset.generator !== 'upload') {
    return { ok: false, message: 'Questo asset non è un riferimento visivo.' };
  }

  if (asset.storage_path) {
    await supabase.storage
      .from(asset.storage_bucket ?? 'generated-assets')
      .remove([asset.storage_path]);
  }
  await supabase.from('visual_assets').delete().eq('id', assetId);

  revalidatePath(`/projects/${asset.project_id}/cover-studio`);
  return { ok: true, message: 'Riferimento rimosso.' };
}
