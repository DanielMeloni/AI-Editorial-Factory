import { describe, expect, it } from 'vitest';
import {
  buildFormatterPayload,
  runChapterCompletenessGate,
  runEntityConsistencyGate,
  runLeakageGuard,
  runPublicationPreflight,
  runVisualQaGate,
} from '@/lib/editorial-quality';

const SECTION = Array.from({ length: 45 }, (_, index) => `parola${index + 1}`).join(' ');
const VALID_CHAPTER = `# Primo progetto Dataform

Introduzione sufficientemente estesa per presentare il problema, il risultato atteso e il percorso seguito dal lettore.

## Preparazione

${SECTION}

## Primo risultato

${SECTION}

## Verifica

${SECTION}
`;

describe('hardening editoriale P0', () => {
  it('blocca metadati agentici e residui di navigazione nel manoscritto', () => {
    const result = runLeakageGuard(`${VALID_CHAPTER}\nCapitolo scritto in 4 sezioni.\nPassa ai contenuti principali`);
    expect(result.passed).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['agent_summary', 'navigation']));
  });

  it('accetta link Markdown ma blocca URL grezzi', () => {
    expect(runLeakageGuard(`${VALID_CHAPTER}\n[Documentazione](https://example.com/docs)`).passed).toBe(true);
    expect(runLeakageGuard(`${VALID_CHAPTER}\nConsulta https://example.com/docs`).issues.some((item) => item.code === 'raw_url')).toBe(true);
  });

  it('confronta il contenuto reale con il blueprint', () => {
    const result = runChapterCompletenessGate(VALID_CHAPTER, [
      { title: 'Preparazione', minimumWords: 35 },
      { title: 'Primo risultato', minimumWords: 35 },
      { title: 'Sezione mancante', minimumWords: 35 },
    ]);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_blueprint_section' }));
  });

  it('blocca i fallback di fonte spacciati per sezioni', () => {
    const result = runChapterCompletenessGate(`${VALID_CHAPTER}\n## Appendice\n\nLe fonti disponibili non contengono ancora materiale sufficiente per sviluppare questa sezione senza introdurre informazioni non verificate.`);
    expect(result.issues.map((item) => item.code)).toContain('source_placeholder');
  });

  it('rileva alias vietati nell’Entity Registry', () => {
    const result = runEntityConsistencyGate(`${VALID_CHAPTER}\nUsa il repository dataform-nordshop-lab.`, [{
      id: 'repo',
      kind: 'repository',
      displayName: 'nordshop-analytics',
      aliases: [],
      forbiddenAliases: ['dataform-nordshop-lab'],
    }]);
    expect(result.passed).toBe(false);
    expect(result.issues[0]?.message).toContain('nordshop-analytics');
  });

  it('blocca asset non approvati, senza alt text o con label tronche', () => {
    const result = runVisualQaGate([{ kind: 'diagram', title: 'Flusso', approved: false, altText: '', labels: ['Risultato…'] }]);
    expect(result.passed).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['asset_not_approved', 'missing_alt_text', 'invalid_label']));
  });

  it('costruisce il payload formatter soltanto dalla whitelist approvata', () => {
    const payload = buildFormatterPayload([
      { kind: 'qa_metadata', payload: { score: 0.9 }, approved: false },
      { kind: 'evidence', payload: { excerpt: 'interno' }, approved: false },
      { kind: 'manuscript_content', payload: VALID_CHAPTER, approved: true },
      { kind: 'approved_asset', payload: { id: 'figure-1' }, approved: true },
      { kind: 'publication_metadata', payload: { title: 'Manuale' }, approved: true },
    ]);
    expect(payload.manuscript).toBe(VALID_CHAPTER);
    expect(payload.assets).toEqual([{ id: 'figure-1' }]);
    expect(JSON.stringify(payload)).not.toContain('score');
    expect(JSON.stringify(payload)).not.toContain('interno');
  });

  it('esegue un preflight fail-closed con audience profile', () => {
    const result = runPublicationPreflight({
      manuscript: VALID_CHAPTER,
      requireAudienceProfile: true,
      audienceProfile: {
        level: 'beginner',
        goal: 'Completare una prima pipeline guidata e verificarne il risultato.',
        allowedPrerequisites: ['SQL di base'],
        jargonBudget: 5,
        quickWinMaxPages: 25,
        advancedContentPolicy: 'appendix',
        requireUiScreenshots: true,
        requireExpectedStateVisuals: true,
      },
    });
    expect(result.passed).toBe(true);
    expect(result.status).toBe('publishable');
  });
});
