// Scraper prezzi biglietti Gardaland (data selezionata = prezzo dinamico per giorno).
// Stesso metodo dello scraper Express: apre lo shop ufficiale per avere la sessione,
// poi chiama dayPerformance per ogni giorno di apertura e salva priceMin/priceMax e disponibilità.
// Uscita: gardaland-tickets-export.json nella radice del repository.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_FILE = path.join(ROOT, 'gardaland-tickets-export.json');
const HOURS_FILE = path.join(ROOT, 'opening-hours.json');

// Biglietti da leggere. Per aggiungerne uno: codice sellitemAk e eventAk dallo shop (F12 → Rete → dayPerformance).
const PRODUCTS = [
  {
    sellitemAk: 'WINTFIX',
    eventAk: 'GDL.EVN86',
    label: '1 Giorno Magic Winter - Data Selezionata',
    from: '2026-12-05',
    to: '2027-01-06'
  }
];

const SHOP_URL = 'https://tickets.gardaland.it/b2c/ticketSale/tickets?category=GPARK';
const API = 'https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/dayPerformance';
const PAUSE_MS = 1500;      // pausa tra una chiamata e l'altra
const MAX_DAYS = 60;        // giorni massimi letti per prodotto a ogni giro

const ymd = d => d.toISOString().slice(0, 10);
const todayRome = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Giorni da leggere: giorni di apertura di Gardaland (opening-hours.json) dentro il periodo del prodotto.
// Se gli orari non coprono il periodo, si provano tutti i giorni (i giorni chiusi danno errore e vengono saltati).
function datesFor(product, hours) {
  const start = [product.from, todayRome()].sort()[1];
  const end = product.to;
  const known = Object.keys(hours || {}).sort();
  const first = known[0] || '', last = known[known.length - 1] || '';
  const out = [];
  for (let d = new Date(start + 'T12:00:00Z'); ymd(d) <= end && out.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = ymd(d);
    const covered = first && day >= first && day <= last;
    if (!covered || hours[day]) out.push(day);
  }
  return out;
}

async function run() {
  const hours = readJson(HOURS_FILE, {}).gardaland || {};
  const existing = readJson(OUTPUT_FILE, {});
  const today = todayRome();

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
    locale: 'it-IT'
  });
  const page = await context.newPage();

  let csrf = null;
  page.on('request', r => { const h = r.headers(); if (h['x-csrf-token']) csrf = h['x-csrf-token']; });

  console.log('Apro lo shop Gardaland per la sessione...');
  try {
    await page.goto(SHOP_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);
  } catch (e) { console.error('Caricamento shop:', e.message); }
  if (!csrf) {
    const c = (await context.cookies()).find(x => x.name === 'app_session');
    if (c) csrf = c.value;
  }
  console.log(`Token sessione: ${csrf ? 'presente' : 'NON PRESENTE'}`);

  const out = { updatedAt: existing.updatedAt || null, source: 'https://tickets.gardaland.it', products: {} };
  let okCount = 0;

  for (const p of PRODUCTS) {
    const prev = existing.products?.[p.sellitemAk]?.days || {};
    const days = {};
    // Tieni i giorni già letti e non ancora passati (se oggi la lettura fallisce resta l'ultimo dato, con la sua data)
    Object.keys(prev).forEach(d => { if (d >= today) days[d] = prev[d]; });

    for (const day of datesFor(p, hours)) {
      const res = await page.evaluate(async ({ api, body, token }) => {
        try {
          const headers = { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json', 'X-API-KEY': '42' };
          if (token) headers['X-CSRF-Token'] = token;
          const r = await fetch(api, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
          if (!r.ok) return { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
          return { data: await r.json() };
        } catch (e) { return { error: e.message }; }
      }, {
        api: API,
        token: csrf,
        body: { day, eventAk: p.eventAk, locale: 'it-IT', searchAttributes: {}, sellitemAk: p.sellitemAk, useSumEnvelopeCapacity: false }
      });

      const perf = res.data?.performances?.[0];
      if (perf && (perf.priceMin != null || perf.priceMax != null)) {
        days[day] = {
          priceMin: perf.priceMin ?? null,   // ridotto
          priceMax: perf.priceMax ?? null,   // intero
          available: perf.availability?.available ?? null,
          total: perf.availability?.total ?? null,
          level: perf.availability?.level ?? null,
          checkedAt: new Date().toISOString()
        };
        okCount++;
        console.log(`OK ${p.sellitemAk} ${day}: ${perf.priceMin}–${perf.priceMax} €, liberi ${perf.availability?.available}`);
      } else {
        console.warn(`-- ${p.sellitemAk} ${day}: ${res.error || 'nessuna performance (giorno chiuso o non in vendita)'}`);
      }
      await page.waitForTimeout(PAUSE_MS);
    }

    out.products[p.sellitemAk] = { label: p.label, eventAk: p.eventAk, from: p.from, to: p.to, days };
  }

  await browser.close();

  // Se non è riuscita nessuna lettura, il file resta com'è (niente dati cancellati per un errore temporaneo)
  if (!okCount) {
    console.warn('Nessun prezzo letto: file non modificato.');
    return;
  }
  out.updatedAt = new Date().toISOString();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Salvato ${OUTPUT_FILE} (${okCount} giorni letti).`);
}

run().catch(e => { console.error(e); process.exit(1); });
