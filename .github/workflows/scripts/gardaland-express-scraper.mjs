import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output salvato nella radice del repository
const OUTPUT_FILE = path.join(__dirname, '../../../gardaland-express-export.json');

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

// 1. Ottiene la dayPerformance (con la performanceAk) per una data specifica
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

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Errore dayPerformance per ${dateStr}:`, err.message);
    return null;
  }
}

// 2. Ottiene i prodotti Express (prezzi e pass) per il performanceAk recuperato
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
  console.log(`Avvio scraping Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  // Carica il file JSON esistente se presente
  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON vuoto o non valido, inizializzo nuova mappa.');
    }
  }

  const freshData = {};

  for (const dateStr of targetDates) {
    console.log(`Elaborazione data: ${dateStr}...`);
    const dayPerf = await getDayPerformance(dateStr);

    // Estrae la performanceAk (gestisce sia risposta Array che Oggetto)
    let performanceAk = null;
    if (Array.isArray(dayPerf) && dayPerf.length > 0) {
      performanceAk = dayPerf[0].performanceAk || dayPerf[0].ak;
    } else if (dayPerf && typeof dayPerf === 'object') {
      performanceAk = dayPerf.performanceAk || dayPerf.ak;
    }

    if (performanceAk) {
      const products = await fetchExpressProducts(performanceAk);
      if (products) {
        freshData[dateStr] = {
          updatedAt: new Date().toISOString(),
          performanceAk: performanceAk,
          products: products
        };
      }
    } else {
      console.warn(`Nessun performanceAk trovato per ${dateStr}`);
    }
  }

  // Merge dei nuovi dati con l'archivio locale
  const mergedData = { ...existingData, ...freshData };

  // Pulizia: Rimuove le date precedenti a oggi
  const cleanedData = {};
  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    } else {
      console.log(`Rimuovo data passata: ${dateKey}`);
    }
  });

  // Salva il file JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`Completato! Dati salvati in: ${OUTPUT_FILE}`);
}

runScraper();
