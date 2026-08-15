import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://queue-times.com/parks/12/calendar';
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

async function scrapeCalendar() {
  console.log(`📡 Fetching calendar page from ${TARGET_URL}...`);
  const res = await fetch(TARGET_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const titleText = $('.subtitle, h1, h2').text().trim();
  let monthName = '', yearStr = '';
  
  for (const key of Object.keys(MONTH_MAP)) {
    if (titleText.includes(key)) {
      monthName = key;
      const match = titleText.match(/\b(20\d{2})\b/);
      if (match) yearStr = match[1];
      break;
    }
  }

  if (!monthName || !yearStr) {
    throw new Error(`Impossibile parsare mese e anno dal titolo: "${titleText}"`);
  }

  const year = parseInt(yearStr, 10);
  const monthNum = MONTH_MAP[monthName];
  const monthKey = `${year}-${monthNum}`;

  const days = [];

  // Selettore esteso per trovare tutti i link ai singoli giorni del calendario
  $('a[href*="/calendar/"]').each((_, el) => {
    const tile = $(el);
    const href = tile.attr('href') || '';
    const match = href.match(/\/(\d{4})\/(\d{2})\/(\d{2})$/);

    if (match) {
      const [, tileYear, tileMonth, day] = match;
      const date = `${tileYear}-${tileMonth}-${day}`;

      // Verifica se la data appartiene al mese estratto
      if (`${tileYear}-${tileMonth}` !== monthKey) return;

      let crowdLevel = 'N/A';
      tile.find('.tag, span').each((_, tag) => {
        const text = $(tag).text().trim();
        if (text.includes('%') && !text.includes(':')) {
          crowdLevel = text;
        }
      });

      let hours = 'N/A';
      const events = [];
      const fullText = tile.text();

      const hourMatch = fullText.match(/(\d{1,2}:\d{2}-\d{1,2}:\d{2})/);
      if (hourMatch) hours = hourMatch[1];

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

      // Evita duplicati
      if (!days.some(d => d.date === date)) {
        days.push({
          date,
          crowdLevel,
          crowdIntensity,
          hours,
          events,
          dayOfWeek: new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
        });
      }
    }
  });

  days.sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log(`🔎 Giorni trovati per ${monthKey}: ${days.length}`);

  if (days.length === 0) {
    throw new Error(`Nessun giorno estratto per ${monthKey}. Verificare la struttura HTML del sito.`);
  }

  const calendarData = await loadExistingData();

  calendarData.months[monthKey] = {
    monthKey,
    month: monthName,
    year,
    totalDays: days.length,
    days,
    extractedAt: new Date().toISOString(),
    source: TARGET_URL
  };

  calendarData.metadata.lastUpdated = new Date().toISOString();
  calendarData.metadata.totalMonths = Object.keys(calendarData.months).length;

  await writeFile(OUTPUT_FILE, JSON.stringify(calendarData, null, 2), 'utf-8');
  console.log(`✅ ${OUTPUT_FILE} aggiornato con successo (${days.length} giorni).`);
}

scrapeCalendar().catch(err => {
  console.error('❌ Errore durante lo scraping:', err);
  process.exit(1);
});
