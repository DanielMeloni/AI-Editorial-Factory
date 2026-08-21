import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportEpub } from '@/lib/publish/epub';

describe('esportazione EPUB', () => {
  it('crea un EPUB 3 con package, indice e capitolo completo', async () => {
    const bytes = await exportEpub('# Titolo\n\nTesto **completo** del capitolo.', {
      title: 'Capitolo di prova',
      chapterNumber: 1,
      chapterLabel: 'Capitolo 1',
      author: 'Autore',
      projectTitle: 'Manuale',
      volume: null,
      versionNo: 2,
      exportedAt: '2026-08-21T00:00:00.000Z',
    });

    const files = unzipSync(bytes);
    expect(strFromU8(files.mimetype!)).toBe('application/epub+zip');
    expect(strFromU8(files['OEBPS/content.opf']!)).toContain('application/xhtml+xml');
    expect(strFromU8(files['OEBPS/nav.xhtml']!)).toContain('epub:type="toc"');
    expect(strFromU8(files['OEBPS/chapter.xhtml']!)).toContain('Testo <strong>completo</strong>');
  });
});
