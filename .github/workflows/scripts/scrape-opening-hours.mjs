// ===== SCRAPER ORARI DI APERTURA (Gardaland Group + Caneva Group) =====
// Stessa logica dell'estensione Firefox "Garda Calendar Scraper", ma senza browser:
// gira su GitHub Actions una volta a settimana (vedi .github/workflows/opening-hours.yml).
//
// 1. Legge opening-hours.json esistente (se c'è)
// 2. Cancella i giorni prima del lunedì della settimana corrente
// 3. Scarica gli orari aggiornati:
//    - Gardaland / SEA LIFE / LEGOLAND Water Park: API gardaland.it (tutto il calendario)
//    - Caneva / Movieland / Medieval Times: API canevaworld.it (mese per mese, 12 mesi)
// 4. Scrive opening-hours.json (stesso formato che il sito usa già)
//
// Nessuna dipendenza: serve solo Node 18+ (fetch integrato).
// Uso locale:  node scrape-opening-hours.mjs

import { readFile, writeFile } from 'node:fs/promises';

const OUTPUT = process.env.OUTPUT_FILE || 'opening-hours.json';
const MONTHS_AHEAD = 12;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9'
};

const GARDALAND_IDS = { gardaland: 1716, sealife: 1719, legoland: 1718 };
const CANEVA_IDS = { caneva: 4, movieland: 3, medieval: 5 };

// Stati del calendario canevaworld.it → orari (copiati dall'estensione)
const CANEVA_STATES = {
  '899': { open: '10:00', close: '18:00' }, '906': { open: '10:00', close: '18:00' },
  '907': { open: '10:00', close: '19:00' }, '1777': null,
  '895': { open: '10:00', close: '18:00' }, '896': { open: '10:00', close: '19:00' },
  '897': { open: '10:00', close: '23:00' }, '898': { open: '10:00', close: '19:00' },
  '3066': { open: '10:00', close: '23:00' }, '900': { open: '10:00', close: '24:00' },
  '3502': { open: '10:00', close: '23:00' }, '3715': { open: '10:00', close: '19:00' },
  '1737': { open: '10:00', close: '19:00' }, '901': { open: '10:00', close: '18:00' },
  '902': { open: '10:00', close: '23:00' }, '3222': { open: '10:00', close: '19:00' },
  '1775': null, '908': { show: '19:30' }, '4959': { show: '19:00' },
  '909': { show: '19:00' }, '1778': null, '5401': null
};

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function mondayOfThisWeek() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const day = (now.getDay() + 6) % 7; // 0 = lunedì
  now.setDate(now.getDate() - day);
  return iso(now);
}

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return res.json();
}

// Sostituisce i dati di un parco in un intervallo di date [from, to] (inclusi):
// così un giorno che passa da aperto a chiuso non resta con l'orario vecchio.
function replaceRange(data, park, from, to, fresh) {
  data[park] = data[park] || {};
  for (const k of Object.keys(data[park])) if (k >= from && k <= to) delete data[park][k];
  Object.assign(data[park], fresh);
}

async function scrapeGardaland(data, log) {
  for (const [park, id] of Object.entries(GARDALAND_IDS)) {
    try {
      const json = await getJson(`https://www.gardaland.it/api/openinghours/getcalendar?lang=it-IT&locationIds=${id}`);
      const days = json?.locations?.[0]?.days || [];
      if (!days.length) { log.push(`ℹ️ ${park}: nessun giorno restituito (fuori stagione?), dati lasciati invariati`); continue; }
      const fresh = {};
      let min = null, max = null;
      for (const day of days) {
        const k = String(day.key);
        const date = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        if (!min || date < min) min = date;
        if (!max || date > max) max = date;
        const m = (day.openingHours || '').match(/(\d+:\d+)\s*-\s*(\d+:\d+)/);
        if (m) fresh[date] = { open: m[1], close: m[2] };
      }
      replaceRange(data, park, min, max, fresh);
      log.push(`✅ ${park}: ${Object.keys(fresh).length} giorni aperti (${min} → ${max})`);
    } catch (e) {
      log.push(`❌ ${park}: ${e.message} — dati lasciati invariati`);
    }
  }
}

// canevaworld.it blocca (403) le richieste dirette dai server di GitHub.
// Come faceva l'estensione Firefox, le chiamate partono da DENTRO la pagina del
// sito, aperta in un browser headless (Playwright, già usato dallo scraper Express).
async function openCanevaBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
    locale: 'it-IT'
  });
  const page = await context.newPage();
  await page.goto('https://www.canevaworld.it/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000); // lascia completare eventuali controlli anti-bot/cookie
  const getJsonInPage = url => page.evaluate(async u => {
    const r = await fetch(u, { headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, url);
  return { browser, page, getJsonInPage };
}

const TIME_RE = /\b([01]?\d|2[0-4])[.:]([0-5]\d)\b/g;
const toHHMM = (h, m) => `${String(h).padStart(2, '0')}:${m}`;

// Cerca in un oggetto JSON qualunque i nodi legati allo stato `id` e ne estrae gli orari
function timesFromJson(node, id, out = new Set(), inside = false) {
  if (node == null) return out;
  if (typeof node === 'string') {
    if (inside) for (const m of node.matchAll(TIME_RE)) out.add(toHHMM(m[1], m[2]));
    return out;
  }
  if (typeof node !== 'object') return out;
  const isState = String(node.id ?? node.ID ?? node.state_id ?? '') === id;
  for (const [k, v] of Object.entries(node)) timesFromJson(v, id, out, inside || isState || k === id);
  return out;
}

// Stato → orario: 1 orario = spettacolo (Medieval) oppure apertura; 2 orari = apertura-chiusura
function stateFromTimes(park, times) {
  const t = [...times].sort();
  if (!t.length) return null;
  if (park === 'medieval') return { show: t[0] };
  return t.length >= 2 ? { open: t[0], close: t[t.length - 1] } : null;
}

const PARK_PAGE_HINT = { caneva: 'aquapark', movieland: 'movieland', medieval: 'medieval' };

async function resolveUnknownStates(session, park, ids, jsons, log) {
  const resolved = {};
  // 1) nei dati JSON del calendario
  for (const id of ids) {
    const times = new Set();
    for (const j of jsons) timesFromJson(j, id, times);
    const st = stateFromTimes(park, times);
    if (st) resolved[id] = st;
  }
  const missing = ids.filter(id => !resolved[id]);
  if (!missing.length) return resolved;

  // 2) nella legenda del calendario sulla pagina del parco:
  //    <div class="tc-cc ... tc-c-6311"></div><div class="fieldvalue ...">19.20</div>
  try {
    const { page } = session;
    const hint = PARK_PAGE_HINT[park];
    const links = await page.$$eval('a[href]', (as, h) => [...new Set(as.map(a => a.href).filter(u => u.includes('canevaworld.it') && u.toLowerCase().includes(h)))], hint);
    for (const url of links.slice(0, 5)) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
      const found = await page.evaluate(ids => {
        const res = {};
        for (const id of ids) {
          const el = document.querySelector(`.tc-c-${id}`);
          if (!el) continue;
          // l'orario sta nell'elemento subito dopo il quadratino colorato
          const sib = (el.nextElementSibling?.textContent || '').trim();
          res[id] = /\d[.:]\d\d/.test(sib) ? sib : (el.parentElement?.textContent || '');
        }
        return res;
      }, missing);
      for (const [id, text] of Object.entries(found)) {
        const times = new Set([...text.matchAll(TIME_RE)].map(m => toHHMM(m[1], m[2])));
        const st = stateFromTimes(park, times);
        if (st) resolved[id] = st;
      }
      if (missing.every(id => resolved[id])) break;
    }
    await page.goto('https://www.canevaworld.it/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log.push(`⚠️ ${park}: lettura legenda non riuscita (${e.message})`);
  }
  return resolved;
}

async function scrapeCaneva(data, log) {
  let session;
  try {
    session = await openCanevaBrowser();
  } catch (e) {
    log.push(`❌ Caneva: impossibile aprire canevaworld.it nel browser (${e.message}) — dati lasciati invariati`);
    return;
  }
  const getJson = async url => {
    try { return await session.getJsonInPage(url); }
    catch (e) { throw new Error(`${e.message.replace(/^.*Error: /, '')} su ${url}`); }
  };
  const start = new Date();
  for (const [park, id] of Object.entries(CANEVA_IDS)) {
    const monthsRaw = [];           // [{ y, m, days: { 'YYYY-MM-DD': [stateId, ...] }, json }]
    const unknown = new Set();
    const stateCount = {};
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      try {
        const json = await getJson(`https://www.canevaworld.it/bootstrap/template_calendar_data/894/${id}/${y}/${m}`);
        if (!json?.contents_calendars) continue;
        const days = {};
        for (const cal of Object.values(json.contents_calendars)) {
          for (const [dateStr, dayData] of Object.entries(cal)) {
            // Un giorno può avere PIÙ stati (es. 2 spettacoli): si tengono tutti
            const states = Object.keys(dayData || {});
            days[dateStr] = (days[dateStr] || []).concat(states);
            for (const s of states) {
              stateCount[s] = (stateCount[s] || 0) + 1;
              if (!(s in CANEVA_STATES)) unknown.add(s);
            }
          }
        }
        monthsRaw.push({ y, m, days, json });
      } catch (e) {
        log.push(`❌ ${park} ${pad(m)}/${y}: ${e.message} — mese lasciato invariato`);
      }
    }

    // Stati nuovi (es. Medieval con lo show spostato alle 19.20): si cerca l'orario
    // nei dati del calendario e, se non c'è, nella legenda della pagina del parco.
    const resolved = unknown.size ? await resolveUnknownStates(session, park, [...unknown], monthsRaw.map(x => x.json), log) : {};
    const stateMap = { ...CANEVA_STATES, ...resolved };

    let days = 0;
    for (const { y, m, days: rawDays } of monthsRaw) {
      const fresh = {};
      for (const [dateStr, states] of Object.entries(rawDays)) {
        const mapped = states.map(s => stateMap[s]).filter(Boolean);
        if (park === 'medieval') {
          // Si salva il PRIMO spettacolo del giorno (il più presto)
          const shows = [...new Set(mapped.map(h => h.show || h.open).filter(Boolean))].sort();
          if (shows.length) fresh[dateStr] = { show: shows[0] };
        } else {
          const h = mapped.find(x => x.open && x.close);
          if (h) fresh[dateStr] = { open: h.open, close: h.close };
        }
      }
      replaceRange(data, park, `${y}-${pad(m)}-01`, `${y}-${pad(m)}-31`, fresh);
      days += Object.keys(fresh).length;
    }

    log.push(monthsRaw.length ? `✅ ${park}: ${days} giorni in ${monthsRaw.length} mesi` : `❌ ${park}: nessun mese scaricato — dati lasciati invariati`);
    const stillUnknown = [...unknown].filter(s => !(s in resolved));
    if (Object.keys(resolved).length) log.push(`🔎 ${park}: stati nuovi riconosciuti ${Object.entries(resolved).map(([s, h]) => `${s}=${h.show || (h.open + '-' + h.close)}`).join(', ')}`);
    if (stillUnknown.length) log.push(`⚠️ ${park}: stati sconosciuti ${stillUnknown.join(', ')} — giorni con solo questi stati risultano chiusi`);
    log.push(`   ${park} stati visti: ${Object.entries(stateCount).map(([s, n]) => `${s}×${n}`).join(' ') || 'nessuno'}`);
  }
  await session.browser.close();
}

function removePastDays(data, from) {
  let removed = 0;
  for (const park of Object.keys(data)) {
    for (const k of Object.keys(data[park])) if (k < from) { delete data[park][k]; removed++; }
  }
  return removed;
}

function sortData(data) {
  const out = {};
  for (const park of Object.keys(data)) {
    out[park] = Object.fromEntries(Object.entries(data[park]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

const log = [];
let data = {};
try { data = JSON.parse(await readFile(OUTPUT, 'utf8')); } catch { log.push('ℹ️ Nessun opening-hours.json esistente, parto da zero'); }

const from = mondayOfThisWeek();
log.push(`🧹 Rimossi ${removePastDays(data, from)} giorni prima di ${from}`);

await scrapeGardaland(data, log);
await scrapeCaneva(data, log);
removePastDays(data, from); // Caneva scarica il mese intero: via di nuovo i giorni già passati

await writeFile(OUTPUT, JSON.stringify(sortData(data), null, 2) + '\n');
console.log(log.join('\n'));
if (log.some(l => l.startsWith('❌'))) process.exitCode = 1; // il run risulta fallito → GitHub avvisa via email
