import type { RuleMode, RuleScope, VolumeStatus } from './types';
import { isVolumeImmutable } from './types';

/**
 * Risoluzione dell'ereditarietà fra collana e volume.
 *
 * È il cuore concettuale della Fase 8, e per questo esiste già: la logica va
 * discussa e collaudata prima che ci si costruisca sopra un'interfaccia.
 *
 * Due principi:
 *
 *  1. Una deroga è **dichiarata e motivata**. Senza motivazione non è una scelta
 *     editoriale, è una svista che nessuno saprà spiegare fra due anni.
 *  2. Una regola `locked` non è derogabile. Il tentativo viene **rifiutato**, non
 *     ignorato in silenzio: un fallimento silenzioso lascia credere che la
 *     deroga sia attiva.
 */

export interface SeriesRule<T = unknown> {
  scope: RuleScope;
  key: string;
  value: T;
  /** Se `locked`, il volume non può discostarsene. */
  mode: Extract<RuleMode, 'inherited' | 'locked'>;
}

export interface VolumeOverride<T = unknown> {
  scope: RuleScope;
  key: string;
  value: T;
  /** Obbligatoria: senza motivazione la deroga non è valida. */
  reason: string;
}

/** Esito favorevole: la regola ha un valore effettivo. */
export interface AppliedRule<T = unknown> {
  ok: true;
  scope: RuleScope;
  key: string;
  value: T;
  mode: RuleMode;
  reason: string | null;
  /** Vero quando il valore proviene dalla collana. */
  fromSeries: boolean;
}

/** Esito sfavorevole: la deroga non è ammissibile, e si dice perché. */
export interface RejectedRule {
  ok: false;
  scope: RuleScope;
  key: string;
  code: 'regola_bloccata' | 'motivazione_mancante' | 'regola_inesistente';
  message: string;
}

export type ResolvedRule<T = unknown> = AppliedRule<T> | RejectedRule;

/** Valore effettivo di una regola per un volume, con la ragione. */
export function resolveRule<T>(
  rule: SeriesRule<T> | undefined,
  override: VolumeOverride<T> | undefined,
): ResolvedRule<T> {
  if (!rule) {
    return {
      ok: false,
      scope: override?.scope ?? ('editorial_line' as RuleScope),
      key: override?.key ?? '',
      code: 'regola_inesistente',
      message: 'La collana non definisce questa regola: non c’è nulla da ereditare.',
    };
  }

  if (!override) {
    return {
      ok: true,
      scope: rule.scope,
      key: rule.key,
      value: rule.value,
      mode: rule.mode === 'locked' ? 'locked' : 'inherited',
      reason: null,
      fromSeries: true,
    };
  }

  if (rule.mode === 'locked') {
    return {
      ok: false,
      scope: rule.scope,
      key: rule.key,
      code: 'regola_bloccata',
      message:
        `La regola «${rule.key}» è bloccata nella collana e non ammette varianti locali. ` +
        'Per modificarla, cambia la regola della collana e valutane l’impatto sui volumi.',
    };
  }

  if (override.reason.trim().length === 0) {
    return {
      ok: false,
      scope: rule.scope,
      key: rule.key,
      code: 'motivazione_mancante',
      message:
        `La variante locale su «${rule.key}» richiede una motivazione: ` +
        'una deroga non spiegata è indistinguibile da un errore.',
    };
  }

  return {
    ok: true,
    scope: rule.scope,
    key: rule.key,
    value: override.value,
    mode: 'overridden',
    reason: override.reason.trim(),
    fromSeries: false,
  };
}

/** Risolve l'intero insieme delle regole di un volume. */
export function resolveRuleSet<T>(
  rules: SeriesRule<T>[],
  overrides: VolumeOverride<T>[],
): { resolved: AppliedRule<T>[]; rejected: RejectedRule[] } {
  const perChiave = new Map(overrides.map((o) => [`${o.scope}::${o.key}`, o]));
  const esiti = rules.map((rule) => resolveRule(rule, perChiave.get(`${rule.scope}::${rule.key}`)));

  // Una deroga su una regola che la collana non definisce va segnalata: indica
  // che la regola è stata rimossa e il volume non se n'è accorto.
  const chiaviNote = new Set(rules.map((rule) => `${rule.scope}::${rule.key}`));
  for (const override of overrides) {
    if (!chiaviNote.has(`${override.scope}::${override.key}`)) {
      esiti.push(resolveRule<T>(undefined, override));
    }
  }

  return {
    resolved: esiti.filter((esito): esito is AppliedRule<T> => esito.ok),
    rejected: esiti.filter((esito): esito is RejectedRule => !esito.ok),
  };
}

// ---------------------------------------------------------------------------
// Impatto di una modifica alle regole della collana
// ---------------------------------------------------------------------------

export interface VolumeSnapshot {
  volumeId: string;
  volumeNumber: number;
  title: string;
  status: VolumeStatus;
  overrides: VolumeOverride[];
}

export type ImpactKind =
  | 'applicabile'
  | 'protetto_da_deroga'
  | 'richiede_nuova_edizione'
  | 'non_interessato';

export interface VolumeImpact {
  volumeId: string;
  volumeNumber: number;
  title: string;
  kind: ImpactKind;
  explanation: string;
}

export const IMPACT_LABELS: Record<ImpactKind, string> = {
  applicabile: 'La modifica si applica',
  protetto_da_deroga: 'Protetto da una variante locale',
  richiede_nuova_edizione: 'Pubblicato: serve una nuova edizione',
  non_interessato: 'Non interessato',
};

/**
 * Analisi dell'impatto di una modifica, **prima** che venga applicata.
 *
 * Il ramo che conta è quello dei volumi pubblicati: non entrano
 * nell'applicazione automatica, generano una proposta separata. Una copia
 * stampata non si aggiorna, e un lettore che possiede il Volume 1 non riceve
 * alcuna notifica quando la terminologia cambia.
 */
export function analyzeImpact(
  changedRules: { scope: RuleScope; key: string }[],
  volumes: VolumeSnapshot[],
): VolumeImpact[] {
  const chiaviModificate = new Set(changedRules.map((rule) => `${rule.scope}::${rule.key}`));

  return volumes.map((volume) => {
    const deroghe = volume.overrides.filter((override) =>
      chiaviModificate.has(`${override.scope}::${override.key}`),
    );

    const base = { volumeId: volume.volumeId, volumeNumber: volume.volumeNumber, title: volume.title };

    if (isVolumeImmutable(volume.status)) {
      return {
        ...base,
        kind: 'richiede_nuova_edizione',
        explanation:
          `Il volume è ${volume.status === 'published' ? 'pubblicato' : 'archiviato'}: ` +
          'la modifica non viene applicata. Se necessaria, genera una proposta di nuova edizione.',
      };
    }

    if (deroghe.length > 0) {
      return {
        ...base,
        kind: 'protetto_da_deroga',
        explanation:
          `${deroghe.length} regol${deroghe.length === 1 ? 'a' : 'e'} con variante locale: ` +
          `${deroghe.map((d) => d.key).join(', ')}. La modifica non le tocca.`,
      };
    }

    return {
      ...base,
      kind: 'applicabile',
      explanation: `La modifica si applica a ${chiaviModificate.size} regol${chiaviModificate.size === 1 ? 'a' : 'e'}.`,
    };
  });
}

/** Riepilogo dell'impatto, per la schermata di approvazione. */
export function summarizeImpact(impacts: VolumeImpact[]): {
  applicabili: number;
  protetti: number;
  nuoveEdizioni: number;
  richiedeAttenzione: boolean;
} {
  const conta = (kind: ImpactKind) => impacts.filter((impact) => impact.kind === kind).length;

  const nuoveEdizioni = conta('richiede_nuova_edizione');

  return {
    applicabili: conta('applicabile'),
    protetti: conta('protetto_da_deroga'),
    nuoveEdizioni,
    // Se sono coinvolti volumi pubblicati, la decisione non è di routine.
    richiedeAttenzione: nuoveEdizioni > 0,
  };
}
