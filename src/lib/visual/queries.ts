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

  // Le firme scadono: si generano alla richiesta, non si conservano.
  return Promise.all(
    (data ?? []).map(async (asset) => {
      if (!asset.storage_path) return { asset, signedUrl: null };
      // Un'ora invece di cinque minuti: l'anteprima resta aperta mentre si
      // confrontano le proposte, e un'immagine che sparisce a metà scelta
      // sembrerebbe un guasto.
      const { data: firmato } = await supabase.storage
        .from(asset.storage_bucket ?? 'generated-assets')
        .createSignedUrl(asset.storage_path, 3600);
      return { asset, signedUrl: firmato?.signedUrl ?? null };
    }),
  );
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

  return Promise.all(
    (data ?? []).map(async (asset) => {
      if (!asset.storage_path) return { asset, signedUrl: null };
      const { data: firmato } = await supabase.storage
        .from(asset.storage_bucket ?? 'generated-assets')
        .createSignedUrl(asset.storage_path, 3600);
      return { asset, signedUrl: firmato?.signedUrl ?? null };
    }),
  );
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
    .eq('kind', 'logo')
    .eq('generator', 'upload')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<AssetRow>();

  if (error) throw new Error(`Lettura del logo fallita: ${error.message}`);
  if (!data) return null;
  if (!data.storage_path) return { asset: data, signedUrl: null };

  const { data: firmato } = await supabase.storage
    .from(data.storage_bucket ?? 'generated-assets')
    .createSignedUrl(data.storage_path, 3600);

  return { asset: data, signedUrl: firmato?.signedUrl ?? null };
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

  const { data } = await supabase
    .from('visual_assets')
    .select('storage_bucket, storage_path')
    .eq('project_id', projectId)
    .eq('kind', 'logo')
    .eq('generator', 'upload')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null }>();

  if (!data?.storage_path) return null;

  const { data: file } = await supabase.storage
    .from(data.storage_bucket ?? 'generated-assets')
    .download(data.storage_path);

  if (!file) return null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
