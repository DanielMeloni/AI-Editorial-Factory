import { describe, expect, it } from 'vitest';
import { chapterPlanAgent, chapterSectionAgent } from '@/lib/agents/definitions';
import type { ChapterDraftInput } from '@/lib/agents/schemas';

const input: ChapterDraftInput = {
  chapterId: '11111111-2222-3333-4444-555555555555',
  number: 4,
  title: 'Orchestrare una pipeline',
  objective: 'Comprendere ed eseguire il processo completo.',
  partTitle: 'Produzione',
  language: 'it',
  direzione: 'Scrittura concreta e progressiva.',
  references: [],
  evidence: 'La pipeline acquisisce i dati, li valida e infine li pubblica.',
  existingContent: '',
  manualOutline: ['Fondamenti', 'Orchestrare una pipeline'],
  previousChapters: [],
};

describe('prompt per la stesura visuale dei capitoli', () => {
  it('chiede al piano di distribuire figure utili lungo il capitolo', () => {
    const prompt = chapterPlanAgent.buildPrompt(input);

    expect(chapterPlanAgent.promptVersion).toBe('v2');
    expect(prompt).toContain('da 2 a 4 sezioni con `needsFigure: true`');
    expect(prompt).toContain('flussi per processi o decisioni');
    expect(prompt).toContain('non usarle come decorazione');
  });

  it('trasforma i processi in diagrammi di flusso descritti in modo operativo', () => {
    const prompt = chapterSectionAgent.buildPrompt({
      ...input,
      sectionTitle: 'Dal dato alla pubblicazione',
      sectionIntent: 'Spiegare passaggi e diramazioni della pipeline.',
      needsCode: false,
      needsFigure: true,
      sectionNumber: 2,
      outline: ['Contesto', 'Dal dato alla pubblicazione'],
      objectives: ['Eseguire la pipeline'],
    });

    expect(chapterSectionAgent.promptVersion).toBe('v2');
    expect(prompt).toContain('diagramma di flusso');
    expect(prompt).toContain('passaggi, collegamenti e diramazioni');
    expect(prompt).toContain('[IMMAGINE: tipo; contenuto; elementi e relazioni da mostrare]');
  });
});
