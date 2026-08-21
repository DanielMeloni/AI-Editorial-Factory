'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { runAgent } from '@/lib/agents/runner';
import { blogArticleAgent, blogPlanAgent } from '@/lib/agents/definitions';
import { raccogliMateriale } from '@/lib/derivazioni/materiale';
import { recordAudit } from '@/lib/security/audit';
import { slugify } from '@/lib/projects/schemas';

/**
 * Articoli per il blog, derivati dal manuale.
 *
 * Due passaggi separati e non uno: prima il piano degli angoli, che si approva,
 * poi la stesura. La ragione è economica prima che editoriale — dieci articoli
 * sbagliati costano dieci volte uno sbagliato — ma la conseguenza è editoriale:
 * quando approvi il piano stai decidendo di cosa parlerà il blog, che è la
 * decisione vera.
 *
 * Gli articoli si scrivono **uno alla volta**, su richiesta. Una generazione in
 * blocco lascerebbe l'interfaccia bloccata per minuti e, al primo errore, non
 * saprebbe dire a che punto era arrivata.
 */

export interface BlogActionResult {
  ok: boolean;
  message: string;
  planId?: string;
  articleId?: string;
}

export async function createBlogPlan(input: {
  projectId: string;
  count: number;
}): Promise<BlogActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = z
    .object({ projectId: z.string().uuid(), count: z.number().int().min(1).max(30) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Richiesta non valida.' };

  const supabase = await createClient();
  const materiale = await raccogliMateriale(supabase, parsed.data.projectId);

  if (!materiale) return { ok: false, message: 'Progetto non trovato.' };
  if (materiale.chapters.length === 0) {
    // Senza capitoli approvati non c'è nulla da cui derivare: proporre angoli
    // qui significherebbe inventarli.
    return {
      ok: false,
      message:
        'Nessun capitolo approvato: il blog nasce dal manuale, non dalle fonti grezze. Approva almeno un capitolo.',
    };
  }

  let piano;
  try {
    piano = (
      await runAgent(
        blogPlanAgent,
        {
          projectTitle: materiale.project.title,
          projectSubtitle: materiale.project.subtitle,
          direzione: materiale.direzione,
          language: materiale.project.language,
          count: parsed.data.count,
          outline: materiale.outline,
          evidence: materiale.evidence,
        },
        {
          db: createAdminClient(),
          organizationId: organization.id,
          projectId: parsed.data.projectId,
          chapterId: null,
          workflowRunId: null,
          stepName: 'piano-blog',
        },
      )
    ).output;
  } catch (error) {
    return { ok: false, message: `Creazione del piano non riuscita: ${(error as Error).message}` };
  }

  const { data: plan, error } = await supabase
    .from('blog_plans')
    .insert({
      project_id: parsed.data.projectId,
      organization_id: organization.id,
      requested_count: parsed.data.count,
      status: 'pending_approval',
      summary: piano.note || null,
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !plan) return { ok: false, message: `Piano non salvato: ${error?.message ?? ''}` };

  const righe = piano.articles.map((articolo, indice) => ({
    plan_id: plan.id,
    project_id: parsed.data.projectId,
    organization_id: organization.id,
    position: indice + 1,
    title: articolo.title,
    slug: slugify(articolo.title) || `articolo-${indice + 1}`,
    angle: articolo.angle,
    target_keyword: articolo.targetKeyword,
    secondary_keywords: articolo.secondaryKeywords,
    search_intent: articolo.searchIntent,
    status: 'planned' as const,
  }));

  const { error: erroreRighe } = await supabase.from('blog_articles').insert(righe);
  if (erroreRighe) {
    // Il piano senza righe diventerebbe comunque “l'ultimo piano” e renderebbe
    // la pagina inutilizzabile. La creazione è un'unica operazione logica.
    await supabase.from('blog_plans').delete().eq('id', plan.id);
    return { ok: false, message: `Articoli non salvati: ${erroreRighe.message}` };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'blog.plan_created',
    entityType: 'blog_plan',
    entityId: plan.id,
    metadata: { requested: parsed.data.count, proposti: righe.length },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/blog`);

  return {
    ok: true,
    planId: plan.id,
    message:
      righe.length < parsed.data.count
        ? `Proposti ${righe.length} articoli su ${parsed.data.count} richiesti. ${piano.note}`
        : `Piano pronto: ${righe.length} articoli da approvare.`,
  };
}

/** Approva o rifiuta il piano. Senza approvazione non si scrive nulla. */
export async function decideBlogPlan(
  planId: string,
  decision: 'approved' | 'rejected',
): Promise<BlogActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from('blog_plans')
    .select('id, project_id, organization_id')
    .eq('id', planId)
    .maybeSingle<{ id: string; project_id: string; organization_id: string }>();

  if (!plan || plan.organization_id !== organization.id) {
    return { ok: false, message: 'Piano non trovato.' };
  }

  const { error: updateError } = await supabase
    .from('blog_plans')
    .update({ status: decision })
    .eq('id', planId);
  if (updateError) {
    return { ok: false, message: `Decisione non salvata: ${updateError.message}` };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: `blog.plan_${decision}`,
    entityType: 'blog_plan',
    entityId: planId,
  });

  revalidatePath(`/projects/${plan.project_id}/blog`);
  return {
    ok: true,
    message:
      decision === 'approved'
        ? 'Piano approvato: ora puoi generare gli articoli.'
        : 'Piano rifiutato.',
  };
}

/** Scrive un articolo del piano approvato. */
export async function generateBlogArticle(articleId: string): Promise<BlogActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: articolo } = await supabase
    .from('blog_articles')
    .select(
      'id, plan_id, project_id, organization_id, title, angle, target_keyword, secondary_keywords, search_intent',
    )
    .eq('id', articleId)
    .maybeSingle<{
      id: string;
      plan_id: string;
      project_id: string;
      organization_id: string;
      title: string;
      angle: string;
      target_keyword: string | null;
      secondary_keywords: string[];
      search_intent: string | null;
    }>();

  if (!articolo || articolo.organization_id !== organization.id) {
    return { ok: false, message: 'Articolo non trovato.' };
  }

  const { data: plan } = await supabase
    .from('blog_plans')
    .select('status')
    .eq('id', articolo.plan_id)
    .maybeSingle<{ status: string }>();

  // Il gate esiste per essere rispettato anche da qui, non solo dall'interfaccia.
  if (plan?.status !== 'approved') {
    return { ok: false, message: 'Il piano non è approvato: approvalo prima di generare.' };
  }

  const materiale = await raccogliMateriale(supabase, articolo.project_id);
  if (!materiale) return { ok: false, message: 'Progetto non trovato.' };
  if (materiale.chapters.length === 0) {
    return { ok: false, message: 'Non ci sono capitoli approvati completi da cui scrivere.' };
  }

  const { data: fratelli } = await supabase
    .from('blog_articles')
    .select('title')
    .eq('plan_id', articolo.plan_id)
    .neq('id', articleId)
    .returns<{ title: string }[]>();

  const { error: startError } = await supabase
    .from('blog_articles')
    .update({ status: 'generating', error: null })
    .eq('id', articleId);
  if (startError)
    return { ok: false, message: `Avvio della stesura non riuscito: ${startError.message}` };

  try {
    const scritto = (
      await runAgent(
        blogArticleAgent,
        {
          projectTitle: materiale.project.title,
          projectSubtitle: materiale.project.subtitle,
          direzione: materiale.direzione,
          language: materiale.project.language,
          count: 1,
          outline: materiale.outline,
          evidence: materiale.evidence,
          title: articolo.title,
          angle: articolo.angle,
          targetKeyword: articolo.target_keyword ?? '',
          secondaryKeywords: articolo.secondary_keywords ?? [],
          searchIntent: articolo.search_intent ?? '',
          siblings: (fratelli ?? []).map((fratello) => fratello.title),
        },
        {
          db: createAdminClient(),
          organizationId: organization.id,
          projectId: articolo.project_id,
          chapterId: null,
          workflowRunId: null,
          stepName: 'stesura-articolo',
        },
      )
    ).output;

    const { error: saveError } = await supabase
      .from('blog_articles')
      .update({
        status: 'drafted',
        content_md: scritto.contentMd,
        slug: scritto.slug || slugify(articolo.title),
        word_count: scritto.contentMd.split(/\s+/).filter(Boolean).length,
        seo: {
          metaTitle: scritto.metaTitle,
          metaDescription: scritto.metaDescription,
          answerSummary: scritto.answerSummary,
          keyTakeaways: scritto.keyTakeaways,
          faq: scritto.faq,
          entities: scritto.entities,
          internalLinkHints: scritto.internalLinkHints,
          gaps: scritto.gaps,
        },
      })
      .eq('id', articleId);
    if (saveError) throw new Error(`Salvataggio dell’articolo fallito: ${saveError.message}`);

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'blog.article_generated',
      entityType: 'blog_article',
      entityId: articleId,
    });

    revalidatePath(`/projects/${articolo.project_id}/blog`);

    return {
      ok: true,
      articleId,
      message:
        scritto.gaps.length > 0
          ? `Articolo scritto, con ${scritto.gaps.length} punti non coperti dalle fonti.`
          : 'Articolo scritto.',
    };
  } catch (error) {
    const motivo = (error as Error).message;
    // Lo stato resta visibile: un articolo fermo su «generating» sembrerebbe
    // in corso per sempre.
    await supabase
      .from('blog_articles')
      .update({ status: 'failed', error: motivo })
      .eq('id', articleId);
    revalidatePath(`/projects/${articolo.project_id}/blog`);
    return { ok: false, message: `Stesura non riuscita: ${motivo}` };
  }
}
