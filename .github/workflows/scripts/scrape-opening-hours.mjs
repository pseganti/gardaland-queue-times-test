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
  '909': { show: '19:00' }, '1778': null, '5401': { show: 'SAME' }, // 5401 = SOLD OUT
  '6311': { show: '19:20' }
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
  // Pagina dei calendari: da qui partono le chiamate e qui c'è la LEGENDA con il testo
  // di ogni stato (es. data-cid="6311" → "19.20", data-cid="909" → "19.00 / 21.30")
  await page.goto('https://www.canevaworld.it/calendari-e-prezzi.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000); // lascia completare eventuali controlli anti-bot/cookie
  const legend = await page.evaluate(() => {
    const res = {};
    document.querySelectorAll('.elem[data-cid]').forEach(el => {
      const txt = el.querySelector('.fieldvalue.f6')?.textContent || el.querySelector('.fieldvalue.f3')?.textContent || '';
      res[el.getAttribute('data-cid')] = txt.replace(/\s+/g, ' ').trim();
    });
    return res;
  });
  const getJsonInPage = url => page.evaluate(async u => {
    const r = await fetch(u, { headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, url);
  return { browser, page, getJsonInPage, legend };
}

const TIME_RE = /\b([01]?\d|2[0-4])[.:]([0-5]\d)\b/g;
const toHHMM = (h, m) => `${String(h).padStart(2, '0')}:${m}`;

// Legenda testo → orario. Medieval: primo orario = spettacolo (es. "19.00 / 21.30" → 19:00).
// Parchi: primo e ultimo orario = apertura/chiusura. "Chiuso", "SOLD OUT" o nessun orario → null.
function stateFromLegend(park, text) {
  const t = [...String(text).matchAll(TIME_RE)].map(m => toHHMM(m[1], m[2]));
  // SOLD OUT: lo spettacolo c'è (va esaurito a ridosso della data e lo scraping è
  // settimanale) → giorno di spettacolo, orario preso dagli altri giorni del mese
  if (park === 'medieval' && !t.length && /sold\s*out/i.test(text)) return { show: 'SAME' };
  if (!t.length) return null;
  if (park === 'medieval') return { show: t[0] };
  return t.length >= 2 ? { open: t[0], close: t[t.length - 1] } : null;
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

    // La legenda del sito ha la precedenza sulla tabella fissa (orari aggiornati dal parco)
    const resolved = {};
    for (const s of Object.keys(stateCount)) {
      if (!(s in session.legend)) continue;
      const st = stateFromLegend(park, session.legend[s]);
      // un orario letto vince sempre; "nessun orario" vince solo se la legenda dice chiuso/sold out
      if (st || /chius|sold\s*out|closed/i.test(session.legend[s]) || !(s in CANEVA_STATES)) resolved[s] = st;
      if (park === 'medieval' && /sold\s*out/i.test(session.legend[s])) resolved[s] = { show: 'SAME' };
    }
    const stateMap = { ...CANEVA_STATES, ...resolved };

    let days = 0;
    for (const { y, m, days: rawDays } of monthsRaw) {
      const fresh = {};
      // Orario "tipico" del mese (il più frequente) per i giorni SOLD OUT
      const freq = {};
      for (const states of Object.values(rawDays)) for (const s of states) {
        const h = stateMap[s]; if (h?.show && h.show !== 'SAME') freq[h.show] = (freq[h.show] || 0) + 1;
      }
      const typicalShow = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '19:30';
      for (const [dateStr, states] of Object.entries(rawDays)) {
        const mapped = states.map(s => stateMap[s]).filter(Boolean);
        if (park === 'medieval') {
          // Si salva il PRIMO spettacolo del giorno (il più presto)
          const shows = [...new Set(mapped.map(h => h.show === 'SAME' ? typicalShow : (h.show || h.open)).filter(Boolean))].sort();
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
    const legendInfo = Object.entries(resolved).map(([s, h]) => `${s}=${h ? (h.show || h.open + '-' + h.close) : 'chiuso'}`);
    if (legendInfo.length) log.push(`🔎 ${park}: da legenda ${legendInfo.join(', ')}`);
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
