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
      if (!days.length) { log.push(`⚠️ ${park}: nessun giorno restituito, dati lasciati invariati`); continue; }
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

async function scrapeCaneva(data, log) {
  const start = new Date();
  for (const [park, id] of Object.entries(CANEVA_IDS)) {
    let days = 0, months = 0;
    const unknown = new Set();
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      try {
        const json = await getJson(`https://www.canevaworld.it/bootstrap/template_calendar_data/894/${id}/${y}/${m}`);
        if (!json?.contents_calendars) continue;
        const fresh = {};
        for (const cal of Object.values(json.contents_calendars)) {
          for (const [dateStr, dayData] of Object.entries(cal)) {
            const state = Object.keys(dayData || {})[0];
            if (!(state in CANEVA_STATES)) { unknown.add(state); continue; }
            const h = CANEVA_STATES[state];
            if (!h) continue;
            if (park === 'medieval' && h.show) fresh[dateStr] = { show: h.show };
            else if (h.open && h.close) fresh[dateStr] = { open: h.open, close: h.close };
          }
        }
        replaceRange(data, park, `${y}-${pad(m)}-01`, `${y}-${pad(m)}-31`, fresh);
        days += Object.keys(fresh).length; months++;
      } catch (e) {
        log.push(`❌ ${park} ${pad(m)}/${y}: ${e.message} — mese lasciato invariato`);
      }
    }
    log.push(months ? `✅ ${park}: ${days} giorni in ${months} mesi` : `❌ ${park}: nessun mese scaricato — dati lasciati invariati`);
    if (unknown.size) log.push(`⚠️ ${park}: stati calendario sconosciuti ${[...unknown].join(', ')} — aggiungerli a CANEVA_STATES`);
  }
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

await writeFile(OUTPUT, JSON.stringify(sortData(data), null, 2) + '\n');
console.log(log.join('\n'));
if (log.some(l => l.startsWith('❌'))) process.exitCode = 1; // il run risulta fallito → GitHub avvisa via email
