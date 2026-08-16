import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Risale di 3 livelli da .github/workflows/scripts fino alla radice della repository
const OUTPUT_FILE = path.resolve(__dirname, '../../../gardaland-express-export.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'X-API-KEY': '42',
  'Referer': 'https://tickets.gardaland.it/'
};

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

// 1. Chiamata dayPerformance
async function getDayPerformance(dateStr) {
  try {
    const res = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/dayPerformance', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        locale: 'en-GB',
        sellitemAk: 'FAST30',
        day: dateStr,
        eventAk: 'GDL.EVN67',
        searchAttributes: {},
        useSumEnvelopeCapacity: false
      })
    });

    console.log(`[${dateStr}] Response Status (dayPerformance):`, res.status);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[${dateStr}] Errore dayPerformance:`, err.message);
    return null;
  }
}

// 2. Chiamata performanceProducts
async function fetchExpressProducts(performanceAk) {
  try {
    const res = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/performanceProducts', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        locale: 'en-GB',
        performanceAks: [performanceAk],
        components: null,
        offerCode: 'FAST30'
      })
    });

    console.log(`[AK: ${performanceAk}] Response Status (performanceProducts):`, res.status);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Errore performanceProducts per ${performanceAk}:`, err.message);
    return null;
  }
}

async function runScraper() {
  const todayStr = formatDate(new Date());
  const targetDates = getTargetDates();
  console.log(`Percorso destinazione JSON: ${OUTPUT_FILE}`);
  console.log(`Avvio scraping Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

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
    const dayPerf = await getDayPerformance(dateStr);

    console.log(`Struttura risposta dayPerformance per ${dateStr}:`, JSON.stringify(dayPerf));

    // Estrazione flessibile dell'AK
    let performanceAk = null;
    if (Array.isArray(dayPerf) && dayPerf.length > 0) {
      performanceAk = dayPerf[0].performanceAk || dayPerf[0].ak || dayPerf[0].id;
    } else if (dayPerf && typeof dayPerf === 'object') {
      performanceAk = dayPerf.performanceAk || dayPerf.ak || dayPerf.id;
    }

    if (performanceAk) {
      console.log(`Trovato performanceAk: ${performanceAk}`);
      const products = await fetchExpressProducts(performanceAk);
      if (products) {
        freshData[dateStr] = {
          updatedAt: new Date().toISOString(),
          performanceAk: performanceAk,
          products: products
        };
      }
    } else {
      console.warn(`Nessun performanceAk estratto per ${dateStr}`);
    }
  }

  // Merge e pulizia
  const mergedData = { ...existingData, ...freshData };
  const cleanedData = {};

  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    }
  });

  // Forziamo la scrittura del file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`\nScrittura completata! Dimensione file: ${fs.statSync(OUTPUT_FILE).size} bytes`);
}

runScraper();
