import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://queue-times.com/parks/12/calendar';
const MONTHS_AHEAD = 3; // oltre al mese corrente: legge anche i 3 mesi successivi (indirizzi /calendar/AAAA/MM)
const OUTPUT_FILE = 'gardaland-calendar-export.json';

const MONTH_MAP = {
  'January': '01', 'February': '02', 'March': '03', 'April': '04',
  'May': '05', 'June': '06', 'July': '07', 'August': '08',
  'September': '09', 'October': '10', 'November': '11', 'December': '12'
};

async function loadExistingData() {
  if (!existsSync(OUTPUT_FILE)) {
    return {
      metadata: {
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        totalMonths: 0
      },
      months: {}
    };
  }

  try {
    const raw = await readFile(OUTPUT_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return {
      metadata: {
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        totalMonths: 0
      },
      months: {}
    };
  }
}

const MONTH_NAMES = Object.fromEntries(Object.entries(MONTH_MAP).map(([name, num]) => [num, name]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Mese corrente (ora italiana) e successivi: [{ year, monthNum: '12', monthKey: '2026-12' }, ...]
function monthsToRead() {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).split('-').map(Number);
  const out = [];
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const year = d.getUTCFullYear(), monthNum = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push({ year, monthNum, monthKey: `${year}-${monthNum}` });
  }
  return out;
}

async function scrapeMonth({ year, monthNum, monthKey }) {
  const url = `${BASE_URL}/${year}/${monthNum}`;
  console.log(`📡 ${monthKey}: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const $ = cheerio.load(await res.text());
  const days = [];

  // Ogni casella del calendario è un link al singolo giorno (/calendar/AAAA/MM/GG)
  $('a[href*="/calendar/"]').each((_, el) => {
    const tile = $(el);
    const match = (tile.attr('href') || '').match(/\/(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!match) return;
    const [, tileYear, tileMonth, day] = match;
    if (`${tileYear}-${tileMonth}` !== monthKey) return; // caselle del mese prima/dopo
    const date = `${tileYear}-${tileMonth}-${day}`;

    let crowdLevel = 'N/A';
    tile.find('.tag, span').each((_, tag) => {
      const text = $(tag).text().trim();
      if (text.includes('%') && !text.includes(':')) crowdLevel = text;
    });

    const fullText = tile.text();
    let hours = 'N/A';
    const hourMatch = fullText.match(/(\d{1,2}:\d{2}-\d{1,2}:\d{2})/);
    if (hourMatch) hours = hourMatch[1];

    const events = [];
    if (fullText.includes('🌙')) events.push('Night is Magic');
    if (fullText.includes('🍺')) events.push('Oktoberfest');
    if (fullText.includes('🏖️')) events.push('Public Holiday');
    if (fullText.includes('🎃')) events.push('Halloween');
    if (fullText.includes('🌧️')) events.push('Rainy Day');

    const style = tile.attr('style') || tile.parent().attr('style') || '';
    const bgMatch = style.match(/background:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    let crowdIntensity = 'unknown';
    if (bgMatch) {
      const r = parseInt(bgMatch[1], 10);
      const g = parseInt(bgMatch[2], 10);
      if (r < 100) crowdIntensity = 'very-low';
      else if (r < 200 && g > 200) crowdIntensity = 'low';
      else if (r > 200 && g > 200) crowdIntensity = 'medium';
      else if (r > 200 && g < 200) crowdIntensity = 'high';
      else if (r > 250 && g < 100) crowdIntensity = 'very-high';
    }

    if (!days.some(d => d.date === date)) {
      days.push({
        date,
        crowdLevel,
        crowdIntensity,
        hours,
        events,
        forecast: /forecast/i.test(fullText),   // previsione (giorno futuro), non dato reale
        closed: /closed/i.test(fullText),
        dayOfWeek: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long' })
      });
    }
  });

  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

async function scrapeCalendar() {
  const calendarData = await loadExistingData();
  let updated = 0;

  for (const m of monthsToRead()) {
    try {
      const days = await scrapeMonth(m);
      const withData = days.filter(d => d.crowdLevel !== 'N/A').length;
      console.log(`🔎 ${m.monthKey}: ${days.length} giorni, ${withData} con affollamento`);
      if (days.length && withData) {
        calendarData.months[m.monthKey] = {
          monthKey: m.monthKey,
          month: MONTH_NAMES[m.monthNum],
          year: m.year,
          totalDays: days.length,
          days,
          extractedAt: new Date().toISOString(),
          source: `${BASE_URL}/${m.year}/${m.monthNum}`
        };
        updated++;
      } else {
        console.log(`ℹ️ ${m.monthKey}: nessun dato di affollamento (mese chiuso o non ancora pubblicato), mese precedente lasciato com'è`);
      }
    } catch (err) {
      console.warn(`⚠️ ${m.monthKey}: ${err.message}`);
    }
    await sleep(2000); // pausa tra un mese e l'altro
  }

  if (!updated) {
    throw new Error('Nessun mese aggiornato: verificare la struttura HTML di queue-times.');
  }

  calendarData.months = Object.fromEntries(Object.keys(calendarData.months).sort().map(k => [k, calendarData.months[k]]));
  calendarData.metadata.lastUpdated = new Date().toISOString();
  calendarData.metadata.totalMonths = Object.keys(calendarData.months).length;

  await writeFile(OUTPUT_FILE, JSON.stringify(calendarData, null, 2), 'utf-8');
  console.log(`✅ ${OUTPUT_FILE} aggiornato: ${updated} mesi letti.`);
}

scrapeCalendar().catch(err => {
  console.error('❌ Errore durante lo scraping:', err);
  process.exit(1);
});
