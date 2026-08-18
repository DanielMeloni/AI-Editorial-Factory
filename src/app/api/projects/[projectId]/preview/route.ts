import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';

/**
 * Consegna l'anteprima del volume dalla stessa origine dell'applicazione.
 *
 * Un URL firmato di Supabase è cross-origin, e la Content Security Policy di
 * questo progetto chiude i frame a `'self'`: il browser lo bloccherebbe, ed è
 * giusto che lo faccia. La scelta è servire il file da qui invece di allargare
 * la policy — un'eccezione nella CSP varrebbe per qualunque contenuto ospitato
 * su Supabase, mentre questa rotta vale per questo file e per chi ha diritto
 * di vederlo.
 *
 * L'effetto collaterale è che nessun URL firmato finisce più nel DOM, dove
 * sarebbe copiabile e valido per un'ora anche fuori dalla sessione.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  // Appartenenza verificata qui e non dedotta dal percorso: il percorso lo
  // costruisce il client, l'appartenenza la decide il database.
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title')
    .eq('id', projectId)
    .maybeSingle<{ id: string; organization_id: string; title: string }>();

  if (!project || project.organization_id !== organization.id) {
    return NextResponse.json({ error: 'Progetto non trovato.' }, { status: 404 });
  }

  const storagePath = `${organization.id}/${projectId}/volume/anteprima.pdf`;
  const { data: file, error } = await supabase.storage
    .from('publication-exports')
    .download(storagePath);

  if (error || !file) {
    return NextResponse.json(
      { error: 'Anteprima non ancora composta.' },
      { status: 404 },
    );
  }

  const scarica = request.nextUrl.searchParams.get('download') === '1';
  const nome = `${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'volume'}-anteprima.pdf`;

  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${scarica ? 'attachment' : 'inline'}; filename="${nome}"`,
      // L'anteprima cambia a ogni capitolo convalidato: una copia in cache
      // mostrerebbe un libro più corto di quello che è.
      'Cache-Control': 'private, no-store',
    },
  });
}
