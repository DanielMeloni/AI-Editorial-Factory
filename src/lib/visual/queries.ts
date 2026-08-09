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
