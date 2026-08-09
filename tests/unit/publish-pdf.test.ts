import { describe, expect, it } from 'vitest';
import { exportPdf } from '@/lib/publish/pdf';
import type { ExportMeta } from '@/lib/publish/markdown';

const META: ExportMeta = {
  title: 'Incremental Tables',
  chapterNumber: 11,
  chapterLabel: 'Capitolo 11',
  author: 'Daniel Meloni',
  projectTitle: 'Dataform in Pratica',
  volume: 'Volume 1',
  versionNo: 3,
  exportedAt: '2026-08-09T12:00:00.000Z',
};

const CONTENUTO = `# Incremental Tables

Le tabelle incrementali elaborano **solo** le righe nuove, non l'intero storico.
Il risparmio si misura in *costo di scansione*.

## Configurazione

\`\`\`sqlx
config {
  type: "incremental",
  uniqueKey: ["id"]
}
select 1
\`\`\`

> [!NOTE]
> Senza condizione incrementale il vantaggio si annulla.

1. Dichiara il tipo
2. Aggiungi la condizione
3. Verifica con le asserzioni

- Prima voce
- Seconda voce

| Criterio | Tabella | Incrementale |
|---|---|---|
| Costo | alto | basso |

![Schema del flusso](assets/figura-a.png)

---

Vedi la [documentazione](https://cloud.google.com/dataform/docs).
`;

describe('esportazione PDF', () => {
  it('produce un PDF valido', async () => {
    const bytes = await exportPdf(CONTENUTO, META);

    // Firma di un file PDF: %PDF-
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it('termina con il marcatore di fine file', async () => {
    const bytes = await exportPdf('# Titolo\n\nTesto.', META);
    const coda = new TextDecoder('latin1').decode(bytes.slice(-32));
    expect(coda).toContain('%%EOF');
  }, 30_000);

  it('regge tutti i costrutti Markdown senza fallire', async () => {
    // Titoli, enfasi, codice, citazioni, elenchi ordinati e non, tabelle,
    // immagini, separatori e collegamenti: se uno mandasse in errore il
    // generatore, l'esportazione fallirebbe in produzione.
    const bytes = await exportPdf(CONTENUTO, META, {
      citations: [
        { url: 'https://cloud.google.com/dataform/docs', title: 'Documentazione', publisher: 'Google', isOfficial: true },
      ],
    });
    expect(bytes.byteLength).toBeGreaterThan(2000);
  }, 30_000);

  it('gestisce i caratteri accentati italiani', async () => {
    const bytes = await exportPdf('# Perché città è così\n\nAccènti: à è ì ò ù.', META);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it('non fallisce su un documento vuoto', async () => {
    const bytes = await exportPdf('', META);
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  }, 30_000);

  it('produce un documento più lungo per un contenuto più lungo', async () => {
    const breve = await exportPdf('# T\n\nUna riga.', META);
    const lungo = await exportPdf(
      `# T\n\n${Array.from({ length: 200 }, (_, i) => `Paragrafo numero ${i} con testo di prova.`).join('\n\n')}`,
      META,
    );
    expect(lungo.byteLength).toBeGreaterThan(breve.byteLength);
  }, 60_000);
});
