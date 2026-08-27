import type {
  AudienceProfile,
  CanonicalEntity,
  PublicationPreflightResult,
  QualityGateResult,
  QualityIssue,
} from './types';

export interface BlueprintSection {
  title: string;
  required?: boolean;
  minimumWords?: number;
}

export interface VisualCandidate {
  kind: 'diagram' | 'screenshot' | 'expected_state' | 'illustration';
  title: string;
  labels?: string[];
  altText?: string | null;
  approved?: boolean;
}

const INTERNAL_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp; label: string }> = [
  { code: 'agent_summary', pattern: /\bcapitolo scritto in\b/i, label: 'riepilogo interno di generazione' },
  { code: 'source_gap', pattern: /\bpunti non coperti dalle fonti\b/i, label: 'conteggio interno delle lacune' },
  { code: 'source_report', pattern: /\bfonti ufficiali trovate\b/i, label: 'report interno sulle fonti' },
  { code: 'revision_report', pattern: /\ble revisioni\b/i, label: 'nota interna di revisione' },
  { code: 'line_reference', pattern: /\briga\s+\d+\b/i, label: 'riferimento a riga di lavorazione' },
  { code: 'doc_note', pattern: /\bDOC\s+NOTA\b/i, label: 'marker editoriale interno' },
  { code: 'diagram_marker', pattern: /^\s*(?:#+\s*)?DIAGRAMMA\s*$/im, label: 'marker di diagramma non risolto' },
  { code: 'obsidian_callout', pattern: /\[!(?:TIP|NOTE|WARNING|IMPORTANT|CAUTION)\]/i, label: 'marker Obsidian' },
  { code: 'navigation', pattern: /\b(?:passa ai contenuti principali|aree tecnologiche)\b/i, label: 'residuo di navigazione' },
  { code: 'todo', pattern: /\b(?:TODO|FIXME|TBD)\b/i, label: 'placeholder di lavorazione' },
  { code: 'agent_metadata', pattern: /\b(?:prompt version|provider|token(?:s)?|confidence|model cost|costo token)\b/i, label: 'metadato agentico' },
  { code: 'truncated', pattern: /(?:\[testo troncato\]|\btruncated\b|\u2026\s*\[)/i, label: 'testo dichiarato troncato' },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function excerptAt(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1);
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 240);
}

function issue(
  gate: QualityIssue['gate'],
  code: string,
  message: string,
  line: number | null = null,
  excerpt: string | null = null,
  severity: QualityIssue['severity'] = 'blocking',
): QualityIssue {
  return { gate, code, severity, message, line, excerpt };
}

export function runLeakageGuard(markdown: string): QualityGateResult {
  const issues: QualityIssue[] = [];
  for (const candidate of INTERNAL_PATTERNS) {
    const match = candidate.pattern.exec(markdown);
    if (!match || match.index === undefined) continue;
    issues.push(issue(
      'leakage',
      candidate.code,
      `Il manoscritto contiene ${candidate.label}.`,
      lineOf(markdown, match.index),
      excerptAt(markdown, match.index),
    ));
  }

  const rawUrl = /(?<!\]\()https?:\/\/[^\s)>]+/gim.exec(markdown);
  if (rawUrl?.index !== undefined) {
    issues.push(issue(
      'leakage',
      'raw_url',
      'Un URL grezzo compare nel corpo: trasformarlo in citazione, nota o bibliografia.',
      lineOf(markdown, rawUrl.index),
      excerptAt(markdown, rawUrl.index),
    ));
  }

  return { gate: 'leakage', passed: issues.length === 0, issues };
}

interface ParsedSection { title: string; body: string; line: number }

function parseSections(markdown: string): ParsedSection[] {
  const matches = Array.from(markdown.matchAll(/^##\s+(.+)$/gm));
  return matches.map((match, index) => ({
    title: (match[1] ?? '').trim(),
    body: markdown.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? markdown.length),
    line: lineOf(markdown, match.index ?? 0),
  }));
}

function words(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|\[\]()!-]/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function normalizeHeading(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function runChapterCompletenessGate(
  markdown: string,
  blueprint: BlueprintSection[] = [],
): QualityGateResult {
  const issues: QualityIssue[] = [];
  const totalWords = words(markdown);
  if (totalWords < 120) {
    issues.push(issue('completeness', 'chapter_too_short', `Il capitolo contiene soltanto ${totalWords} parole editoriali.`));
  }

  const sections = parseSections(markdown);
  const byTitle = new Map(sections.map((section) => [normalizeHeading(section.title), section]));
  for (const expected of blueprint.filter((section) => section.required !== false)) {
    const found = byTitle.get(normalizeHeading(expected.title));
    if (!found) {
      issues.push(issue('completeness', 'missing_blueprint_section', `Manca la sezione pianificata «${expected.title}».`));
      continue;
    }
    const count = words(found.body);
    const minimum = expected.minimumWords ?? 35;
    if (count < minimum) {
      issues.push(issue('completeness', 'thin_blueprint_section', `La sezione «${expected.title}» contiene ${count} parole; minimo ${minimum}.`, found.line, found.title));
    }
  }

  for (const section of sections) {
    const count = words(section.body);
    if (count < 15) {
      issues.push(issue('completeness', 'thin_section', `La sezione «${section.title}» è sostanzialmente vuota (${count} parole).`, section.line, section.title));
    }
    if (/le fonti disponibili non contengono ancora materiale sufficiente/i.test(section.body)) {
      issues.push(issue('completeness', 'source_placeholder', `La sezione «${section.title}» contiene un fallback di fonte invece di prosa editoriale.`, section.line, section.title));
    }
  }

  return { gate: 'completeness', passed: issues.length === 0, issues };
}

export function runEntityConsistencyGate(markdown: string, entities: CanonicalEntity[]): QualityGateResult {
  const issues: QualityIssue[] = [];
  for (const entity of entities) {
    for (const forbidden of entity.forbiddenAliases) {
      const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}([^\\p{L}\\p{N}_-]|$)`, 'iu').exec(markdown);
      if (!match || match.index === undefined) continue;
      issues.push(issue(
        'entity_consistency',
        'forbidden_alias',
        `«${forbidden}» non è un nome ammesso per ${entity.kind}; usare «${entity.displayName}».`,
        lineOf(markdown, match.index),
        excerptAt(markdown, match.index),
      ));
    }
  }
  return { gate: 'entity_consistency', passed: issues.length === 0, issues };
}

export function runAudienceFitGate(
  markdown: string,
  profile?: AudienceProfile | null,
): QualityGateResult {
  const issues: QualityIssue[] = [];
  if (!profile) {
    issues.push(issue('audience_fit', 'missing_audience_profile', 'Il progetto non ha un audience profile strutturato.'));
    return { gate: 'audience_fit', passed: false, issues };
  }

  if (profile.level === 'beginner') {
    const advancedMentions = markdown.match(/\b(?:REST API|curl|service account|IAM policy|custom role)\b/gi)?.length ?? 0;
    if (advancedMentions > profile.jargonBudget) {
      issues.push(issue('audience_fit', 'jargon_budget_exceeded', `Il capitolo usa ${advancedMentions} riferimenti avanzati; budget ${profile.jargonBudget}.`));
    }
  }
  return { gate: 'audience_fit', passed: issues.length === 0, issues };
}

export function runVisualQaGate(visuals: VisualCandidate[]): QualityGateResult {
  const issues: QualityIssue[] = [];
  for (const visual of visuals) {
    if (!visual.approved) issues.push(issue('visual_qa', 'asset_not_approved', `L’asset «${visual.title}» non è approvato.`));
    if (!visual.altText?.trim()) issues.push(issue('visual_qa', 'missing_alt_text', `L’asset «${visual.title}» non ha testo alternativo.`));
    for (const label of visual.labels ?? []) {
      if (/https?:\/\/|\bTODO\b|\.{3}$|…$/i.test(label) || label.length > 72) {
        issues.push(issue('visual_qa', 'invalid_label', `L’asset «${visual.title}» contiene una label troncata, tecnica o troppo lunga: «${label}».`));
      }
    }
  }
  return { gate: 'visual_qa', passed: issues.length === 0, issues };
}

export function runPublicationPreflight(input: {
  manuscript: string;
  blueprint?: BlueprintSection[];
  audienceProfile?: AudienceProfile | null;
  entities?: CanonicalEntity[];
  visuals?: VisualCandidate[];
  requireAudienceProfile?: boolean;
}): PublicationPreflightResult {
  const gates = [
    runLeakageGuard(input.manuscript),
    runChapterCompletenessGate(input.manuscript, input.blueprint),
    runEntityConsistencyGate(input.manuscript, input.entities ?? []),
    runVisualQaGate(input.visuals ?? []),
  ];
  if (input.requireAudienceProfile || input.audienceProfile) {
    gates.splice(2, 0, runAudienceFitGate(input.manuscript, input.audienceProfile));
  }
  const blockingIssues = gates.flatMap((gate) => gate.issues).filter((item) => item.severity === 'blocking');
  const failed = new Set(blockingIssues.map((item) => item.gate));
  const status = failed.has('visual_qa')
    ? 'needs_visual_fix'
    : failed.has('layout_preflight')
      ? 'needs_layout_fix'
      : failed.has('leakage')
        ? 'needs_source_fix'
        : failed.size > 0
          ? 'needs_content_fix'
          : 'publishable';
  return { passed: blockingIssues.length === 0, status, gates, blockingIssues };
}
