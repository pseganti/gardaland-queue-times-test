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
  console.log(`Avvio API-Context Scraper Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  // 1. Avvia Chromium e crea un contesto con gestione automatica di cookie/sessioni
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  // Usiamo il client API nativo di Playwright legato al contesto
  const request = context.request;

  console.log('Inizializzazione sessione e acquisizione cookie...');
  // Prima chiamata GET alla home dei biglietti per farsi assegnare la sessione
  await request.get('https://tickets.gardaland.it/b2c/ticketSale/tickets');

  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON vuoto o non valido.');
    }
  }

  const freshData = {};
  const commonHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-API-KEY': '42',
    'Origin': 'https://tickets.gardaland.it',
    'Referer': 'https://tickets.gardaland.it/'
  };

  for (const dateStr of targetDates) {
    console.log(`\n--- Elaborazione data: ${dateStr} ---`);

    try {
      // Step 1: Richiesta dayPerformance
      const resDay = await request.post('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/dayPerformance', {
        headers: commonHeaders,
        data: {
          locale: 'en-GB',
          sellitemAk: 'FAST30',
          day: dateStr,
          eventAk: 'GDL.EVN67',
          searchAttributes: {},
          useSumEnvelopeCapacity: false
        }
      });

      console.log(`[${dateStr}] Status dayPerformance: ${resDay.status()}`);

      if (!resDay.ok()) {
        console.warn(`[${dateStr}] Errore dayPerformance HTTP ${resDay.status()}`);
        continue;
      }

      const dayPerfData = await resDay.json();

      let performanceAk = null;
      if (Array.isArray(dayPerfData) && dayPerfData.length > 0) {
        performanceAk = dayPerfData[0].performanceAk || dayPerfData[0].ak;
      } else if (dayPerfData && typeof dayPerfData === 'object') {
        performanceAk = dayPerfData.performanceAk || dayPerfData.ak;
      }

      if (!performanceAk) {
        console.warn(`[${dateStr}] Nessun performanceAk trovato nel payload`);
        continue;
      }

      console.log(`[${dateStr}] Estratto performanceAk: ${performanceAk}`);

      // Step 2: Richiesta performanceProducts
      const resProd = await request.post('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/performanceProducts', {
        headers: commonHeaders,
        data: {
          locale: 'en-GB',
          performanceAks: [performanceAk],
          components: null,
          offerCode: 'FAST30'
        }
      });

      console.log(`[${dateStr}] Status performanceProducts: ${resProd.status()}`);

      if (resProd.ok()) {
        const productsData = await resProd.json();
        freshData[dateStr] = {
          updatedAt: new Date().toISOString(),
          performanceAk: performanceAk,
          products: productsData
        };
        console.log(`SUCCESS [${dateStr}] Dati salvati con successo.`);
      } else {
        console.warn(`[${dateStr}] Errore performanceProducts HTTP ${resProd.status()}`);
      }

    } catch (err) {
      console.error(`[${dateStr}] Eccezione:`, err.message);
    }
  }

  await browser.close();

  // Merge e pulizia dati vecchi
  const mergedData = { ...existingData, ...freshData };
  const cleanedData = {};

  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    }
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`\nOperazione completata. Dimensione file: ${fs.statSync(OUTPUT_FILE).size} bytes`);
}

runScraper();
