import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface AssetRow {
  id: string;
  chapter_id: string | null;
  kind: string;
  generator: string;
  status: string;
  version: number;
  parent_asset_id: string | null;
  title: string | null;
  caption: string | null;
  alt_text: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  provider: string | null;
  model: string | null;
  seed: number | null;
  width: number | null;
  height: number | null;
  style: string | null;
  mermaid_source: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  cost_usd: number;
  created_at: string;
  approved_at: string | null;
  visual_role: 'concept' | 'procedure' | 'result' | null;
  capture_source: 'generated' | 'uploaded' | 'ui_capture' | null;
  quality_metadata: Record<string, unknown>;
}

export async function listProjectAssets(projectId: string): Promise<AssetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('visual_assets')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .returns<AssetRow[]>();

  if (error) throw new Error(`Lettura degli asset fallita: ${error.message}`);
  return data ?? [];
}

/** Un URL firmato per ogni asset con un file: i bucket sono privati. */
export async function signAssetUrls(assets: AssetRow[]): Promise<Map<string, string>> {
  const supabase = await createClient();
  const urls = new Map<string, string>();

  const conFile = assets.filter((asset) => asset.storage_path !== null);
  if (conFile.length === 0) return urls;

  const perBucket = new Map<string, AssetRow[]>();
  for (const asset of conFile) {
    const bucket = asset.storage_bucket ?? 'generated-assets';
    perBucket.set(bucket, [...(perBucket.get(bucket) ?? []), asset]);
  }

  for (const [bucket, elenco] of perBucket) {
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrls(elenco.map((a) => a.storage_path!), 300);

    for (const [index, firmato] of (data ?? []).entries()) {
      const asset = elenco[index];
      if (asset && firmato?.signedUrl) urls.set(asset.id, firmato.signedUrl);
    }
  }

  return urls;
}

export interface CoverRow {
  id: string;
  trim_width_mm: number;
  trim_height_mm: number;
  bleed_mm: number;
  safety_margin_mm: number;
  page_count: number | null;
  paper_type: string | null;
  spine_formula: 'mm_per_page' | 'pages_per_inch' | 'fixed';
  spine_factor: number | null;
  spine_width_mm: number | null;
  spine_locked: boolean;
  title: string;
  subtitle: string | null;
  author: string;
  series_name: string | null;
  back_description: string | null;
  biography: string | null;
  isbn: string | null;
  price: number | null;
  currency: string;
  front_asset_id: string | null;
  spine_asset_id: string | null;
  back_asset_id: string | null;
  title_line_1: string | null;
  title_line_2: string | null;
  front_description: string | null;
  accent_color: string | null;
  accent_color_secondary: string | null;
  tool_name: string | null;
  composition: Record<string, unknown> | null;
}

export async function getCover(projectId: string): Promise<CoverRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('cover_projects')
    .select('*')
    .eq('project_id', projectId)
    .limit(1)
    .maybeSingle<CoverRow>();

  if (error) throw new Error(`Lettura della copertina fallita: ${error.message}`);
  return data;
}

export interface CoverDefaults {
  title: string;
  subtitle: string | null;
  author: string;
  seriesName: string | null;
  volumeLabel: string | null;
}

/** Il volume della collana è la fonte più specifica per i testi di copertina. */
export async function getCoverDefaults(projectId: string, volumeId?: string): Promise<CoverDefaults> {
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('title, subtitle, author')
    .eq('id', projectId)
    .maybeSingle<{ title: string; subtitle: string | null; author: string }>();
  if (projectError || !project) throw new Error(`Lettura dei dati di copertina fallita: ${projectError?.message ?? ''}`);

  let volumeQuery = supabase
    .from('project_volumes')
    .select('id, title, subtitle, volume_number')
    .eq('project_id', projectId);
  if (volumeId) volumeQuery = volumeQuery.eq('id', volumeId);
  const { data: volume } = await volumeQuery
    .order('volume_number')
    .limit(1)
    .maybeSingle<{
      id: string;
      title: string;
      subtitle: string | null;
      volume_number: number;
    }>();

  return {
    title: volume?.title || project.title,
    subtitle: volume?.subtitle ?? project.subtitle,
    author: project.author,
    seriesName: null,
    volumeLabel: volume ? `VOLUME ${volume.volume_number}` : null,
  };
}

export interface StyleGuideRow {
  id: string;
  name: string;
  version: number;
  tone: string | null;
  terminology: Record<string, string>;
  rules: Record<string, unknown>;
  palette: Record<string, string>;
  is_default: boolean;
}

export async function getStyleGuide(projectId: string): Promise<StyleGuideRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('style_guides')
    .select('id, name, version, tone, terminology, rules, palette, is_default')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<StyleGuideRow>();

  if (error) throw new Error(`Lettura della guida di stile fallita: ${error.message}`);
  return data;
}

/** Le grafiche della copertina, già corredate del collegamento firmato. */
export interface CoverArtworkRow {
  asset: AssetRow;
  /** Nullo quando il file non è raggiungibile: la scheda lo dichiara. */
  signedUrl: string | null;
}

function localAssetUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/visual-assets/${encodeURIComponent(assetId)}`;
}

export async function listCoverArtwork(projectId: string): Promise<CoverArtworkRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('visual_assets')
    .select('*')
    .eq('project_id', projectId)
    .in('kind', ['cover_front', 'cover_spine', 'cover_back'])
    .neq('status', 'superseded')
    .order('version', { ascending: false })
    .returns<AssetRow[]>();

  if (error) throw new Error(`Lettura delle grafiche di copertina fallita: ${error.message}`);

  return (data ?? []).map((asset) => ({
    asset,
    signedUrl: asset.storage_path ? localAssetUrl(projectId, asset.id) : null,
  }));
}

/**
 * Le immagini caricate come base della generazione.
 *
 * Non sono asset dell'opera e non compaiono fra le figure: vivono accanto alla
 * copertina come materiale di direzione visuale.
 */
export async function listCoverReferences(projectId: string): Promise<CoverArtworkRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('visual_assets')
    .select('*')
    .eq('project_id', projectId)
    .eq('kind', 'photo')
    .eq('generator', 'upload')
    .order('created_at', { ascending: true })
    .returns<AssetRow[]>();

  if (error) throw new Error(`Lettura dei riferimenti fallita: ${error.message}`);

  return (data ?? []).map((asset) => ({
    asset,
    signedUrl: asset.storage_path ? localAssetUrl(projectId, asset.id) : null,
  }));
}

/**
 * Il logo dello strumento oggetto del progetto.
 *
 * Uno solo: se ne esistesse più d'uno vincerebbe il più recente, ma il
 * caricamento sostituisce il precedente proprio per non arrivare mai qui a
 * dover scegliere.
 */
export async function getToolLogo(projectId: string): Promise<CoverArtworkRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('visual_assets')
    .select('*')
    .eq('project_id', projectId)
    .eq('generator', 'upload')
    .order('created_at', { ascending: false })
    .returns<AssetRow[]>();

  if (error) throw new Error(`Lettura del logo fallita: ${error.message}`);
  const logo = (data ?? []).find(isToolLogoAsset);
  if (!logo) return null;
  if (!logo.storage_path) return { asset: logo, signedUrl: null };

  return { asset: logo, signedUrl: localAssetUrl(projectId, logo.id) };
}

/**
 * Il logo come `data:` URI, incorporabile.
 *
 * Un URL firmato scade dopo un'ora: dentro un'anteprima che si guarda subito
 * va benissimo, dentro un file che l'autore scarica e ricarica altrove diventa
 * un riquadro vuoto la mattina dopo. Per ciò che esce dall'applicazione il
 * logo viaggia dentro l'immagine.
 */
export async function getToolLogoDataUrl(projectId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('visual_assets')
    .select('kind, storage_bucket, storage_path')
    .eq('project_id', projectId)
    .eq('generator', 'upload')
    .order('created_at', { ascending: false })
    .returns<{ kind: string; storage_bucket: string | null; storage_path: string | null }[]>();

  if (error) throw new Error(`Lettura del logo fallita: ${error.message}`);
  const logo = (data ?? []).find(isToolLogoAsset);
  if (!logo?.storage_path) return null;

  const { data: file } = await supabase.storage
    .from(logo.storage_bucket ?? 'generated-assets')
    .download(logo.storage_path);

  if (!file) return null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function isToolLogoAsset(asset: { kind: string; storage_path: string | null }): boolean {
  return asset.kind === 'logo' || asset.storage_path?.includes('/tool-logo/') === true;
}
