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
  console.log(`Avvio UI-Driven Scraper Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'it-IT',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  const capturedData = {};

  // Intercettazione delle risposte di rete autenticate
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/performanceProducts') && response.status() === 200) {
      try {
        const json = await response.json();
        console.log(`[NET INTERCEPT] Risposta performanceProducts catturata!`);
        if (Array.isArray(json) && json.length > 0) {
          const perfAk = json[0].performanceAk || json[0].ak || 'CURRENT';
          capturedData[perfAk] = json;
        }
      } catch (e) {
        console.error('Errore durante la lettura del JSON intercettato:', e.message);
      }
    }
  });

  console.log('Caricamento portale biglietti Gardaland Express...');
  try {
    await page.goto('https://tickets.gardaland.it/b2c/expressSale/express', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Gestione del banner dei cookie
    try {
      const cookieButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accetta"), .cookie-accept-btn');
      if (await cookieButton.isVisible({ timeout: 5000 })) {
        await cookieButton.click();
        console.log('Banner cookie gestito.');
      }
    } catch (e) {
      // Prosegui se non visibile
    }

    // Attesa del caricamento completo dell'interfaccia Angular
    await page.waitForTimeout(4000);

    // Selezione delle date sul calendario dell'interfaccia per forzare le chiamate API
    for (const dateStr of targetDates) {
      const dayNumber = parseInt(dateStr.split('-')[2], 10);
      console.log(`Navigazione calendario per il giorno ${dateStr} (Giorno ${dayNumber})...`);

      const dayCell = page.locator(`td:not(.disabled) :text-is("${dayNumber}"), .calendar-day:has-text("${dayNumber}")`).first();
      
      if (await dayCell.isVisible({ timeout: 3000 })) {
        await dayCell.click();
        await page.waitForTimeout(2500);
      } else {
        console.log(`Elemento giorno ${dayNumber} non direttamente visibile/selezionabile.`);
      }
    }

  } catch (err) {
    console.error('Errore durante la navigazione della SPA:', err.message);
  }

  // Lettura ed eventuale merge dei dati preesistenti
  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON preesistente non valido o vuoto.');
    }
  }

  const freshData = {};
  if (Object.keys(capturedData).length > 0) {
    freshData[todayStr] = {
      updatedAt: new Date().toISOString(),
      productsByAk: capturedData
    };
  }

  await browser.close();

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
