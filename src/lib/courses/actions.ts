'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { runAgent } from '@/lib/agents/runner';
import { courseLessonAgent, coursePlanAgent } from '@/lib/agents/definitions';
import { raccogliMateriale } from '@/lib/derivazioni/materiale';
import { recordAudit } from '@/lib/security/audit';

/**
 * Corsi derivati dal manuale o da un argomento.
 *
 * Come per il blog: prima il piano — esiti, prerequisiti, scaletta — che si
 * approva, poi le lezioni, una per volta. Un corso è però più fragile di una
 * raccolta di articoli, perché le lezioni si reggono l'una sull'altra: per
 * questo ogni lezione riceve la scaletta intera e sa quale posto occupa.
 *
 * Partendo da un argomento libero si aggiungono gli estratti delle fonti al
 * testo del manuale, perché l'argomento può toccare zone che il volume sfiora
 * appena. Partendo da capitoli scelti no: quello che serve è già lì, verificato.
 */

export interface CourseActionResult {
  ok: boolean;
  message: string;
  courseId?: string;
}

const creaSchema = z.object({
  projectId: z.string().uuid(),
  sourceKind: z.enum(['chapters', 'topic']),
  topic: z.string().trim().max(2000).nullable(),
  chapterIds: z.array(z.string().uuid()).max(60),
  level: z.enum(['base', 'intermediate', 'advanced']),
  format: z.enum(['autoapprendimento', 'aula', 'video']),
  lessonMinutes: z.number().int().min(10).max(240),
  lessonCount: z.number().int().min(1).max(40),
});

export async function createCourse(input: z.input<typeof creaSchema>): Promise<CourseActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = creaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Richiesta non valida.' };
  }

  const dati = parsed.data;
  if (dati.sourceKind === 'topic' && !dati.topic?.trim()) {
    return { ok: false, message: 'Scrivi l’argomento del corso.' };
  }
  if (dati.sourceKind === 'chapters' && dati.chapterIds.length === 0) {
    return { ok: false, message: 'Scegli almeno un capitolo.' };
  }

  const supabase = await createClient();
  const materiale = await raccogliMateriale(supabase, dati.projectId, {
    includiFonti: dati.sourceKind === 'topic',
    soloCapitoli: dati.sourceKind === 'chapters' ? dati.chapterIds : undefined,
  });

  if (!materiale) return { ok: false, message: 'Progetto non trovato.' };
  if (materiale.chapters.length === 0 && dati.sourceKind === 'chapters') {
    return { ok: false, message: 'I capitoli scelti non risultano approvati.' };
  }

  const argomento =
    dati.sourceKind === 'topic'
      ? dati.topic!.trim()
      : materiale.chapters.map((capitolo) => capitolo.title).join(' · ');

  const piano = (
    await runAgent(
      coursePlanAgent,
      {
        projectTitle: materiale.project.title,
        direzione: materiale.direzione,
        language: materiale.project.language,
        topic: argomento,
        level: dati.level,
        format: dati.format,
        lessonMinutes: dati.lessonMinutes,
        lessonCount: dati.lessonCount,
        evidence: materiale.evidence,
      },
      {
        db: createAdminClient(),
        organizationId: organization.id,
        projectId: dati.projectId,
        chapterId: null,
        workflowRunId: null,
        stepName: 'piano-corso',
      },
    )
  ).output;

  const { data: corso, error } = await supabase
    .from('courses')
    .insert({
      project_id: dati.projectId,
      organization_id: organization.id,
      title: piano.title,
      source_kind: dati.sourceKind,
      topic: dati.sourceKind === 'topic' ? argomento : null,
      chapter_ids: dati.sourceKind === 'chapters' ? dati.chapterIds : [],
      level: dati.level,
      format: dati.format,
      lesson_minutes: dati.lessonMinutes,
      lesson_count: piano.lessons.length,
      status: 'pending_approval',
      summary: piano.summary,
      prerequisites: piano.prerequisites,
      outcomes: piano.outcomes,
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !corso) return { ok: false, message: `Corso non salvato: ${error?.message ?? ''}` };

  const { error: erroreLezioni } = await supabase.from('course_lessons').insert(
    piano.lessons.map((lezione, indice) => ({
      course_id: corso.id,
      project_id: dati.projectId,
      organization_id: organization.id,
      position: indice + 1,
      title: lezione.title,
      intent: lezione.intent,
      objectives: lezione.objectives,
      status: 'planned' as const,
    })),
  );

  if (erroreLezioni) return { ok: false, message: `Lezioni non salvate: ${erroreLezioni.message}` };

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'course.created',
    entityType: 'course',
    entityId: corso.id,
    metadata: { lezioni: piano.lessons.length, livello: dati.level, formato: dati.format },
  });

  revalidatePath(`/projects/${dati.projectId}/courses`);

  return {
    ok: true,
    courseId: corso.id,
    message:
      piano.lessons.length < dati.lessonCount
        ? `Proposte ${piano.lessons.length} lezioni su ${dati.lessonCount} richieste. ${piano.note}`
        : `Piano del corso pronto: ${piano.lessons.length} lezioni da approvare.`,
  };
}

export async function decideCourse(
  courseId: string,
  decision: 'approved' | 'rejected',
): Promise<CourseActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: corso } = await supabase
    .from('courses')
    .select('id, project_id, organization_id')
    .eq('id', courseId)
    .maybeSingle<{ id: string; project_id: string; organization_id: string }>();

  if (!corso || corso.organization_id !== organization.id) {
    return { ok: false, message: 'Corso non trovato.' };
  }

  await supabase.from('courses').update({ status: decision }).eq('id', courseId);
  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: `course.${decision}`,
    entityType: 'course',
    entityId: courseId,
  });

  revalidatePath(`/projects/${corso.project_id}/courses`);
  return {
    ok: true,
    message:
      decision === 'approved'
        ? 'Piano approvato: ora puoi generare le lezioni.'
        : 'Piano del corso rifiutato.',
  };
}

/** Scrive una lezione del corso approvato. */
export async function generateCourseLesson(lessonId: string): Promise<CourseActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: lezione } = await supabase
    .from('course_lessons')
    .select('id, course_id, project_id, organization_id, position, title, intent, objectives')
    .eq('id', lessonId)
    .maybeSingle<{
      id: string; course_id: string; project_id: string; organization_id: string;
      position: number; title: string; intent: string | null; objectives: string[];
    }>();

  if (!lezione || lezione.organization_id !== organization.id) {
    return { ok: false, message: 'Lezione non trovata.' };
  }

  const { data: corso } = await supabase
    .from('courses')
    .select('status, source_kind, topic, chapter_ids, level, format, lesson_minutes, lesson_count')
    .eq('id', lezione.course_id)
    .maybeSingle<{
      status: string; source_kind: 'chapters' | 'topic'; topic: string | null;
      chapter_ids: string[]; level: 'base' | 'intermediate' | 'advanced';
      format: 'autoapprendimento' | 'aula' | 'video'; lesson_minutes: number; lesson_count: number;
    }>();

  if (!corso) return { ok: false, message: 'Corso non trovato.' };
  if (corso.status !== 'approved') {
    return { ok: false, message: 'Il piano del corso non è approvato.' };
  }

  const materiale = await raccogliMateriale(supabase, lezione.project_id, {
    includiFonti: corso.source_kind === 'topic',
    soloCapitoli: corso.source_kind === 'chapters' ? corso.chapter_ids : undefined,
  });
  if (!materiale) return { ok: false, message: 'Progetto non trovato.' };

  const { data: scaletta } = await supabase
    .from('course_lessons')
    .select('title, position')
    .eq('course_id', lezione.course_id)
    .order('position', { ascending: true })
    .returns<{ title: string; position: number }[]>();

  await supabase.from('course_lessons').update({ status: 'generating', error: null }).eq('id', lessonId);

  try {
    const scritta = (
      await runAgent(
        courseLessonAgent,
        {
          projectTitle: materiale.project.title,
          direzione: materiale.direzione,
          language: materiale.project.language,
          topic: corso.topic ?? materiale.chapters.map((c) => c.title).join(' · '),
          level: corso.level,
          format: corso.format,
          lessonMinutes: corso.lesson_minutes,
          lessonCount: corso.lesson_count,
          evidence: materiale.evidence,
          lessonTitle: lezione.title,
          lessonIntent: lezione.intent ?? '',
          lessonObjectives: lezione.objectives ?? [],
          lessonNumber: lezione.position,
          outline: (scaletta ?? []).map((voce) => voce.title),
        },
        {
          db: createAdminClient(),
          organizationId: organization.id,
          projectId: lezione.project_id,
          chapterId: null,
          workflowRunId: null,
          stepName: 'stesura-lezione',
        },
      )
    ).output;

    await supabase
      .from('course_lessons')
      .update({
        status: 'drafted',
        content_md: scritta.contentMd,
        word_count: scritta.contentMd.split(/\s+/).filter(Boolean).length,
        error: scritta.gaps.length > 0 ? `Punti non coperti: ${scritta.gaps.join('; ')}` : null,
      })
      .eq('id', lessonId);

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'course.lesson_generated',
      entityType: 'course_lesson',
      entityId: lessonId,
    });

    revalidatePath(`/projects/${lezione.project_id}/courses`);
    return {
      ok: true,
      message:
        scritta.gaps.length > 0
          ? `Lezione scritta, con ${scritta.gaps.length} punti non coperti dalle fonti.`
          : 'Lezione scritta.',
    };
  } catch (error) {
    const motivo = (error as Error).message;
    await supabase
      .from('course_lessons')
      .update({ status: 'failed', error: motivo })
      .eq('id', lessonId);
    revalidatePath(`/projects/${lezione.project_id}/courses`);
    return { ok: false, message: `Stesura non riuscita: ${motivo}` };
  }
}
