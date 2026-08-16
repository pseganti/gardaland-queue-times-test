import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Salva il JSON finale nella radice della repo
const OUTPUT_FILE = path.join(__dirname, '../gardaland-express-export.json');

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

async function fetchExpressDataForDate(dateStr) {
  try {
    // Sostituisci con l'URL o endpoint di scraping/API reale per la singola data
    const url = `https://www.gardaland.it/api/express/availability?date=${dateStr}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Errore scraping per ${dateStr}:`, err.message);
    return null;
  }
}

async function runScraper() {
  const todayStr = formatDate(new Date());
  const targetDates = getTargetDates();
  console.log(`Esecuzione scraper Express per date: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  // 1. Carica il JSON esistente per fare il merge
  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON esistente non trovato o non valido. Creazione nuovo.');
    }
  }

  // 2. Fetch dei dati freschi per oggi + 7 giorni
  const freshData = {};
  for (const dateStr of targetDates) {
    console.log(`Scraping Express: ${dateStr}...`);
    const data = await fetchExpressDataForDate(dateStr);
    if (data) {
      freshData[dateStr] = {
        updatedAt: new Date().toISOString(),
        tickets: data
      };
    }
  }

  // 3. Merge dei nuovi dati con il file esistente
  const mergedData = { ...existingData, ...freshData };

  // 4. RIMOZIONE DATE VECCHIE (mantiene solo date >= oggi)
  const cleanedData = {};
  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    } else {
      console.log(`Rimossa data passata: ${dateKey}`);
    }
  });

  // 5. Scrittura del file in radice
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`Scraping completato! File salvato: ${OUTPUT_FILE}`);
}

runScraper();
