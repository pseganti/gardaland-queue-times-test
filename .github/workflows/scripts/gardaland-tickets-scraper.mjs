// Scraper prezzi biglietti Gardaland.
// 1) sellitems: elenco dei biglietti in vendita (codice, titolo, prezzo adulto "a partire da", calendario sì/no)
// 2) sellitem: per ogni biglietto con calendario, prezzo min/max e posti liberi di tutti i giorni in vendita
//    (una chiamata per mese, la stessa che usa il calendario dello shop)
// Stesso metodo dello scraper Express: apre lo shop ufficiale per avere la sessione, poi chiama l'API.
// Uscita: gardaland-tickets-export.json nella radice del repository.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_FILE = path.join(ROOT, 'gardaland-tickets-export.json');

const CATEGORY = 'GPARK';
const SHOP_URL = `https://tickets.gardaland.it/b2c/ticketSale/tickets?category=${CATEGORY.toLowerCase()}`;
const API = 'https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1';
const PAUSE_MS = 1500;   // pausa tra una chiamata e l'altra
const MONTHS_AHEAD = 4;  // mesi letti per biglietto (mese corrente + 3)

// Se l'elenco sellitems non risponde, si leggono almeno questi biglietti con calendario
const FALLBACK_DATED = [{ code: 'WINTFIX', eventAk: 'GDL.EVN86', title: '1 GIORNO MAGIC WINTER - Data Selezionata' }];

const ymd = d => d.toISOString().slice(0, 10);
const todayRome = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
// "€ 12,50" → 12.5 ; prezzo 0 o non leggibile → null
const toPrice = v => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Finestre mensili da leggere: dal primo del mese corrente, un mese per volta
function monthWindows() {
  const [y, m] = todayRome().split('-').map(Number);
  const out = [];
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const from = new Date(Date.UTC(y, m - 1 + i, 1));
    const to = new Date(Date.UTC(y, m + i, 1));
    out.push([ymd(from), ymd(to)]);
  }
  return out;
}

async function run() {
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

  // Chiamata all'API dall'interno della pagina dello shop (stessa sessione del browser)
  const call = (url, method, body) => page.evaluate(async ({ url, method, body, token }) => {
    try {
      const headers = { 'Accept': 'application/json, text/plain, */*', 'X-API-KEY': '42' };
      if (body) headers['Content-Type'] = 'application/json';
      if (token) headers['X-CSRF-Token'] = token;
      const r = await fetch(url, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) return { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
      return { data: await r.json() };
    } catch (e) { return { error: e.message }; }
  }, { url, method, body, token: csrf });

  let okCount = 0;
  const now = () => new Date().toISOString();

  // ── 1) Elenco biglietti in vendita ──
  let catalog = existing.catalog || null;
  const list = await call(`${API}/sellitems?locale=it-IT&category=${CATEGORY}&extraImage=true`, 'GET');
  if (Array.isArray(list.data?.sellitem)) {
    catalog = {
      checkedAt: now(),
      items: list.data.sellitem.map(s => ({
        code: s.code,
        title: s.fields?.title || s.code,
        tagline: s.fields?.tagline || null,
        price: toPrice(s.fields?.price),          // prezzo adulto "a partire da"
        priceLabel: s.fields?.priceLabel || null,
        hasCalendar: !!s.hasCalendar,
        eventAk: s.eventAk || null
      }))
    };
    okCount++;
    catalog.items.forEach(i => console.log(`Elenco: ${i.code} | ${i.title} | ${i.price ?? '-'} € | calendario: ${i.hasCalendar}`));
  } else {
    console.warn('sellitems non letto:', list.error || 'risposta inattesa');
  }

  // ── 2) Prezzi per giorno dei biglietti con calendario ──
  const dated = (catalog?.items || []).filter(i => i.hasCalendar && i.eventAk);
  const toRead = dated.length ? dated : FALLBACK_DATED;
  const products = {};

  for (const p of toRead) {
    const prevDays = existing.products?.[p.code]?.days || {};
    const out = {};
    // Tieni i giorni già letti e non passati: se oggi la lettura fallisce resta l'ultimo dato, con la sua data
    Object.keys(prevDays).forEach(d => { if (d >= today) out[d] = prevDays[d]; });

    const seen = new Set();   // giorni restituiti dallo shop in questo giro
    const readWindows = [];   // mesi letti con successo
    for (const [dateFrom, dateTo] of monthWindows()) {
      const res = await call(`${API}/sellitem`, 'POST', {
        locale: 'it-IT', dateFrom, dateTo, searchAttributes: {}, useSumEnvelopeCapacity: false, code: p.code
      });
      const list = res.data?.days;
      if (Array.isArray(list)) {
        list.forEach(d => {
          if (!d.date || d.date < today) return;
          seen.add(d.date);
          out[d.date] = {
            priceMin: toPrice(d.priceMin),   // ridotto (null = prezzo non disponibile)
            priceMax: toPrice(d.priceMax),   // intero
            available: d.availability?.available ?? null,
            total: d.availability?.total ?? null,
            level: d.availability?.level ?? null,
            checkedAt: now()
          };
        });
        readWindows.push([dateFrom, dateTo]);
        okCount++;
        console.log(`OK ${p.code} ${dateFrom}→${dateTo}: ${list.length} giorni in vendita`);
      } else {
        console.warn(`-- ${p.code} ${dateFrom}→${dateTo}: ${res.error || 'risposta senza giorni'}`);
      }
      await page.waitForTimeout(PAUSE_MS);
    }
    // Un giorno che prima c'era e ora lo shop non restituisce più (tolto dalla vendita o esaurito) viene rimosso,
    // ma solo nei mesi letti con successo
    Object.keys(out).forEach(d => {
      if (!seen.has(d) && readWindows.some(([f, t]) => d >= f && d <= t)) delete out[d];
    });
    products[p.code] = { title: p.title, eventAk: p.eventAk, days: out };
  }

  await browser.close();

  // Se non è riuscita nessuna lettura, il file resta com'è (niente dati cancellati per un errore temporaneo)
  if (!okCount) {
    console.warn('Nessun dato letto: file non modificato.');
    return;
  }
  const result = { updatedAt: now(), source: 'https://tickets.gardaland.it', catalog, products };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`Salvato ${OUTPUT_FILE}.`);
}

run().catch(e => { console.error(e); process.exit(1); });
