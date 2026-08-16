import { writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

// Ricava automaticamente l'anno corrente (es. 2026)
const currentYear = new Date().getFullYear();
const TARGET_URL = `https://queue-times.com/parks/12/stats/${currentYear}`;
const OUTPUT_FILE = 'gardaland-stats-current-year.json';

async function main() {
  console.log(`📡 Scraping statistiche ${currentYear} da: ${TARGET_URL}`);

  try {
    const res = await fetch(TARGET_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const rides = [];

    $('table tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 3) {
        const name = $(cols[0]).text().trim();
        const avgText = $(cols[1]).text().trim();
        const maxText = $(cols[2]).text().trim();

        const avgWait = parseInt(avgText, 10) || 0;
        const maxWait = parseInt(maxText, 10) || 0;

        if (name) {
          rides.push({
            name,
            avgWaitMinutes: avgWait,
            maxWaitMinutes: maxWait
          });
        }
      }
    });

    rides.sort((a, b) => b.avgWaitMinutes - a.avgWaitMinutes);

    const payload = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        year: currentYear,
        totalRides: rides.length,
        source: TARGET_URL
      },
      rides
    };

    await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`✅ Salvate con successo ${rides.length} attrazioni in ${OUTPUT_FILE}`);

  } catch (err) {
    console.error('❌ Errore durante lo scraping delle statistiche:', err.message);
    process.exit(1);
  }
}

main();
