import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { composeVolume, etichettaCapitolo } from './volume';
import { exportVolumePdf, exportVolumePdfLineare, type VolumeFigure } from './pdf';

/**
 * Anteprima del volume in PDF.
 *
 * Vive in un file solo, con il client passato da fuori, perché due strade
 * diversissime devono produrre lo stesso identico documento: il passaggio
 * finale del workflow, che gira con il service role, e il pulsante di
 * ricostruzione manuale, che gira con i permessi di chi lo preme. Se ognuna
 * componesse a modo suo, l'anteprima cambierebbe a seconda di chi l'ha chiesta.
 *
 * Il file è sempre lo stesso — `anteprima.pdf`, sovrascritto — e non si accumula
 * una versione per ogni capitolo approvato: qui la storia è già conservata dalle
 * versioni dei capitoli, e trenta PDF quasi identici non aggiungerebbero nulla
 * se non spazio occupato.
 */

export interface EsitoAnteprima {
  ok: boolean;
  message: string;
  storagePath?: string;
  chapters?: number;
  words?: number;
}

export async function rebuildVolumePreviewWith(
  supabase: SupabaseClient,
  input: { projectId: string; organizationId: string; actorId: string | null },
): Promise<EsitoAnteprima> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, subtitle, author, volume')
    .eq('id', input.projectId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      title: string;
      subtitle: string | null;
      author: string;
      volume: string | null;
    }>();

  if (!project || project.organization_id !== input.organizationId) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const [{ data: volumeConfigurato }, marchio, copertine] = await Promise.all([
    supabase
      .from('project_volumes')
      .select('title, subtitle, volume_number')
      .eq('project_id', input.projectId)
      .order('volume_number', { ascending: true })
      .limit(1)
      .maybeSingle<{ title: string; subtitle: string | null; volume_number: number }>(),
    raccogliLogoStrumento(supabase, input.projectId, project.title),
    raccogliCopertine(supabase, input.projectId),
  ]);

  const volume = await composeVolume(supabase, input.projectId);
  const figurePerCapitolo = await raccogliFigure(
    supabase,
    volume.chapters.map((capitolo) => capitolo.id),
  );

  const capitoliPdf = volume.chapters.map((capitolo) => ({
    label: etichettaCapitolo(capitolo),
    title: capitolo.title,
    contentMd: normalizzaMarkdownPdf(capitolo.contentMd),
    versionNo: capitolo.versionNo,
    approved: capitolo.approvato,
    figures: figurePerCapitolo.get(capitolo.id) ?? [],
    partId: capitolo.partId,
    partNumber: capitolo.partNumber,
    partTitle: capitolo.partTitle,
  }));
  const metaPdf = {
    projectTitle: project.title,
    volumeTitle: volumeConfigurato?.title ?? project.title,
    subtitle: volumeConfigurato?.subtitle ?? project.subtitle,
    author: project.author,
    volume: project.volume,
    toolLogoDataUrl: marchio.dataUrl,
    frontCoverDataUrl: copertine.front,
    backCoverDataUrl: copertine.back,
    accentColor: marchio.accentColor,
    generatedAt: new Date().toLocaleString('it-IT'),
    pending: volume.pending.length,
    drafts: volume.chapters.filter((capitolo) => !capitolo.approvato).length,
  };

  let bytes: Uint8Array;
  let contenutiProblematiciEsclusi = false;
  try {
    bytes = await exportVolumePdf(capitoliPdf, metaPdf);
  } catch (error) {
    // Oltre ai raster corrotti, blocchi Mermaid/codice molto lunghi possono
    // produrre coordinate fuori scala in Yoga/PDFKit. Il secondo tentativo
    // isola tutte le figure e rende interrompibili i token del Markdown.
    if (!isErroreGraficoPdf(error)) {
      throw error;
    }
    contenutiProblematiciEsclusi = true;
    const capitoliNormalizzati = capitoliPdf.map((capitolo) => ({
      ...capitolo,
      contentMd: normalizzaMarkdownPdf(capitolo.contentMd),
      figures: [],
    }));
    try {
      bytes = await exportVolumePdf(capitoliNormalizzati, metaPdf);
    } catch (fallbackError) {
      if (!isErroreGraficoPdf(fallbackError)) throw fallbackError;
      bytes = await exportVolumePdfLineare(capitoliNormalizzati, metaPdf);
    }
  }

  const storagePath = `${input.organizationId}/${input.projectId}/volume/anteprima.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('publication-exports')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    return {
      ok: false,
      message: `Salvataggio dell’anteprima non riuscito: ${uploadError.message}`,
    };
  }

  const checksum = await sha256Hex(bytes);
  const adesso = new Date().toISOString();

  // Una riga sola per progetto: l'anteprima è uno stato, non una collezione di
  // esportazioni. Le esportazioni definitive restano quelle della scheda Export.
  const { data: esistente } = await supabase
    .from('exports')
    .select('id')
    .eq('project_id', input.projectId)
    .is('chapter_id', null)
    .eq('format', 'pdf')
    .limit(1)
    .maybeSingle<{ id: string }>();

  const riga = {
    project_id: input.projectId,
    organization_id: input.organizationId,
    chapter_id: null,
    format: 'pdf' as const,
    status: 'ready' as const,
    storage_bucket: 'publication-exports',
    storage_path: storagePath,
    byte_size: bytes.byteLength,
    checksum,
    error: null,
    requested_by: input.actorId,
    completed_at: adesso,
  };

  const { error: exportError } = esistente
    ? await supabase.from('exports').update(riga).eq('id', esistente.id)
    : await supabase.from('exports').insert({ ...riga, requested_at: adesso });
  if (exportError) {
    return {
      ok: false,
      message: `Registrazione dell’anteprima non riuscita: ${exportError.message}`,
    };
  }

  return {
    ok: true,
    storagePath,
    chapters: volume.totals.chapters,
    words: volume.totals.words,
    message:
      volume.totals.chapters === 0
        ? 'Anteprima aggiornata: nessun capitolo scritto, per ora.'
        : `Anteprima aggiornata: ${volume.totals.chapters} capitoli, ` +
          `${volume.totals.words.toLocaleString('it-IT')} parole` +
          `${
            volume.chapters.filter((capitolo) => !capitolo.approvato).length > 0
              ? `, di cui ${volume.chapters.filter((c) => !c.approvato).length} in bozza`
              : ''
          }${contenutiProblematiciEsclusi ? '. Figure o blocchi fuori scala sono stati isolati dal PDF' : ''}.`,
  };
}

async function raccogliCopertine(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ front: string | null; back: string | null }> {
  const { data: cover } = await supabase
    .from('cover_projects')
    .select('front_asset_id, back_asset_id, updated_at')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ front_asset_id: string | null; back_asset_id: string | null; updated_at: string }>();
  const ids = [cover?.front_asset_id, cover?.back_asset_id].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { front: null, back: null };
  const { data: assets } = await supabase
    .from('visual_assets')
    .select('id, storage_bucket, storage_path')
    .in('id', ids)
    .returns<{ id: string; storage_bucket: string | null; storage_path: string | null }[]>();

  const incorpora = async (assetId: string | null | undefined): Promise<string | null> => {
    const asset = (assets ?? []).find((voce) => voce.id === assetId);
    if (!asset?.storage_path) return null;
    const { data: file } = await supabase.storage
      .from(asset.storage_bucket ?? 'generated-assets')
      .download(asset.storage_path);
    return file ? rasterDataUrlSicuro(Buffer.from(await file.arrayBuffer())) : null;
  };
  const [front, back] = await Promise.all([incorpora(cover?.front_asset_id), incorpora(cover?.back_asset_id)]);
  return { front, back };
}

async function raccogliLogoStrumento(
  supabase: SupabaseClient,
  projectId: string,
  projectTitle: string,
): Promise<{ dataUrl: string | null; accentColor: string }> {
  const { data: risorse } = await supabase
    .from('visual_assets')
    .select('kind, title, storage_bucket, storage_path, created_at')
    .eq('project_id', projectId)
    .eq('generator', 'upload')
    .order('created_at', { ascending: false })
    .returns<{
      kind: string;
      title: string | null;
      storage_bucket: string | null;
      storage_path: string | null;
      created_at: string;
    }[]>();

  const logo = (risorse ?? []).find(
    (asset) => asset.kind === 'logo' || asset.storage_path?.includes('/tool-logo/'),
  );
  const identita = `${projectTitle} ${logo?.title ?? ''} ${logo?.storage_path ?? ''}`.toLowerCase();
  const accentColor = identita.includes('databricks')
    ? '#ff5f46'
    : identita.includes('dataform') || identita.includes('google') || identita.includes('bigquery')
      ? '#4285f4'
      : '#2f7df6';

  if (!logo?.storage_path) return { dataUrl: null, accentColor };
  const { data: file } = await supabase.storage
    .from(logo.storage_bucket ?? 'generated-assets')
    .download(logo.storage_path);
  if (!file) return { dataUrl: null, accentColor };
  return { dataUrl: rasterDataUrlSicuro(Buffer.from(await file.arrayBuffer())), accentColor };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Le figure approvate di ogni capitolo, pronte per il PDF.
 *
 * Le immagini vere vengono scaricate e incorporate come dati: un collegamento
 * firmato scadrebbe, e un PDF che dopo un'ora mostra riquadri vuoti non è un
 * documento, è una promessa scaduta.
 *
 * I diagrammi restano sorgente Mermaid: disegnarli richiederebbe un browser, e
 * questo generatore esiste proprio per non averne bisogno.
 */
async function raccogliFigure(
  supabase: SupabaseClient,
  chapterIds: string[],
): Promise<Map<string, VolumeFigure[]>> {
  const perCapitolo = new Map<string, VolumeFigure[]>();
  if (chapterIds.length === 0) return perCapitolo;

  const { data: assets } = await supabase
    .from('visual_assets')
    .select(
      'chapter_id, title, caption, alt_text, mermaid_source, storage_bucket, storage_path, version, status',
    )
    .in('chapter_id', chapterIds)
    // L'anteprima è uno spazio di lavoro: mostra anche l'ultima figura in
    // revisione del capitolo. Restano fuori soltanto gli asset rifiutati.
    .neq('status', 'rejected')
    .order('version', { ascending: false })
    .returns<
      {
        chapter_id: string | null;
        title: string | null;
        caption: string | null;
        alt_text: string | null;
        mermaid_source: string | null;
        storage_bucket: string | null;
        storage_path: string | null;
        version: number;
        status: string;
      }[]
    >();

  for (const asset of assets ?? []) {
    if (!asset.chapter_id) continue;

    let dataUrl: string | null = null;
    let unavailableReason: string | null = null;
    if (asset.storage_path) {
      const { data: file } = await supabase.storage
        .from(asset.storage_bucket ?? 'generated-assets')
        .download(asset.storage_path);
      if (file) {
        const contenuto = Buffer.from(await file.arrayBuffer());
        dataUrl = rasterDataUrlSicuro(contenuto);
        if (!dataUrl) {
          unavailableReason = 'IMMAGINE NON INCORPORATA — il PDF supporta asset PNG e JPEG validi';
        }
      }
    }

    const elenco = perCapitolo.get(asset.chapter_id) ?? [];
    elenco.push({
      title: asset.title,
      caption: asset.caption,
      altText: asset.alt_text,
      dataUrl,
      mermaidSource: asset.mermaid_source,
      unavailableReason,
    });
    perCapitolo.set(asset.chapter_id, elenco);
  }

  return perCapitolo;
}

/** Non fidarsi del MIME dichiarato: Storage può restituire SVG/WebP come PNG. */
export function rasterDataUrlSicuro(bytes: Uint8Array): string | null {
  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) return null;
  return `data:${png ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`;
}

function isErroreGraficoPdf(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported number|invalid image|unsupported image|image data|png|jpe?g/i.test(message);
}

function normalizzaMarkdownPdf(markdown: string): string {
  return markdown
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\S{72,}/g, (token) => token.match(/.{1,48}/g)?.join('\u200b') ?? token);
}
