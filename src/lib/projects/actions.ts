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
    volume: formData.get('volume') ?? '',
    language: formData.get('language') ?? 'it',
    description: formData.get('description') ?? '',
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
      volume: parsed.data.volume || null,
      language: parsed.data.language,
      description: parsed.data.description || null,
      created_by: user.id,
    })
    .select('id')
    .single<Pick<ProjectRow, 'id'>>();

  if (error || !data) {
    return {
      status: 'error',
      message: 'Creazione del progetto non riuscita. Riprova.',
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
