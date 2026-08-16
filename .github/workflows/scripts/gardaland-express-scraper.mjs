import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_FILE = path.resolve(__dirname, '../../../gardaland-express-export.json');

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getTargetDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

async function runScraper() {
  const todayStr = formatDate(new Date());
  const targetDates = getTargetDates();
  console.log(`Avvio Playwright Scraper per Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  // Avvia il browser headless
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Apertura pagina biglietti per inizializzare sessione e cookie...');
  await page.goto('https://tickets.gardaland.it/b2c/ticketSale/tickets', { waitUntil: 'networkidle' });

  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON vuoto o non valido.');
    }
  }

  const freshData = {};

  for (const dateStr of targetDates) {
    console.log(`\n--- Elaborazione data: ${dateStr} ---`);

    // Esegue la fetch DENTRO il contesto del browser attivo (sfruttando cookie e token reali)
    const result = await page.evaluate(async (targetDate) => {
      try {
        // 1. Day Performance
        const resDay = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/dayPerformance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': '42'
          },
          body: JSON.stringify({
            locale: 'en-GB',
            sellitemAk: 'FAST30',
            day: targetDate,
            eventAk: 'GDL.EVN67',
            searchAttributes: {},
            useSumEnvelopeCapacity: false
          })
        });

        if (!resDay.ok) return { error: `DayPerformance HTTP ${resDay.status}` };
        const dayPerfData = await resDay.json();

        let performanceAk = null;
        if (Array.isArray(dayPerfData) && dayPerfData.length > 0) {
          performanceAk = dayPerfData[0].performanceAk || dayPerfData[0].ak;
        } else if (dayPerfData && typeof dayPerfData === 'object') {
          performanceAk = dayPerfData.performanceAk || dayPerfData.ak;
        }

        if (!performanceAk) return { error: 'Nessun performanceAk trovato' };

        // 2. Performance Products
        const resProd = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/performanceProducts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': '42'
          },
          body: JSON.stringify({
            locale: 'en-GB',
            performanceAks: [performanceAk],
            components: null,
            offerCode: 'FAST30'
          })
        });

        if (!resProd.ok) return { error: `PerformanceProducts HTTP ${resProd.status}` };
        const productsData = await resProd.json();

        return { performanceAk, products: productsData };

      } catch (err) {
        return { error: err.message };
      }
    }, dateStr);

    if (result && !result.error) {
      console.log(`SUCCESS [${dateStr}] PerformanceAK: ${result.performanceAk}`);
      freshData[dateStr] = {
        updatedAt: new Date().toISOString(),
        performanceAk: result.performanceAk,
        products: result.products
      };
    } else {
      console.warn(`FAIL [${dateStr}]: ${result ? result.error : 'Errore sconosciuto'}`);
    }
  }

  await browser.close();

  // Merge e pulizia
  const mergedData = { ...existingData, ...freshData };
  const cleanedData = {};

  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    }
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`\nSalvataggio completato! Dimensione file: ${fs.statSync(OUTPUT_FILE).size} bytes`);
}

runScraper();
