// ============================================
// scrape-gardaland-calendar.mjs
// Estrae il calendario di affluenza da queue-times.com
// e aggiorna gardaland-calendar-data.json nella root del repo.
//
// Uso: node .github/workflows/scripts/scrape-gardaland-calendar.mjs
// ============================================

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://queue-times.com/parks/12/calendar';
const OUTPUT_FILE = 'gardaland-calendar-data.json';

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
    console.warn(`⚠️ Impossibile leggere ${OUTPUT_FILE}, creo nuova struttura: ${err.message}`);
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const titleText = $('.subtitle').text().trim();
  const [monthName, yearStr] = titleText.split(' ');

  if (!monthName || !yearStr || !MONTH_MAP[monthName]) {
    throw new Error(`Impossibile parsare mese e anno dal titolo: "${titleText}"`);
  }

  const year = parseInt(yearStr, 10);
  const monthNum = MONTH_MAP[monthName];
  const monthKey = `${year}-${monthNum}`;

  const days = [];

  $('.tile a[href*="/calendar/"]').each((_, el) => {
    const tile = $(el);
    const href = tile.attr('href') || '';
    const match = href.match(/\/(\d{4})\/(\d{2})\/(\d{2})$/);

    if (match) {
      const [, tileYear, tileMonth, day] = match;
      const date = `${tileYear}-${tileMonth}-${day}`;

      // Livello affollamento (%)
      let crowdLevel = 'N/A';
      tile.find('.tag').each((_, tag) => {
        const text = $(tag).text().trim();
        if (text.includes('%') && !text.includes(':')) {
          crowdLevel = text;
        }
      });

      // Orari ed Eventi Speciali
      let hours = 'N/A';
      const events = [];
      const hoursTag = tile.find('.tag-multiline');

      if (hoursTag.length > 0) {
        const hoursText = hoursTag.text().trim();
        const hourMatch = hoursText.match(/(\d{1,2}:\d{2}-\d{1,2}:\d{2})/);
        if (hourMatch) hours = hourMatch[1];

        if (hoursText.includes('🌙')) events.push('Night is Magic');
        if (hoursText.includes('🍺')) events.push('Oktoberfest');
        if (hoursText.includes('🏖️')) events.push('Public Holiday');
        if (hoursText.includes('🎃')) events.push('Halloween');
      }

      const dayTag = tile.find('.tag:not(.tag-multiline)');
      if (dayTag.length > 0 && dayTag.text().includes('🌧️')) {
        events.push('Rainy Day');
      }

      // Intensità colore
      const style = tile.attr('style') || '';
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

      days.push({
        date,
        crowdLevel,
        crowdIntensity,
        hours,
        events,
        dayOfWeek: new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
      });
    }
  });

  days.sort((a, b) => new Date(a.date) - new Date(b.date));

  const calendarData = await loadExistingData();

  // Aggiorna mese
  calendarData.months[monthKey] = {
    monthKey,
    month: monthName,
    year,
    totalDays: days.length,
    days,
    extractedAt: new Date().toISOString(),
    source: TARGET_URL
  };

  // Pulisci mesi passati
  const currentMonthKey = new Date().toISOString().substring(0, 7);
  Object.keys(calendarData.months).forEach(key => {
    if (key < currentMonthKey) {
      delete calendarData.months[key];
    }
  });

  calendarData.metadata.lastUpdated = new Date().toISOString();
  calendarData.metadata.totalMonths = Object.keys(calendarData.months).length;

  await writeFile(OUTPUT_FILE, JSON.stringify(calendarData, null, 2), 'utf-8');
  console.log(`✅ ${OUTPUT_FILE} aggiornato con successo per il mese ${monthKey} (${days.length} giorni).`);
}

scrapeCalendar().catch(err => {
  console.error('❌ Errore durante lo scraping del calendario:', err);
  process.exit(1);
});
