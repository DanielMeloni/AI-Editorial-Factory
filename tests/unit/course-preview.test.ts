import { describe, expect, it } from 'vitest';

import { BRAND_PALETTE } from '@/lib/cover/brand';
import { buildCoursePreviewSvg } from '@/lib/courses/preview';

const corso = {
  title: 'Dataform dalle basi alla produzione',
  level: 'intermediate' as const,
  format: 'aula' as const,
  lessonCount: 8,
  lessonMinutes: 45,
  author: 'Daniel Meloni',
};

describe('anteprima del corso', () => {
  const svg = buildCoursePreviewSvg(corso);

  it('produce un SVG in sedici noni', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1280 720"');
  });

  it('scrive titolo, durata e autore come testo, non come immagine', () => {
    expect(svg).toContain('Dataform dalle basi alla produzione');
    expect(svg).toContain('8 lezioni');
    expect(svg).toContain('45 minuti');
    expect(svg).toContain('Daniel Meloni');
  });

  it('usa la palette della collana', () => {
    expect(svg).toContain(BRAND_PALETTE.navy);
    expect(svg).toContain(BRAND_PALETTE.blue);
  });

  it('è deterministica: stesso corso, stessa immagine', () => {
    expect(buildCoursePreviewSvg(corso)).toBe(svg);
  });

  it('neutralizza i caratteri XML del titolo', () => {
    const pericoloso = buildCoursePreviewSvg({ ...corso, title: '<script>alert(1)</script>' });
    expect(pericoloso).not.toContain('<script>');
    expect(pericoloso).toContain('&lt;script&gt;');
  });

  it('incorpora il logo solo quando c’è', () => {
    expect(svg).not.toContain('<image');
    const conLogo = buildCoursePreviewSvg({ ...corso, logoHref: 'data:image/png;base64,AAAA' });
    expect(conLogo).toContain('<image href="data:image/png;base64,AAAA"');
  });

  it('accorda il singolare quando la lezione è una sola', () => {
    expect(buildCoursePreviewSvg({ ...corso, lessonCount: 1 })).toContain('1 lezione ·');
  });

  it('non fa collidere gli identificatori di due corsi diversi', () => {
    const altro = buildCoursePreviewSvg({ ...corso, title: 'BigQuery in pratica' });
    const id = (valore: string) => /id="fondo-([a-z0-9]+)"/.exec(valore)?.[1];
    expect(id(svg)).not.toBe(id(altro));
  });
});
