import { describe, expect, it } from 'vitest';
import { pickChildSitemaps } from '../../scripts/refresh-source-catalog.mjs';

/**
 * Lo script che allinea l'indice alle sitemap ufficiali.
 *
 * Il difetto che questo test blocca era silenzioso e per questo insidioso: lo
 * script scaricava l'indice delle sitemap, non trovava il nome del prodotto in
 * nessun file — si chiamano `sitemap_21_of_60.xml` — le scartava tutte e
 * riferiva «nessun indirizzo raccolto», facendo credere a un problema di rete.
 */

describe('scelta delle sitemap annidate', () => {
  it('le legge tutte quando i nomi non dicono nulla', () => {
    const generiche = [
      'https://docs.cloud.google.com/sitemap_21_of_60.xml',
      'https://docs.cloud.google.com/sitemap_9_of_60.xml',
      'https://docs.cloud.google.com/sitemap_3_of_60.xml',
    ];
    // Un nome che non dice nulla non autorizza a concludere che il contenuto
    // non interessi.
    expect(pickChildSitemaps(generiche)).toEqual(generiche);
  });

  it('si limita a quelle utili quando il nome nomina il prodotto', () => {
    const parlanti = [
      'https://esempio.org/sitemap-bigquery.xml',
      'https://esempio.org/sitemap-dataform.xml',
      'https://esempio.org/sitemap-compute.xml',
    ];
    expect(pickChildSitemaps(parlanti)).toEqual([
      'https://esempio.org/sitemap-bigquery.xml',
      'https://esempio.org/sitemap-dataform.xml',
    ]);
  });

  it('non inventa sitemap quando l’elenco è vuoto', () => {
    expect(pickChildSitemaps([])).toEqual([]);
  });
});
