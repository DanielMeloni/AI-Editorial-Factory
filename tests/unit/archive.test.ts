import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { ArchiveRejectedError, extractArchive } from '@/lib/ingest/archive';
import { buildDataformFixture, buildZipSlipFixture } from '../fixtures/build-fixture';

describe('estrazione dell’archivio pilota', () => {
  it('riconosce i 30 capitoli e le 10 appendici', async () => {
    const result = await extractArchive(buildDataformFixture());

    const markdown = result.files.filter((f) => f.kind === 'markdown' && !f.isIgnored);
    const capitoli = markdown.filter((f) => f.filename.startsWith('capitolo-'));
    const appendici = markdown.filter((f) => f.filename.startsWith('appendice-'));

    expect(capitoli).toHaveLength(30);
    expect(appendici).toHaveLength(10);
  });

  it('classifica correttamente i tipi di file', async () => {
    const result = await extractArchive(buildDataformFixture());
    const perTipo = new Map<string, number>();
    for (const file of result.files.filter((f) => !f.isIgnored)) {
      perTipo.set(file.kind, (perTipo.get(file.kind) ?? 0) + 1);
    }

    expect(perTipo.get('markdown')).toBe(41); // 30 capitoli + 10 appendici + indice
    expect(perTipo.get('other')).toBe(1); // preambolo.tex: testo, non capitolo
    expect(perTipo.get('image')).toBe(31); // 30 figure + copertina
    expect(perTipo.get('pdf')).toBe(1);
    expect(perTipo.get('script')).toBe(1); // build_pdf.py
    expect(perTipo.get('code')).toBe(2); // genera_indice.js + eventi_grezzi.sqlx
    expect(perTipo.get('data')).toBe(1); // dataform.json
  });

  it('ignora rumore di sistema senza segnalarlo come errore', async () => {
    const result = await extractArchive(buildDataformFixture());
    const ignorati = result.files.filter((f) => f.isIgnored).map((f) => f.normalizedPath);

    expect(ignorati).toContain('.DS_Store');
    expect(ignorati).toContain('__MACOSX/._README.md');
    expect(ignorati).toContain('01-fondamenti/.gitkeep');
    expect(result.errors).toEqual([]);
  });

  it('calcola un SHA-256 per ogni file e conserva il percorso originale', async () => {
    const result = await extractArchive(buildDataformFixture());
    for (const file of result.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.originalPath).toBeTruthy();
    }
  });

  it('conserva il testo dei file testuali e non quello dei binari', async () => {
    const result = await extractArchive(buildDataformFixture());

    const capitolo = result.files.find((f) => f.filename.includes('capitolo-11'));
    expect(capitolo?.textContent).toContain('Incremental Tables');
    expect(capitolo!.wordCount).toBeGreaterThan(50);

    const immagine = result.files.find((f) => f.extension === 'png');
    expect(immagine?.textContent).toBeNull();
    expect(immagine?.bytes).not.toBeNull();
  });

  it('tratta gli script come testo inerte, senza eseguirli', async () => {
    const result = await extractArchive(buildDataformFixture());
    const script = result.files.find((f) => f.filename === 'build_pdf.py');
    expect(script?.kind).toBe('script');
    expect(script?.textContent).toContain('print("compilazione")');
  });
});

describe('rifiuto dei percorsi ostili', () => {
  it('scarta le voci che tentano di uscire dalla cartella', async () => {
    const result = await extractArchive(buildZipSlipFixture());

    expect(result.files.map((f) => f.normalizedPath)).toEqual(['legittimo.md']);
    expect(result.stats.rejected).toBe(4);

    const motivi = result.errors.map((e) => e.reason);
    expect(motivi).toContain('Tentativo di uscire dalla cartella di destinazione (ZIP Slip)');
    expect(motivi).toContain('Percorso assoluto non ammesso');
    expect(motivi).toContain('Percorso con unità Windows non ammesso');
  });

  it('non interrompe l’importazione per colpa di una voce ostile', async () => {
    const result = await extractArchive(buildZipSlipFixture());
    expect(result.files).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('limiti configurabili', () => {
  it('rifiuta un archivio con troppe voci', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 50; i += 1) entries[`file-${i}.md`] = strToU8('# titolo\n');

    await expect(extractArchive(zipSync(entries), { limits: { maxEntries: 10 } })).rejects.toThrow(
      ArchiveRejectedError,
    );
  });

  it('rifiuta un archivio con rapporto di compressione sospetto', async () => {
    // Un megabyte di zeri comprime a pochissimo: è la firma di una zip bomb.
    const bomba = zipSync({ 'bomba.txt': new Uint8Array(4_000_000) });
    await expect(
      extractArchive(bomba, { limits: { maxCompressionRatio: 50 } }),
    ).rejects.toThrow(/rapporto di compressione/i);
  });

  it('rifiuta un archivio vuoto', async () => {
    await expect(extractArchive(new Uint8Array(0))).rejects.toThrow(/vuoto/i);
  });

  it('scarta il singolo file oltre la dimensione massima, tenendo gli altri', async () => {
    const archivio = zipSync({
      'piccolo.md': strToU8('# ok\n'),
      'grande.md': strToU8('x'.repeat(20_000)),
    });

    const result = await extractArchive(archivio, { limits: { maxFileBytes: 1_000 } });
    expect(result.files.map((f) => f.filename)).toEqual(['piccolo.md']);
    expect(result.errors[0]?.reason).toMatch(/dimensione massima/i);
  });
});
