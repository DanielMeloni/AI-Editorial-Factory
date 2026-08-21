'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { type ActionState, toFieldErrors } from '@/lib/auth/action-state';
import { createProjectSchema, slugify } from '@/lib/projects/schemas';
import { buildSourceStoragePath, uploadRequestSchema } from '@/lib/sources/upload';
import { recordAudit } from '@/lib/security/audit';
import type { ProjectRow } from '@/lib/db/types';

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = createProjectSchema.safeParse({
    title: formData.get('title'),
    subtitle: formData.get('subtitle') ?? '',
    author: formData.get('author') ?? '',
    volumeCount: formData.get('volumeCount') ?? '1',
    language: formData.get('language') ?? 'it',
    description: formData.get('description') ?? '',
    level: formData.get('level') ?? 'base',
    tone: formData.get('tone') ?? 'didattico',
    register: formData.get('register') ?? 'tecnico_operativo',
    styleNotes: formData.get('styleNotes') ?? '',
    workShape: formData.get('workShape') ?? 'volume_singolo',
    targetPages: formData.get('targetPages') ?? '',
    scope: formData.get('scope') ?? '',
    outOfScope: formData.get('outOfScope') ?? '',
    audience: formData.get('audience') ?? '',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Controlla i campi evidenziati.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const baseSlug = slugify(parsed.data.title) || 'progetto';

  // Lo slug deve essere univoco nell'organizzazione: si tenta con un suffisso
  // progressivo invece di far fallire l'utente su un vincolo del database.
  let slug = baseSlug;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('slug', slug)
      .maybeSingle();

    if (!existing) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: organization.id,
      slug,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle || null,
      author: parsed.data.author || '',
      volume: null,
      language: parsed.data.language,
      description: parsed.data.description || null,
      level: parsed.data.level,
      tone: parsed.data.tone,
      register: parsed.data.register,
      style_notes: parsed.data.styleNotes || null,
      work_shape: parsed.data.workShape,
      target_pages:
        typeof parsed.data.targetPages === 'number' ? parsed.data.targetPages : null,
      scope: parsed.data.scope || null,
      out_of_scope: parsed.data.outOfScope || null,
      audience: parsed.data.audience || null,
      created_by: user.id,
    })
    .select('id')
    .single<Pick<ProjectRow, 'id'>>();

  if (error || !data) {
    // «Riprova» è un consiglio inutile quando la causa è strutturale — una
    // colonna che manca perché una migrazione non è stata applicata non
    // sparisce al secondo tentativo. Il motivo va detto.
    const dettaglio = error?.message ?? 'il database non ha restituito la riga creata';
    const migrazioneMancante = /column .* does not exist|schema cache/i.test(dettaglio);

    return {
      status: 'error',
      message: migrazioneMancante
        ? `Creazione non riuscita: ${dettaglio}. Sembra una migrazione non applicata: esegui «npx supabase db push».`
        : `Creazione non riuscita: ${dettaglio}`,
    };
  }

  // Solo una collana può generare più manuali. Il vincolo vive anche sul
  // server: nascondere il campo nell'interfaccia non sarebbe sufficiente.
  const volumeCount = parsed.data.workShape === 'collana' ? parsed.data.volumeCount : 1;
  const volumes = Array.from({ length: volumeCount }, (_, index) => ({
    project_id: data.id,
    organization_id: organization.id,
    volume_number: index + 1,
    title: parsed.data.title,
    subtitle: parsed.data.subtitle || null,
    level: parsed.data.level,
    audience: parsed.data.audience || null,
    scope: parsed.data.scope || null,
    out_of_scope: parsed.data.outOfScope || null,
    target_pages: typeof parsed.data.targetPages === 'number' ? parsed.data.targetPages : null,
  }));
  const { error: volumeError } = await supabase.from('project_volumes').insert(volumes);
  if (volumeError) {
    await supabase.from('projects').delete().eq('id', data.id);
    return {
      status: 'error',
      message: `Configurazione dei volumi non riuscita: ${volumeError.message}. Applica la migration 20260820120001_project_volumes.sql.`,
    };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'project.created',
    entityType: 'project',
    entityId: data.id,
    metadata: { title: parsed.data.title, slug },
  });

  revalidatePath('/projects');
  redirect(`/projects/${data.id}`);
}

export async function addProjectVolume(formData: FormData): Promise<void> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const projectId = String(formData.get('projectId') ?? '');
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('title, subtitle, language, level, audience, scope, out_of_scope, target_pages')
    .eq('id', projectId).maybeSingle();
  if (!project) return;
  const { data: last } = await supabase.from('project_volumes').select('volume_number')
    .eq('project_id', projectId).order('volume_number', { ascending: false }).limit(1).maybeSingle<{ volume_number: number }>();
  const { error } = await supabase.from('project_volumes').insert({
    project_id: projectId, organization_id: organization.id,
    volume_number: (last?.volume_number ?? 0) + 1, title: project.title,
    subtitle: project.subtitle, level: project.level, audience: project.audience,
    scope: project.scope, out_of_scope: project.out_of_scope, target_pages: project.target_pages,
  });
  if (error) throw new Error(`Creazione del volume fallita: ${error.message}`);
  await recordAudit({ organizationId: organization.id, actorId: user.id, action: 'project.volume.created', entityType: 'project', entityId: projectId });
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectVolume(formData: FormData): Promise<void> {
  await requireUser();
  await requireOrganization();
  const projectId = String(formData.get('projectId') ?? '');
  const volumeId = String(formData.get('volumeId') ?? '');
  const pagesValue = String(formData.get('targetPages') ?? '').trim();
  const supabase = await createClient();
  const { error } = await supabase.from('project_volumes').update({
    title: String(formData.get('title') ?? '').trim(),
    subtitle: String(formData.get('subtitle') ?? '').trim() || null,
    level: String(formData.get('level') ?? 'base'),
    audience: String(formData.get('audience') ?? '').trim() || null,
    scope: String(formData.get('scope') ?? '').trim() || null,
    out_of_scope: String(formData.get('outOfScope') ?? '').trim() || null,
    target_pages: pagesValue ? Number(pagesValue) : null,
  }).eq('id', volumeId).eq('project_id', projectId);
  if (error) throw new Error(`Salvataggio del volume fallito: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export interface UploadTicket {
  ok: true;
  sourceId: string;
  bucket: string;
  path: string;
  token: string;
}

export interface UploadRefusal {
  ok: false;
  message: string;
}

/**
 * Emette un URL firmato per il caricamento diretto su Supabase Storage.
 * Il file non passa mai dal server applicativo.
 */
export async function requestUploadTicket(input: {
  projectId: string;
  filename: string;
  byteSize: number;
  mimeType: string;
}): Promise<UploadTicket | UploadRefusal> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = uploadRequestSchema.safeParse({
    filename: input.filename,
    byteSize: input.byteSize,
    mimeType: input.mimeType,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Richiesta non valida.' };
  }

  const supabase = await createClient();

  // Autorizzazione esplicita: il progetto deve appartenere all'organizzazione.
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', input.projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const sourceId = randomUUID();
  const path = buildSourceStoragePath(organization.id, project.id, sourceId, parsed.data.filename);

  const { data: signed, error: signError } = await supabase.storage
    .from('project-sources')
    .createSignedUploadUrl(path);

  if (signError || !signed) {
    return { ok: false, message: 'Impossibile preparare il caricamento. Riprova.' };
  }

  const { error: insertError } = await supabase.from('project_sources').insert({
    id: sourceId,
    project_id: project.id,
    organization_id: organization.id,
    storage_bucket: 'project-sources',
    storage_path: path,
    original_filename: parsed.data.filename,
    mime_type: parsed.data.mimeType || null,
    byte_size: parsed.data.byteSize,
    status: 'uploaded',
    uploaded_by: user.id,
  });

  if (insertError) {
    return { ok: false, message: 'Registrazione della fonte non riuscita.' };
  }

  return { ok: true, sourceId, bucket: 'project-sources', path, token: signed.token };
}

// ---------------------------------------------------------------------------
// Eliminazione
// ---------------------------------------------------------------------------

/** I bucket che conservano i file di un progetto. */
const BUCKET_PROGETTO = ['project-sources', 'generated-assets', 'publication-exports'] as const;

/**
 * Tutti gli oggetti sotto un prefisso, cartelle comprese.
 *
 * Lo storage non cancella per prefisso: bisogna nominare ogni file. Le voci
 * senza `id` sono cartelle e vanno percorse, non rimosse.
 */
async function elencaOggetti(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bucket: string,
  prefisso: string,
): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(prefisso, { limit: 1000 });
  if (error || !data) return [];

  const percorsi: string[] = [];
  for (const voce of data) {
    const completo = `${prefisso}/${voce.name}`;
    if (voce.id === null) percorsi.push(...(await elencaOggetti(supabase, bucket, completo)));
    else percorsi.push(completo);
  }
  return percorsi;
}

export interface DeleteProjectResult {
  ok: boolean;
  message: string;
}

/**
 * Elimina un progetto e tutto ciò che ne discende.
 *
 * È l'unica operazione irreversibile dell'applicazione, e per questo chiede di
 * scrivere il titolo: un pulsante da solo si preme per sbaglio, un titolo no.
 *
 * L'ordine conta. Prima si registra in audit — dopo la cancellazione non ci
 * sarebbe più nulla da cui ricostruire cosa è successo, e il registro
 * sopravvive perché non ha vincoli verso il progetto. Poi si rimuovono i file,
 * che il database non sa cancellare: la cascata delle chiavi esterne libera le
 * righe ma lascerebbe negli storage byte orfani e a pagamento, senza più
 * nessuna riga che ne ricordi l'esistenza. La riga del progetto va per ultima,
 * così un guasto a metà lascia un progetto ancora visibile e ripulibile invece
 * di file irraggiungibili.
 */
export async function deleteProject(
  projectId: string,
  conferma: string,
): Promise<DeleteProjectResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, slug')
    .eq('id', projectId)
    .maybeSingle<{ id: string; organization_id: string; title: string; slug: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  if (conferma.trim() !== project.title.trim()) {
    return { ok: false, message: 'Il titolo digitato non coincide: eliminazione annullata.' };
  }

  const { count: chapters } = await supabase
    .from('chapters')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id);

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'project.deleted',
    entityType: 'project',
    entityId: project.id,
    metadata: { title: project.title, slug: project.slug, chapters: chapters ?? 0 },
  });

  const prefisso = `${organization.id}/${project.id}`;
  let rimossi = 0;
  const bucketIncompleti: string[] = [];

  for (const bucket of BUCKET_PROGETTO) {
    const oggetti = await elencaOggetti(supabase, bucket, prefisso);
    for (let i = 0; i < oggetti.length; i += 100) {
      const lotto = oggetti.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(lotto);
      if (error) bucketIncompleti.push(bucket);
      else rimossi += lotto.length;
    }
  }

  // La cascata delle chiavi esterne porta via capitoli, versioni, esecuzioni,
  // asset, revisioni ed esportazioni: sono 21 tabelle collegate a `projects`
  // con `on delete cascade`.
  const { error } = await supabase.from('projects').delete().eq('id', project.id);
  if (error) {
    return { ok: false, message: `Eliminazione non riuscita: ${error.message}` };
  }

  revalidatePath('/projects');

  return {
    ok: true,
    message: bucketIncompleti.length
      ? `Progetto eliminato, ma alcuni file non sono stati rimossi da: ${[...new Set(bucketIncompleti)].join(', ')}.`
      : `Progetto eliminato: ${chapters ?? 0} capitoli e ${rimossi} file.`,
  };
}
