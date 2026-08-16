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
  console.log(`Avvio Interceptor Scraper per Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'it-IT'
  });

  const page = await context.newPage();
  const capturedProducts = {};

  // Intercetta la risposta dell'API di Gardaland quando la pagina la invoca
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/performanceProducts') && response.status() === 200) {
      try {
        const json = await response.json();
        console.log(`[NET INTERCEPT] Catturata risposta prodotti Express!`);
        // Registra i prodotti catturati
        if (Array.isArray(json) && json.length > 0) {
          const perfAk = json[0].performanceAk || 'UNKNOWN';
          capturedProducts[perfAk] = json;
        }
      } catch (err) {
        console.error('Errore nel parsing della risposta intercettata:', err.message);
      }
    }
  });

  console.log('Navigazione alla pagina Gardaland Express...');
  try {
    // Apriamo direttamente lo shop Express per far scattare i cookie e il token d'infrastruttura
    await page.goto('https://tickets.gardaland.it/b2c/expressSale/express', { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    // Accetta i cookie se compare il banner (OneTrust / Cookiebot)
    try {
      const acceptBtn = page.locator('#onetrust-accept-btn-handler, .cookie-accept-btn');
      if (await acceptBtn.isVisible({ timeout: 5000 })) {
        await acceptBtn.click();
        console.log('Banner cookie accettato.');
      }
    } catch (e) {
      // Ignora se non presente
    }

    // Attende che la SPA carichi e faccia le chiamate iniziali
    await page.waitForTimeout(5000);

  } catch (err) {
    console.error('Errore durante il caricamento della pagina:', err.message);
  }

  // Se l'intercettazione ha catturato dati tramite il normale ciclo di vita della pagina
  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON vuoto o non valido.');
    }
  }

  const freshData = {};
  const capturedKeys = Object.keys(capturedProducts);

  if (capturedKeys.length > 0) {
    console.log(`\nProdotti intercettati per ${capturedKeys.length} performanceAK.`);
    // Assegna i dati catturati alla data odierna / target
    freshData[todayStr] = {
      updatedAt: new Date().toISOString(),
      products: capturedProducts
    };
  } else {
    console.warn('\nNessuna chiamata API intercettata durante la navigazione.');
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
