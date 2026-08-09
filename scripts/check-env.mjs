import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Verifica la configurazione di ambiente.
 *
 * Non stampa MAI il valore di una variabile: solo lunghezza, prefisso di pochi
 * caratteri ed esito dei controlli. Può essere eseguito e incollato altrove
 * senza rischio.
 *
 *     npm run check:env
 */

const FILE = join(process.cwd(), '.env.local');

const ok = (m) => console.log(`  [32m✓[0m ${m}`);
const ko = (m) => console.log(`  [31m✗[0m ${m}`);
const warn = (m) => console.log(`  [33m![0m ${m}`);

function mask(value) {
  if (value.length <= 12) return `${value.slice(0, 2)}… (${value.length} caratteri)`;
  return `${value.slice(0, 8)}…${value.slice(-4)} (${value.length} caratteri)`;
}

let raw;
try {
  raw = await readFile(FILE, 'utf8');
} catch {
  console.log('\nFile .env.local non trovato.\n');
  console.log('  Crealo copiando il modello:');
  console.log('      Copy-Item .env.example .env.local\n');
  console.log('  Poi compila i valori da Supabase → Project Settings → API Keys.');
  console.log('  Non mettere mai chiavi reali in .env.example: è tracciato da Git.\n');
  process.exit(1);
}

const env = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const index = trimmed.indexOf('=');
  if (index < 1) continue;
  env[trimmed.slice(0, index).trim()] = trimmed
    .slice(index + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

let errori = 0;
const fallisce = (m) => { ko(m); errori += 1; };

console.log('\n── URL dell’applicazione ────────────────────────────────────');
const appUrl = env.NEXT_PUBLIC_APP_URL ?? '';
if (!appUrl) fallisce('NEXT_PUBLIC_APP_URL mancante');
else {
  try {
    const parsed = new URL(appUrl);
    // new URL('localhost:3000') non fallisce: interpreta «localhost» come
    // schema. Serve un controllo esplicito sul protocollo.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      fallisce(`NEXT_PUBLIC_APP_URL manca lo schema: scrivi http://${appUrl} oppure https://${appUrl}`);
    } else {
      ok(`NEXT_PUBLIC_APP_URL = ${parsed.origin}`);
      if (appUrl.endsWith('/')) warn('Togli la barra finale: viene già aggiunta dove serve.');
    }
  } catch {
    fallisce('NEXT_PUBLIC_APP_URL non è un URL assoluto valido (atteso http:// o https://)');
  }
}

console.log('\n── Supabase ────────────────────────────────────────────────');
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
let projectRef = null;
if (!supaUrl) fallisce('NEXT_PUBLIC_SUPABASE_URL mancante');
else {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(supaUrl);
  if (match) {
    projectRef = match[1];
    ok(`NEXT_PUBLIC_SUPABASE_URL → project-ref «${projectRef}»`);
  } else if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(supaUrl)) {
    ok('NEXT_PUBLIC_SUPABASE_URL punta a un’istanza locale');
  } else {
    fallisce('NEXT_PUBLIC_SUPABASE_URL: attesa la forma https://<project-ref>.supabase.co');
  }
}

const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!publishable) fallisce('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY mancante');
else if (publishable.startsWith('sb_publishable_')) {
  ok(`Publishable key: ${mask(publishable)}`);
} else if (publishable.startsWith('eyJ')) {
  warn(`Sembra una anon key legacy (JWT): ${mask(publishable)} — funziona, ma le nuove chiavi sb_publishable_ sono preferibili.`);
  try {
    const payload = JSON.parse(Buffer.from(publishable.split('.')[1] ?? '', 'base64url').toString());
    if (payload.role && payload.role !== 'anon') {
      fallisce(`PERICOLO: questa chiave ha ruolo «${payload.role}», non «anon». Non deve stare in una variabile NEXT_PUBLIC_.`);
    }
    if (projectRef && payload.ref && payload.ref !== projectRef) {
      fallisce(`La chiave appartiene al progetto «${payload.ref}», l’URL a «${projectRef}».`);
    }
  } catch { /* payload non leggibile: nessuna conclusione */ }
} else if (publishable.startsWith('sb_secret_')) {
  fallisce('PERICOLO: qui c’è una SECRET key. Va in SUPABASE_SERVICE_ROLE_KEY, mai in una variabile NEXT_PUBLIC_.');
} else {
  fallisce(`Publishable key non riconosciuta: ${mask(publishable)}`);
}

const secret = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!secret) {
  warn('SUPABASE_SERVICE_ROLE_KEY assente: l’audit log resterà disattivato (tutto il resto funziona).');
} else if (secret.startsWith('sb_secret_')) {
  ok(`Secret key: ${mask(secret)}`);
} else if (secret.startsWith('eyJ')) {
  try {
    const payload = JSON.parse(Buffer.from(secret.split('.')[1] ?? '', 'base64url').toString());
    if (payload.role === 'service_role') ok(`Service role key legacy: ${mask(secret)}`);
    else fallisce(`SUPABASE_SERVICE_ROLE_KEY ha ruolo «${payload.role}»: attesa «service_role».`);
  } catch {
    fallisce('SUPABASE_SERVICE_ROLE_KEY non leggibile.');
  }
} else if (secret.startsWith('sb_publishable_')) {
  fallisce('Qui c’è la publishable key, non la secret key: le due sono invertite.');
} else {
  fallisce(`SUPABASE_SERVICE_ROLE_KEY non riconosciuta: ${mask(secret)}`);
}

if (publishable && secret && publishable === secret) {
  fallisce('Publishable key e secret key sono identiche: una delle due è stata incollata al posto sbagliato.');
}

console.log('\n── Provider AI ─────────────────────────────────────────────');
const testo = env.AI_TEXT_PROVIDER || 'mock';
const immagine = env.AI_IMAGE_PROVIDER || 'mock';

for (const [nome, valore, ammessi] of [
  ['AI_TEXT_PROVIDER', testo, ['mock', 'openai', 'anthropic']],
  ['AI_IMAGE_PROVIDER', immagine, ['mock', 'openai']],
]) {
  if (ammessi.includes(valore)) ok(`${nome} = ${valore}`);
  else fallisce(`${nome} = «${valore}»: ammessi ${ammessi.join(', ')}`);
}

if (testo === 'openai' && !env.OPENAI_API_KEY) fallisce('AI_TEXT_PROVIDER=openai ma OPENAI_API_KEY è vuota.');
if (testo === 'anthropic' && !env.ANTHROPIC_API_KEY) fallisce('AI_TEXT_PROVIDER=anthropic ma ANTHROPIC_API_KEY è vuota.');
if (immagine === 'openai' && !env.OPENAI_API_KEY) fallisce('AI_IMAGE_PROVIDER=openai ma OPENAI_API_KEY è vuota.');
if (testo === 'mock' && immagine === 'mock') ok('Modalità mock: nessun credito AI verrà consumato.');

console.log('\n── Igiene ──────────────────────────────────────────────────');
const esempio = await readFile(join(process.cwd(), '.env.example'), 'utf8').catch(() => '');
const compromesse = [];
for (const line of esempio.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const index = trimmed.indexOf('=');
  if (index < 1) continue;
  const chiave = trimmed.slice(0, index).trim();
  const valore = trimmed.slice(index + 1).trim();
  if (!valore) continue;
  if (/KEY$/.test(chiave) || chiave === 'NEXT_PUBLIC_SUPABASE_URL') compromesse.push(chiave);
}
if (compromesse.length > 0) {
  fallisce(`.env.example contiene valori reali (${compromesse.join(', ')}). È TRACCIATO DA GIT: svuotalo e ruota quelle chiavi.`);
} else {
  ok('.env.example contiene solo segnaposto.');
}

console.log(
  errori === 0
    ? '\n[32mConfigurazione valida.[0m Avvia con: npm run dev\n'
    : `\n[31m${errori} problem${errori === 1 ? 'a' : 'i'} da correggere.[0m\n`,
);
process.exit(errori === 0 ? 0 : 1);
