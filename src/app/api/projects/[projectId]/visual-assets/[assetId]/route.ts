import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';

export const dynamic = 'force-dynamic';

const BUCKET_CONSENTITI = new Set(['generated-assets']);

/** Consegna un asset privato dalla stessa origine dell'applicazione. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
  const { projectId, assetId } = await params;
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('visual_assets')
    .select('id, project_id, organization_id, storage_bucket, storage_path')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .maybeSingle<{
      id: string;
      project_id: string;
      organization_id: string;
      storage_bucket: string | null;
      storage_path: string | null;
    }>();

  if (!asset || asset.organization_id !== organization.id || !asset.storage_path) {
    return NextResponse.json({ error: 'Immagine non trovata.' }, { status: 404 });
  }

  const bucket = asset.storage_bucket ?? 'generated-assets';
  if (!BUCKET_CONSENTITI.has(bucket)) {
    return NextResponse.json({ error: 'Archivio dell’immagine non consentito.' }, { status: 400 });
  }

  const { data: file, error } = await supabase.storage.from(bucket).download(asset.storage_path);
  if (error || !file) {
    return NextResponse.json({ error: 'File dell’immagine non disponibile.' }, { status: 404 });
  }

  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      'Content-Type': file.type || 'image/png',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
