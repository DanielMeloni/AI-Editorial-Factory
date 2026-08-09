import { describe, expect, it } from 'vitest';
import { checkArchivePath, shouldIgnorePath } from '@/lib/ingest/path-guard';
import { DEFAULT_INGEST_LIMITS } from '@/lib/ingest/limits';

const limits = DEFAULT_INGEST_LIMITS;

describe('protezione ZIP Slip e path traversal', () => {
  it.each([
    ['../../../etc/passwd', 'attraversamento'],
    ['a/b/../../../fuori.md', 'attraversamento'],
    ['capitoli/../../fuori.md', 'attraversamento'],
    ['..', 'attraversamento'],
    ['../', 'attraversamento'],
  ])('rifiuta il percorso con risalita %s', (path, reason) => {
    const result = checkArchivePath(path, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it.each([
    ['/etc/cron.d/backdoor', 'percorso_assoluto'],
    ['//server/condivisione/file.md', 'percorso_assoluto'],
    ['C:\\Windows\\System32\\config.txt', 'unita_windows'],
    ['c:/windows/file.txt', 'unita_windows'],
  ])('rifiuta il percorso assoluto %s', (path, reason) => {
    const result = checkArchivePath(path, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('rifiuta byte nulli e caratteri di controllo', () => {
    expect(checkArchivePath('file\0.md', limits)).toMatchObject({ ok: false, reason: 'byte_nullo' });
    expect(checkArchivePath('file\u0007.md', limits)).toMatchObject({
      ok: false,
      reason: 'carattere_di_controllo',
    });
  });

  it('rifiuta i nomi riservati da Windows', () => {
    expect(checkArchivePath('cartella/CON.md', limits)).toMatchObject({
      ok: false,
      reason: 'nome_riservato',
    });
    expect(checkArchivePath('nul', limits)).toMatchObject({ ok: false, reason: 'nome_riservato' });
  });

  it('rifiuta percorsi troppo lunghi o troppo annidati', () => {
    const lungo = `${'a'.repeat(500)}.md`;
    expect(checkArchivePath(lungo, limits)).toMatchObject({
      ok: false,
      reason: 'percorso_troppo_lungo',
    });

    const profondo = `${Array.from({ length: 30 }, (_, i) => `d${i}`).join('/')}/file.md`;
    expect(checkArchivePath(profondo, limits)).toMatchObject({
      ok: false,
      reason: 'annidamento_eccessivo',
    });
  });

  it('rifiuta percorsi vuoti', () => {
    expect(checkArchivePath('', limits)).toMatchObject({ ok: false, reason: 'percorso_vuoto' });
    expect(checkArchivePath('./', limits)).toMatchObject({ ok: false, reason: 'percorso_vuoto' });
  });
});

describe('normalizzazione dei percorsi legittimi', () => {
  it('accetta un percorso ordinario e ne estrae le componenti', () => {
    const result = checkArchivePath('02-modellazione/capitolo-11-incremental.md', limits);
    expect(result).toEqual({
      ok: true,
      normalized: '02-modellazione/capitolo-11-incremental.md',
      directory: '02-modellazione',
      filename: 'capitolo-11-incremental.md',
      extension: 'md',
    });
  });

  it('converte i separatori Windows e rimuove i segmenti superflui', () => {
    const result = checkArchivePath('cartella\\sotto\\.\\file.MD', limits);
    expect(result).toMatchObject({
      ok: true,
      normalized: 'cartella/sotto/file.MD',
      extension: 'md',
    });
  });

  it('gestisce i file senza estensione e quelli nascosti', () => {
    expect(checkArchivePath('Makefile', limits)).toMatchObject({ ok: true, extension: '' });
    expect(checkArchivePath('.editorconfig', limits)).toMatchObject({ ok: true, extension: '' });
  });
});

describe('file da ignorare in silenzio', () => {
  it.each([
    '__MACOSX/._README.md',
    '.DS_Store',
    'cartella/Thumbs.db',
    'node_modules/pacchetto/index.js',
    '.git/config',
    'bozze/appunti.docx~',
    'testo.tmp',
    'file.swp',
  ])('ignora %s', (path) => {
    expect(shouldIgnorePath(path).ignore).toBe(true);
  });

  it('non ignora i file editoriali', () => {
    expect(shouldIgnorePath('01-fondamenti/capitolo-01.md').ignore).toBe(false);
    expect(shouldIgnorePath('assets/figura-11.png').ignore).toBe(false);
  });
});
