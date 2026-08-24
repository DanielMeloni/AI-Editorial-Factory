'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, Ruler, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { confirmManualCoverPanel, generateCoverArtwork, requestManualCoverPanelTicket, saveCover } from '@/lib/visual/actions';
import { createClient } from '@/lib/supabase/client';
import { AssetCard } from '@/components/visual/asset-card';
import { CoverReferences } from '@/components/visual/cover-references';
import { ToolLogo } from '@/components/visual/tool-logo';
import {
  SPINE_FORMULAS,
  SPINE_FORMULA_HINTS,
  SPINE_FORMULA_LABELS,
  calculateSpine,
  canLockSpine,
  type SpineFormula,
} from '@/lib/cover/spine';
import { buildCoverPreviewSvg, computeCoverLayout, type CoverComposition } from '@/lib/cover/layout';
import { toIsbn13 } from '@/lib/cover/barcode';
import type { CoverArtworkRow, CoverRow } from '@/lib/visual/queries';

export function CoverStudio({
  projectId,
  volumeId,
  cover,
  artwork,
  references,
  logo,
  defaults,
}: {
  projectId: string;
  volumeId: string | null;
  cover: CoverRow | null;
  artwork: CoverArtworkRow[];
  references: CoverArtworkRow[];
  logo: CoverArtworkRow | null;
  defaults: {
    title: string; subtitle: string | null; author: string;
    seriesName: string | null; volumeLabel: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [trimW, setTrimW] = useState(cover?.trim_width_mm ?? 170);
  const [trimH, setTrimH] = useState(cover?.trim_height_mm ?? 240);
  const [bleed, setBleed] = useState(cover?.bleed_mm ?? 3);
  const [safety, setSafety] = useState(cover?.safety_margin_mm ?? 5);
  const [pagine, setPagine] = useState<string>(cover?.page_count?.toString() ?? '');
  const [carta, setCarta] = useState(cover?.paper_type ?? '');
  const [formula, setFormula] = useState<SpineFormula>(cover?.spine_formula ?? 'mm_per_page');
  const [fattore, setFattore] = useState<string>(cover?.spine_factor?.toString() ?? '');

  // Quale proposta si sta guardando, per pannello.
  //
  // Si parte da ciò che è agganciato alla copertina; se non c'è aggancio ma
  // esiste una grafica **approvata**, si apre su quella. Un'anteprima vuota
  // accanto a un'immagine già approvata è un'anteprima che mente: qualcuno ha
  // guardato e ha detto sì, e il posto dove si vede il risultato deve mostrarlo.
  const approvataPerTipo = useMemo(() => {
    const scelta: Record<string, string | null> = {};
    for (const kind of ['cover_front', 'cover_spine', 'cover_back']) {
      // `artwork` arriva ordinato per versione decrescente: la prima approvata
      // che si incontra è la più recente.
      const trovata = artwork.find(
        ({ asset }) => asset.kind === kind && asset.status === 'approved',
      );
      scelta[kind] = trovata?.asset.id ?? null;
    }
    return scelta;
  }, [artwork]);

  const [selezione, setSelezione] = useState<Record<string, string | null>>({
    cover_front: cover?.front_asset_id ?? approvataPerTipo.cover_front ?? null,
    cover_spine: cover?.spine_asset_id ?? approvataPerTipo.cover_spine ?? null,
    cover_back: cover?.back_asset_id ?? approvataPerTipo.cover_back ?? null,
  });

  const grafiche = useMemo(() => {
    const per = (kind: string) => {
      const scelto = artwork.find(({ asset }) => asset.id === selezione[kind]);
      return scelto?.signedUrl ?? null;
    };
    return {
      // Il preset è un vero fondo editoriale, non un pannello piatto. Appena
      // si prova o approva una generazione, l'asset del volume lo sostituisce.
      front: per('cover_front') ?? '/cover-presets/technical-series-front.png',
      spine: per('cover_spine'),
      back: per('cover_back') ?? '/cover-presets/technical-series-back.png',
    };
  }, [artwork, selezione]);

  // La configurazione del manuale/volume è la fonte di verità dei testi.
  const titolo = defaults.title;
  const sottotitolo = defaults.subtitle ?? '';
  const titoliAutomatici = useMemo(() => dividiTitolo(titolo), [titolo]);
  const [titoloRiga1, setTitoloRiga1] = useState(cover?.title_line_1 ?? titoliAutomatici[0]);
  const [titoloRiga2, setTitoloRiga2] = useState(cover?.title_line_2 ?? titoliAutomatici[1]);
  const [descrizioneFronte, setDescrizioneFronte] = useState(cover?.front_description ?? '');
  const [colorePrimario, setColorePrimario] = useState(cover?.accent_color ?? '#2f7df6');
  const [coloreSecondario, setColoreSecondario] = useState(cover?.accent_color_secondary ?? '#22d3ee');
  const [nomeStrumento, setNomeStrumento] = useState(cover?.tool_name ?? titolo.split(/\s+in\s+/i)[0] ?? '');
  const [autore, setAutore] = useState(cover?.author || defaults.author);
  const [collana, setCollana] = useState(cover?.series_name ?? defaults.seriesName ?? '');
  const [quarta, setQuarta] = useState(cover?.back_description ?? '');
  const [bio, setBio] = useState(cover?.biography ?? '');
  const [isbn, setIsbn] = useState(cover?.isbn ?? '');
  const [prezzo, setPrezzo] = useState<string>(cover?.price?.toString() ?? '');
  const savedComposition = (cover?.composition ?? {}) as CoverComposition;
  const [frontOverlay, setFrontOverlay] = useState(savedComposition.frontOverlay ?? true);
  const [backOverlay, setBackOverlay] = useState(savedComposition.backOverlay ?? false);
  const [spineOverlay, setSpineOverlay] = useState(savedComposition.spineOverlay ?? true);
  const [bottomBrand, setBottomBrand] = useState(savedComposition.showBottomBrand ?? true);
  const [fontSizes, setFontSizes] = useState({
    series: savedComposition.sizes?.series ?? 3.2,
    author: savedComposition.sizes?.author ?? 5.2,
    title: savedComposition.sizes?.title ?? 18,
    volume: savedComposition.sizes?.volume ?? 4.3,
    subtitle: savedComposition.sizes?.subtitle ?? 4.4,
    description: savedComposition.sizes?.description ?? 3.5,
    toolName: savedComposition.sizes?.toolName ?? 5.5,
  });
  const [textColors, setTextColors] = useState({
    series: savedComposition.colors?.series ?? '#93c5fd',
    title1: savedComposition.colors?.title1 ?? '#f8fafc',
    volume: savedComposition.colors?.volume ?? '#ffffff',
    subtitle: savedComposition.colors?.subtitle ?? '#cbd5e1',
    description: savedComposition.colors?.description ?? '#cbd5e1',
    author: savedComposition.colors?.author ?? '#f8fafc',
    toolName: savedComposition.colors?.toolName ?? '#f8fafc',
  });

  // --- Dorso --------------------------------------------------------------
  const numeroPagine = pagine.trim() === '' ? null : Number(pagine);
  const numeroFattore = fattore.trim() === '' ? null : Number(fattore);

  const dorso = useMemo(() => {
    if (numeroPagine === null || numeroFattore === null) return null;
    return calculateSpine({
      formula,
      factor: numeroFattore,
      pageCount: numeroPagine,
      coverThicknessMm: 0,
    });
  }, [formula, numeroFattore, numeroPagine]);

  const spineMm = dorso?.ok ? dorso.spineMm : 0;
  const definitivo = canLockSpine(numeroPagine, dorso?.ok ? dorso.spineMm : null);

  // --- ISBN ---------------------------------------------------------------
  // L'ISBN resta un dato della copertina — serve a chi la stampa e a chi la
  // distribuisce — ma non viene composto sul foglio: nessun codice a barre.
  // Viene comunque validato, perché un ISBN sbagliato in scheda è sbagliato
  // ovunque finisca dopo.
  const isbnValido = useMemo(() => (isbn.trim() ? toIsbn13(isbn) !== null : true), [isbn]);

  // --- Anteprima ----------------------------------------------------------
  const anteprima = useMemo(() => {
    const layout = computeCoverLayout({
      trimWidthMm: trimW || 1,
      trimHeightMm: trimH || 1,
      spineMm,
      bleedMm: bleed,
      safetyMarginMm: safety,
    });

    return {
      layout,
      svg: buildCoverPreviewSvg(
        layout,
        {
          title: titolo,
          titleLine1: titoloRiga1,
          titleLine2: titoloRiga2,
          subtitle: sottotitolo || null,
          frontDescription: descrizioneFronte || null,
          toolName: nomeStrumento || null,
          author: autore,
          seriesName: collana || null,
          volumeLabel: defaults.volumeLabel,
          backDescription: quarta || null,
          biography: bio || null,
        },
        {
          showGuides: true,
          artwork: grafiche,
          logoHref: logo?.signedUrl ?? null,
          accent: { primary: colorePrimario, secondary: coloreSecondario },
          composition: {
            frontOverlay, backOverlay, spineOverlay, showBottomBrand: bottomBrand,
            sizes: fontSizes, colors: textColors,
          },
        },
      ),
    };
  }, [trimW, trimH, spineMm, bleed, safety, titolo, titoloRiga1, titoloRiga2, sottotitolo, descrizioneFronte, nomeStrumento, colorePrimario, coloreSecondario, autore, collana, quarta, bio, grafiche, logo, defaults.volumeLabel, frontOverlay, backOverlay, spineOverlay, bottomBrand, fontSizes, textColors]);

  function caricaPannello(kind: 'cover_front' | 'cover_spine' | 'cover_back', file?: File) {
    if (!file) return;
    startTransition(async () => {
      const ticket = await requestManualCoverPanelTicket({
        projectId, kind, filename: file.name, byteSize: file.size, mimeType: file.type,
      });
      if (!ticket.ok) { toast.error(ticket.message); return; }
      const { error } = await createClient().storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file);
      if (error) { toast.error(`Caricamento non riuscito: ${error.message}`); return; }
      const result = await confirmManualCoverPanel({
        projectId, kind, assetId: ticket.assetId, path: ticket.path, filename: file.name,
      });
      if (!result.ok) { toast.error(result.message); return; }
      setSelezione((current) => ({ ...current, [kind]: ticket.assetId }));
      if (kind === 'cover_front') setFrontOverlay(false);
      if (kind === 'cover_back') setBackOverlay(false);
      if (kind === 'cover_spine') setSpineOverlay(false);
      toast.success(`${result.message} Gli elementi sovrapposti del pannello sono stati nascosti.`);
      router.refresh();
    });
  }

  function generaGrafica() {
    startTransition(async () => {
      const esito = await generateCoverArtwork(projectId, volumeId);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  const avvioCopertina = useRef(false);
  useEffect(() => {
    if (cover || artwork.length > 0 || avvioCopertina.current) return;
    avvioCopertina.current = true;
    startTransition(async () => {
      const esito = await generateCoverArtwork(projectId, volumeId);
      if (esito.ok) toast.success('Copertina iniziale generata dai dati del manuale.');
      else toast.error(esito.message);
      router.refresh();
    });
  }, [artwork.length, cover, projectId, router, volumeId]);

  function salva() {
    startTransition(async () => {
      const esito = await saveCover({
        projectId,
        trimWidthMm: trimW,
        trimHeightMm: trimH,
        bleedMm: bleed,
        safetyMarginMm: safety,
        pageCount: numeroPagine,
        paperType: carta || null,
        spineFormula: formula,
        spineFactor: numeroFattore,
        title: titolo,
        titleLine1: titoloRiga1 || null,
        titleLine2: titoloRiga2 || null,
        subtitle: sottotitolo || null,
        frontDescription: descrizioneFronte || null,
        accentColor: colorePrimario,
        accentColorSecondary: coloreSecondario,
        toolName: nomeStrumento || null,
        author: autore,
        seriesName: collana || null,
        backDescription: quarta || null,
        biography: bio || null,
        isbn: isbn || null,
        price: prezzo.trim() === '' ? null : Number(prezzo),
        frontAssetId: selezione.cover_front ?? null,
        spineAssetId: selezione.cover_spine ?? null,
        backAssetId: selezione.cover_back ?? null,
        composition: {
          frontOverlay, backOverlay, spineOverlay, showBottomBrand: bottomBrand,
          sizes: fontSizes, colors: textColors,
        },
      });

      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  const num = (setter: (value: number) => void) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setter(Number(event.target.value));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Copertina manuale</CardTitle>
            <CardDescription>
              Carica separatamente pannelli già pronti. L’immagine riempie il pannello senza
              sovrapposizioni; puoi riattivarle singolarmente nella sezione composizione.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {([
              ['cover_front', 'Fronte'], ['cover_spine', 'Dorso'], ['cover_back', 'Retro'],
            ] as const).map(([kind, label]) => (
              <label key={kind} className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-4 text-center text-sm hover:bg-surface-muted">
                <ImageUp className="size-5 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">Carica {label.toLowerCase()}</span>
                <span className="text-xs text-muted-foreground">PNG, JPEG o WebP</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={pending}
                  onChange={(e) => { caricaPannello(kind, e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Composizione e stile</CardTitle>
            <CardDescription>Nascondi gli elementi sui pannelli già impaginati e regola font e colori del fronte.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['Elementi sul fronte', frontOverlay, setFrontOverlay],
                ['Elementi sul retro', backOverlay, setBackOverlay],
                ['Testo sul dorso', spineOverlay, setSpineOverlay],
                ['Logo e nome in fondo', bottomBrand, setBottomBrand],
              ].map(([label, checked, setter]) => (
                <label key={label as string} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked as boolean} onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)} />
                  {label as string}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(fontSizes) as Array<keyof typeof fontSizes>).map((key) => (
                <Field key={key} id={`font-${key}`} label={`Dimensione ${etichettaStile(key)}`}>
                  {({ id }) => <Input id={id} type="number" min="1" max="40" step="0.1" value={fontSizes[key]}
                    onChange={(e) => setFontSizes((v) => ({ ...v, [key]: Number(e.target.value) }))} />}
                </Field>
              ))}
              {(Object.keys(textColors) as Array<keyof typeof textColors>).map((key) => (
                <Field key={key} id={`color-${key}`} label={`Colore ${etichettaStile(key)}`}>
                  {({ id }) => <Input id={id} type="color" value={textColors[key]}
                    onChange={(e) => setTextColors((v) => ({ ...v, [key]: e.target.value }))} />}
                </Field>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
              Formato e stampa
            </CardTitle>
            <CardDescription>Misure in millimetri, al netto dell’abbondanza.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="trimW" label="Larghezza pagina">
              {({ id }) => <Input id={id} type="number" min={1} value={trimW} onChange={num(setTrimW)} />}
            </Field>
            <Field id="trimH" label="Altezza pagina">
              {({ id }) => <Input id={id} type="number" min={1} value={trimH} onChange={num(setTrimH)} />}
            </Field>
            <Field id="bleed" label="Abbondanza" hint="Fascia rifilata dopo la stampa.">
              {({ id, describedBy }) => (
                <Input id={id} type="number" min={0} step={0.5} value={bleed} onChange={num(setBleed)} aria-describedby={describedBy} />
              )}
            </Field>
            <Field id="safety" label="Margine di sicurezza" hint="Distanza minima del testo dal taglio.">
              {({ id, describedBy }) => (
                <Input id={id} type="number" min={0} step={0.5} value={safety} onChange={num(setSafety)} aria-describedby={describedBy} />
              )}
            </Field>
            <Field id="carta" label="Tipo di carta">
              {({ id }) => (
                <Input id={id} value={carta} onChange={(e) => setCarta(e.target.value)} placeholder="Usomano 90 g/m²" />
              )}
            </Field>
            <Field id="pagine" label="Numero di pagine" hint="Il dorso resta provvisorio finché non è definitivo.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  value={pagine}
                  onChange={(e) => setPagine(e.target.value.replace(/[^0-9]/g, ''))}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Dorso</CardTitle>
            <CardDescription>
              Non esiste un valore universale: dipende dalla carta e dal fornitore di stampa. Prendi
              il fattore dalle sue specifiche.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Formula</legend>
              <div className="space-y-1.5">
                {SPINE_FORMULAS.map((f) => (
                  <label key={f} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="spine-formula"
                      value={f}
                      checked={formula === f}
                      onChange={() => setFormula(f)}
                      className="mt-1 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="font-medium">{SPINE_FORMULA_LABELS[f]}</span>
                      <span className="block text-xs text-muted-foreground">
                        {SPINE_FORMULA_HINTS[f]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field id="fattore" label="Fattore" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.0001"
                  min={0}
                  value={fattore}
                  onChange={(e) => setFattore(e.target.value)}
                  placeholder={formula === 'pages_per_inch' ? '400' : formula === 'fixed' ? '18.5' : '0.1'}
                />
              )}
            </Field>

            {dorso === null ? (
              <Alert tone="warning">
                Inserisci numero di pagine e fattore per calcolare il dorso.
              </Alert>
            ) : dorso.ok ? (
              <Alert tone={definitivo ? 'success' : 'info'} title={`Dorso: ${dorso.spineMm} mm`}>
                {dorso.breakdown}
                <span className="mt-1 block">
                  {definitivo
                    ? 'Il calcolo è definitivo per il numero di pagine indicato. Se le pagine cambiano, il dorso cambia.'
                    : 'Valore provvisorio.'}
                </span>
              </Alert>
            ) : (
              <Alert tone="danger">{dorso.reason}</Alert>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Testi</CardTitle>
            <CardDescription>
              Composti programmaticamente sopra l’immagine, non generati dentro di essa: solo così
              restano leggibili e verificabili. Titolo e sottotitolo provengono dalla configurazione
              del manuale selezionato.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="titolo" label="Titolo" required>
              {({ id }) => <Input id={id} value={titolo} readOnly />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="titolo-riga-1" label="Titolo · prima riga" hint="Circa l’80% della larghezza del fronte.">
                {({ id, describedBy }) => <Input id={id} value={titoloRiga1} onChange={(e) => setTitoloRiga1(e.target.value)} aria-describedby={describedBy} />}
              </Field>
              <Field id="titolo-riga-2" label="Titolo · seconda riga" hint="Usa il gradiente della palette.">
                {({ id, describedBy }) => <Input id={id} value={titoloRiga2} onChange={(e) => setTitoloRiga2(e.target.value)} aria-describedby={describedBy} />}
              </Field>
            </div>
            <Field id="sottotitolo" label="Sottotitolo">
              {({ id }) => <Input id={id} value={sottotitolo} readOnly />}
            </Field>
            <Field id="descrizione-fronte" label="Breve descrizione sul fronte">
              {({ id }) => <textarea id={id} value={descrizioneFronte} onChange={(e) => setDescrizioneFronte(e.target.value)} rows={3} className="w-full rounded-lg border border-border-strong bg-surface p-2 text-sm" />}
            </Field>
            <Field id="nome-strumento" label="Nome dello strumento" hint="Mostrato accanto al logo in fondo al fronte.">
              {({ id, describedBy }) => <Input id={id} value={nomeStrumento} onChange={(e) => setNomeStrumento(e.target.value)} aria-describedby={describedBy} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="colore-primario" label="Colore primario">
                {({ id }) => <Input id={id} type="color" value={colorePrimario} onChange={(e) => setColorePrimario(e.target.value)} />}
              </Field>
              <Field id="colore-secondario" label="Colore gradiente">
                {({ id }) => <Input id={id} type="color" value={coloreSecondario} onChange={(e) => setColoreSecondario(e.target.value)} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="autore" label="Autore" required>
                {({ id }) => <Input id={id} value={autore} onChange={(e) => setAutore(e.target.value)} />}
              </Field>
              <Field id="collana" label="Collana">
                {({ id }) => <Input id={id} value={collana} onChange={(e) => setCollana(e.target.value)} />}
              </Field>
            </div>
            <Field id="quarta" label="Testo di quarta">
              {({ id }) => (
                <textarea
                  id={id}
                  value={quarta}
                  onChange={(e) => setQuarta(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border-strong bg-surface p-2 text-sm"
                />
              )}
            </Field>
            <Field id="bio" label="Biografia dell’autore">
              {({ id }) => (
                <textarea
                  id={id}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border-strong bg-surface p-2 text-sm"
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="isbn"
                label="ISBN"
                hint="ISBN-10 o ISBN-13. La cifra di controllo viene verificata. Non viene stampato in copertina."
                error={isbnValido ? undefined : 'ISBN non valido: la cifra di controllo non torna.'}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    value={isbn}
                    onChange={(e) => setIsbn(e.target.value)}
                    aria-describedby={describedBy}
                    invalid={!isbnValido}
                  />
                )}
              </Field>
              <Field id="prezzo" label="Prezzo">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    step="0.01"
                    min={0}
                    value={prezzo}
                    onChange={(e) => setPrezzo(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Riferimenti visivi</CardTitle>
            <CardDescription>
              Le immagini da cui parte la generazione. Fissano stile, palette e composizione —
              ciò che un prompt scritto trasmette peggio. Non entrano nel libro e non passano
              da un’approvazione: sono direzione, non contenuto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CoverReferences projectId={projectId} references={references} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Logo dello strumento</CardTitle>
            <CardDescription>
              Caricato con le fonti, in fase di input. Viene composto sul fronte, in basso a
              destra, sopra l’immagine: è l’unico marchio che arriva in copertina così com’è.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolLogo projectId={projectId} logo={logo} />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} onClick={salva}>
            <Save aria-hidden="true" />
            {pending ? 'Salvataggio…' : 'Salva copertina'}
          </Button>

          <Button variant="secondary" disabled={pending} onClick={generaGrafica}>
            <Sparkles aria-hidden="true" />
            {pending ? 'Generazione…' : 'Genera la grafica'}
          </Button>
        </div>

        {!cover && !pending ? (
          <p className="text-xs text-muted-foreground">
            La copertina iniziale viene creata automaticamente usando titolo, sottotitolo e
            metadati del volume corrente.
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Grafiche generate</CardTitle>
            <CardDescription>
              Selezionane una per vederla nell’anteprima: è una prova, non una scelta, e nulla
              viene scritto. Approvandola diventa la grafica della copertina e sostituisce la
              precedente. Nessuna contiene testo né marchi: titolo, autore e logo restano
              elementi composti sopra all’immagine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {artwork.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessuna grafica generata. L’anteprima qui accanto usa i colori di riserva.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {artwork.map(({ asset, signedUrl }) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    signedUrl={signedUrl ?? undefined}
                    inAnteprima={selezione[asset.kind] === asset.id}
                    onPreview={(scelto) =>
                      setSelezione((precedente) => ({
                        ...precedente,
                        [scelto.kind]: precedente[scelto.kind] === scelto.id ? null : scelto.id,
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --------------------------------------------------------------- */}
      <div className="space-y-4">
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              Anteprima completa
              <Badge tone="neutral">
                {anteprima.layout.totalWidthMm} × {anteprima.layout.totalHeightMm} mm
              </Badge>
              {definitivo ? <Badge tone="success">dorso definitivo</Badge> : null}
            </CardTitle>
            <CardDescription>
              Quarta di copertina · dorso · fronte. Rosso: linea di taglio. Verde: margine di
              sicurezza. Giallo: pieghe del dorso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="overflow-hidden rounded-lg border border-border-subtle bg-white"
              // L'anteprima è costruita interamente da questo codice a partire da
              // valori già validati: nessun contenuto esterno viene interpretato.
              dangerouslySetInnerHTML={{ __html: anteprima.svg }}
            />

            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Foglio', `${anteprima.layout.totalWidthMm} × ${anteprima.layout.totalHeightMm} mm`],
                ['Rifilato', `${anteprima.layout.trimBox.width} × ${anteprima.layout.trimBox.height} mm`],
                ['Dorso', spineMm > 0 ? `${spineMm} mm` : 'da calcolare'],
                ['Abbondanza', `${bleed} mm`],
              ].map(([etichetta, valore]) => (
                <div key={etichetta} className="rounded bg-surface-muted p-2">
                  <dt className="text-muted-foreground">{etichetta}</dt>
                  <dd className="font-medium text-foreground">{valore}</dd>
                </div>
              ))}
            </dl>

            {anteprima.layout.spineTooNarrowForText ? (
              <Alert tone="warning">
                Il dorso è troppo stretto per ospitare testo leggibile: viene lasciato vuoto.
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function dividiTitolo(titolo: string): [string, string] {
  const parole = titolo.trim().split(/\s+/);
  if (parole.length < 2) return [titolo, ''];
  let punto = 1;
  let differenza = Number.POSITIVE_INFINITY;
  for (let indice = 1; indice < parole.length; indice += 1) {
    const corrente = Math.abs(parole.slice(0, indice).join(' ').length - parole.slice(indice).join(' ').length);
    if (corrente < differenza) { differenza = corrente; punto = indice; }
  }
  return [parole.slice(0, punto).join(' '), parole.slice(punto).join(' ')];
}

function etichettaStile(key: string): string {
  return ({
    series: 'collana', author: 'autore', title: 'titolo', title1: 'prima riga', volume: 'volume',
    subtitle: 'sottotitolo', description: 'descrizione', toolName: 'nome strumento',
  } as Record<string, string>)[key] ?? key;
}
