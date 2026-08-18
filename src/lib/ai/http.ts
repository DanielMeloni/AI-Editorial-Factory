/**
 * Diagnostica delle risposte HTTP dei provider.
 *
 * Un codice di stato nudo — «400» — non distingue un modello inesistente da un
 * credito esaurito o da un parametro rifiutato. Quella differenza è nel corpo
 * della risposta, ed è l'unica informazione che rende l'errore azionabile:
 * scartarla lascia chi legge davanti a un guasto opaco.
 */

/** Messaggio d'errore leggibile estratto dal corpo della risposta. */
export async function readErrorDetail(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return '';
  }
  if (!body.trim()) return '';

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; type?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') return truncate(parsed.error);
    const message = parsed.error?.message ?? parsed.message;
    if (message) {
      const type = parsed.error?.type;
      return truncate(type && type !== 'error' ? `${type} — ${message}` : message);
    }
  } catch {
    // Corpo non JSON: si riporta così com'è, troncato.
  }
  return truncate(body);
}

function truncate(value: string, max = 400): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
