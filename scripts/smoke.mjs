/**
 * Collaudo HTTP contro un server reale.
 *
 * Verifica ciò che i test unitari non possono: intestazioni di sicurezza
 * effettivamente emesse, redirect delle rotte protette, assenza di
 * indicizzazione. Non sostituisce i test end-to-end con browser — verifica il
 * livello sotto, quello del protocollo.
 *
 *     npm run build && npm run test:smoke
 *
 * Il server viene avviato dallo script stesso su una porta dedicata.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

let passati = 0;
let falliti = 0;
let saltati = 0;

/**
 * La protezione delle rotte richiede una configurazione Supabase valida: senza,
 * il proxy non ha una sessione da verificare e lascia passare. Il collaudo lo
 * dichiara e salta quei controlli, invece di riportare fallimenti che non
 * dipendono dal codice.
 */
async function supabaseConfigurato() {
  try {
    const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
    return (
      /^NEXT_PUBLIC_SUPABASE_URL=\S+/m.test(env) &&
      /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\S+/m.test(env)
    );
  } catch {
    return false;
  }
}

function salta(descrizione, motivo) {
  saltati += 1;
  console.log(`  \u001b[33m\u2218\u001b[0m ${descrizione} \u2014 saltato: ${motivo}`);
}

function verifica(descrizione, condizione, dettaglio = '') {
  if (condizione) {
    passati += 1;
    console.log(`  [32m✓[0m ${descrizione}`);
  } else {
    falliti += 1;
    console.log(`  [31m✗[0m ${descrizione}${dettaglio ? ` — ${dettaglio}` : ''}`);
  }
}

async function attendiServer(tentativi = 90) {
  for (let i = 0; i < tentativi; i += 1) {
    try {
      const risposta = await fetch(`${BASE}/login`, { redirect: 'manual' });
      if (risposta.status > 0) return true;
    } catch {
      // il server non è ancora in ascolto
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Avvio del server.
 *
 * Su Windows `npm` è `npm.cmd`, e da Node 18 i file `.cmd` non si avviano senza
 * shell (restrizione introdotta con CVE-2024-27980). Il comando è una costante
 * di questo file, non input dell'utente: `shell: true` è sicuro qui.
 */
const isWindows = process.platform === 'win32';

const server = spawn('npm start', {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
  // Su POSIX il figlio diretto e' la shell, che a sua volta avvia npm e Next:
  // `detached` li raccoglie in un gruppo di processi terminabile in blocco.
  // Senza, il server sopravvivrebbe al collaudo occupando la porta.
  detached: !isWindows,
});

const registro = [];
server.stdout.on('data', (d) => registro.push(d.toString()));
server.stderr.on('data', (d) => registro.push(d.toString()));

server.on('error', (errore) => {
  console.error(`\nAvvio del server non riuscito: ${errore.message}`);
  console.error('Verifica di aver eseguito `npm run build` prima del collaudo.\n');
  process.exit(1);
});

/**
 * Terminazione dell'albero dei processi.
 *
 * Con `shell: true` il figlio diretto è la shell: ucciderla lascerebbe in vita
 * il server Next. Su Windows serve `taskkill /T`; altrove basta il gruppo di
 * processi, ma qui il figlio diretto è comunque la shell, quindi si termina
 * l'intero albero.
 */
async function terminaServer() {
  if (server.exitCode !== null || server.killed) return;

  if (isWindows && server.pid) {
    await new Promise((risolvi) => {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
        .on('close', risolvi)
        .on('error', risolvi);
    });
    return;
  }

  const uccidiGruppo = (segnale) => {
    try {
      // Il pid negativo indica il gruppo di processi, non il solo figlio.
      if (server.pid) process.kill(-server.pid, segnale);
    } catch {
      // Gruppo gia' terminato: nulla da fare.
    }
  };

  uccidiGruppo('SIGTERM');
  await Promise.race([
    new Promise((risolvi) => server.once('close', risolvi)),
    sleep(5000).then(() => uccidiGruppo('SIGKILL')),
  ]);
}

let codiceUscita = 0;

try {
  if (!(await attendiServer())) {
    console.error('\nIl server non si è avviato entro il tempo previsto.');
    console.error('Ultime righe del suo registro:\n');
    console.error(registro.join('').slice(-2000));
    console.error('\nCausa più frequente: manca `npm run build`, oppure la porta è occupata.\n');
    await terminaServer();
    process.exit(1);
  }

  console.log(`\nCollaudo HTTP su ${BASE}\n`);

  // -----------------------------------------------------------------------
  console.log('Intestazioni di sicurezza');
  const login = await fetch(`${BASE}/login`, { redirect: 'manual' });
  const h = login.headers;

  verifica('la pagina di accesso risponde 200', login.status === 200, `stato ${login.status}`);
  verifica("X-Content-Type-Options: nosniff", h.get('x-content-type-options') === 'nosniff');
  verifica("X-Frame-Options: DENY", h.get('x-frame-options') === 'DENY');
  verifica(
    'Referrer-Policy limitata',
    h.get('referrer-policy') === 'strict-origin-when-cross-origin',
  );
  verifica('Permissions-Policy disattiva i sensori', (h.get('permissions-policy') ?? '').includes('camera=()'));
  verifica('Cross-Origin-Opener-Policy: same-origin', h.get('cross-origin-opener-policy') === 'same-origin');
  verifica('nessuna intestazione X-Powered-By', h.get('x-powered-by') === null);

  const csp = h.get('content-security-policy') ?? '';
  verifica('CSP presente', csp.length > 0);
  verifica("CSP: frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
  verifica("CSP: object-src 'none'", csp.includes("object-src 'none'"));
  verifica("CSP: form-action 'self'", csp.includes("form-action 'self'"));
  verifica("CSP: base-uri 'self'", csp.includes("base-uri 'self'"));
  verifica('CSP: connessioni limitate a Supabase e origine', csp.includes('connect-src'));

  // -----------------------------------------------------------------------
  console.log('\nProtezione delle rotte');
  const configurato = await supabaseConfigurato();
  const motivo = 'configurazione Supabase assente in .env.local';
  const rotteProtette = ['/dashboard', '/projects', '/settings', '/projects/new'];

  if (!configurato) {
    for (const percorso of rotteProtette) salta(`${percorso} reindirizza al login`, motivo);
    salta('il redirect conserva la destinazione richiesta', motivo);
  } else {
    for (const percorso of rotteProtette) {
      const risposta = await fetch(`${BASE}${percorso}`, { redirect: 'manual' });
      const destinazione = risposta.headers.get('location') ?? '';
      verifica(
        `${percorso} reindirizza al login`,
        (risposta.status === 307 || risposta.status === 302) && destinazione.includes('/login'),
        `stato ${risposta.status}, destinazione ${destinazione || 'assente'}`,
      );
    }

    const conRitorno = await fetch(`${BASE}/projects/qualcosa`, { redirect: 'manual' });
    verifica(
      'il redirect conserva la destinazione richiesta',
      (conRitorno.headers.get('location') ?? '').includes('redirectTo'),
    );
  }

  // -----------------------------------------------------------------------
  console.log('\nIndicizzazione');
  const robots = await fetch(`${BASE}/robots.txt`);
  const testoRobots = await robots.text();
  verifica('robots.txt vieta la scansione', testoRobots.includes('Disallow: /'));
  verifica(
    'le pagine dichiarano noindex',
    (await (await fetch(`${BASE}/login`)).text()).includes('noindex'),
  );

  // -----------------------------------------------------------------------
  console.log('\nRotte interne del motore dei workflow');
  const flow = await fetch(`${BASE}/.well-known/workflow/v1/flow`, { redirect: 'manual' });
  verifica(
    'il percorso interno non viene dirottato al login',
    !(flow.headers.get('location') ?? '').includes('/login'),
    `stato ${flow.status}`,
  );

  // -----------------------------------------------------------------------
  console.log('\nGestione degli errori');
  const inesistente = await fetch(`${BASE}/pagina-che-non-esiste`, { redirect: 'manual' });
  verifica('una pagina inesistente risponde 404', inesistente.status === 404, `stato ${inesistente.status}`);

  console.log(
    `\n${passati} verifiche superate, ${falliti} fallite` +
      (saltati > 0 ? `, ${saltati} saltate.` : '.'),
  );
  if (saltati > 0) {
    console.log(
      '\nPer eseguire anche i controlli saltati, compila .env.local con i valori\n' +
        'di Supabase e ripeti il collaudo.',
    );
  }
  console.log('');
  codiceUscita = falliti === 0 ? 0 : 1;
} catch (errore) {
  console.error(`\nCollaudo interrotto: ${errore.message}\n`);
  codiceUscita = 1;
} finally {
  // `process.exit()` non esegue il blocco finally: il server va terminato
  // prima di uscire, altrimenti resta in ascolto sulla porta.
  await terminaServer();
}

process.exit(codiceUscita);
