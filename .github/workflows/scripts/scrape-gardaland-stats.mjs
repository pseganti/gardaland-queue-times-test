import { writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://queue-times.com/parks/12/stats';
const OUTPUT_FILE = 'gardaland-stats-current-year.json';

async function scrapeRideStats() {
  console.log(`📡 Scraping statistiche storiche da ${TARGET_URL}...`);

  const res = await fetch(TARGET_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const ridesMap = new Map();
  const tables = $('table.table');

  // 1. Prima tabella: Average queue time by ride (all time)
  if (tables.length > 0) {
    $(tables[0]).find('tbody tr').each((_, el) => {
      const row = $(el);
      const linkEl = row.find('td a');

      if (linkEl.length > 0) {
        const rawName = linkEl.text().trim();
        const href = linkEl.attr('href') || '';
        const idMatch = href.match(/\/rides\/(\d+)/);
        const rideId = idMatch ? parseInt(idMatch[1], 10) : null;

        const isArchived = rawName.includes('[Archived]');
        const cleanName = rawName.replace('[Archived]', '').trim();
        const avgWait = parseInt(row.find('td span').text().trim(), 10) || 0;

        ridesMap.set(cleanName, {
          id: rideId,
          name: cleanName,
          isArchived,
          avgWaitMinutes: avgWait,
          avgMaxWaitMinutes: 0
        });
      }
    });
  }

  // 2. Seconda tabella: Average maximum queue time by ride (all time)
  if (tables.length > 1) {
    $(tables[1]).find('tbody tr').each((_, el) => {
      const row = $(el);
      const linkEl = row.find('td a');

      if (linkEl.length > 0) {
        const rawName = linkEl.text().trim();
        const cleanName = rawName.replace('[Archived]', '').trim();
        const maxWait = parseInt(row.find('td span').text().trim(), 10) || 0;

        if (ridesMap.has(cleanName)) {
          ridesMap.get(cleanName).avgMaxWaitMinutes = maxWait;
        } else {
          const href = linkEl.attr('href') || '';
          const idMatch = href.match(/\/rides\/(\d+)/);
          ridesMap.set(cleanName, {
            id: idMatch ? parseInt(idMatch[1], 10) : null,
            name: cleanName,
            isArchived: rawName.includes('[Archived]'),
            avgWaitMinutes: 0,
            avgMaxWaitMinutes: maxWait
          });
        }
      }
    });
  }

  const rides = Array.from(ridesMap.values());

  const exportPayload = {
    metadata: {
      lastUpdated: new Date().toISOString(),
      source: TARGET_URL,
      totalRides: rides.length
    },
    rides
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(exportPayload, null, 2), 'utf-8');
  console.log(`✅ File ${OUTPUT_FILE} generato con successo con ${rides.length} attrazioni!`);
}

scrapeRideStats().catch(err => {
  console.error('❌ Errore durante lo scraping:', err);
  process.exit(1);
});
