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
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

async function runScraper() {
  const todayStr = formatDate(new Date());
  const targetDates = getTargetDates();
  console.log(`Avvio Authenticated Scraper Express: ${targetDates[0]} -> ${targetDates[targetDates.length - 1]}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
    locale: 'it-IT'
  });

  const page = await context.newPage();

  // Variabile per catturare l'X-CSRF-Token reale intercettando il traffico di rete nativo
  let capturedCsrfToken = null;

  page.on('request', request => {
    const headers = request.headers();
    if (headers['x-csrf-token']) {
      capturedCsrfToken = headers['x-csrf-token'];
    }
  });

  console.log('Inizializzazione sessione web Gardaland...');
  try {
    // Carichiamo la pagina dello shop per innescare la creazione di app_session e dei token
    await page.goto('https://tickets.gardaland.it/b2c/expressSale/express', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Attesa tecnica per consentire il completamento dei moduli Angular in background
    await page.waitForTimeout(4000);

  } catch (err) {
    console.error('Errore durante il caricamento iniziale:', err.message);
  }

  // Se non intercettato dalle chiamate della pagina, estraiamo il cookie app_session
  if (!capturedCsrfToken) {
    const cookies = await context.cookies();
    const appSessionCookie = cookies.find(c => c.name === 'app_session');
    if (appSessionCookie) {
      capturedCsrfToken = appSessionCookie.value;
      console.log('Token recuperato dal cookie app_session.');
    }
  }

  console.log(`Token di sessione/CSRF pronto: ${capturedCsrfToken ? capturedCsrfToken.substring(0, 15) + '...' : 'NON PRESENTE'}`);

  let existingData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('File JSON preesistente vuoto o non valido.');
    }
  }

  const freshData = {};

  for (const dateStr of targetDates) {
    console.log(`\n--- Elaborazione data: ${dateStr} ---`);

    const result = await page.evaluate(async ({ date, token }) => {
      try {
        const headers = {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'X-API-KEY': '42'
        };

        if (token) {
          headers['X-CSRF-Token'] = token;
        }

        // Step 1: dayPerformance
        const resDay = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/dayPerformance', {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify({
            locale: 'en-GB',
            sellitemAk: 'FAST30',
            day: date,
            eventAk: 'GDL.EVN67',
            searchAttributes: {},
            useSumEnvelopeCapacity: false
          })
        });

        if (!resDay.ok) {
          const errText = await resDay.text();
          if (resDay.status === 500 && errText.includes('BE003')) {
            return { error: 'Data non acquistabile online o giornata già avviata (BE003)' };
          }
          return { error: `dayPerformance HTTP ${resDay.status}: ${errText.substring(0, 100)}` };
        }

        const dayData = await resDay.json();

        // Estrazione di performanceAK supportando sia oggetti diretti che l'array performances
        let performanceAk = null;
        let availability = null;

        if (dayData && dayData.performances && dayData.performances.length > 0) {
          const perf = dayData.performances[0];
          performanceAk = perf.performanceAK || perf.performanceAk || perf.ak;
          availability = perf.availability || null;
        } else if (Array.isArray(dayData) && dayData.length > 0) {
          const perf = dayData[0];
          performanceAk = perf.performanceAK || perf.performanceAk || perf.ak;
          availability = perf.availability || null;
        } else if (dayData && typeof dayData === 'object') {
          performanceAk = dayData.performanceAK || dayData.performanceAk || dayData.ak;
          availability = dayData.availability || null;
        }

        if (!performanceAk) {
          return { error: 'performanceAK non trovato', rawPayload: JSON.stringify(dayData).substring(0, 150) };
        }

        // Step 2: performanceProducts
        const resProd = await fetch('https://tickets-api.gardaland.it/api/gdl-prod*base/b2c/v1/performanceProducts', {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify({
            locale: 'en-GB',
            performanceAks: [performanceAk],
            components: null,
            offerCode: 'FAST30'
          })
        });

        if (!resProd.ok) {
          const errText = await resProd.text();
          return { error: `performanceProducts HTTP ${resProd.status}: ${errText.substring(0, 100)}` };
        }

        const productsData = await resProd.json();
        return { success: true, performanceAk, availability, products: productsData };

      } catch (err) {
        return { error: err.message };
      }
    }, { date: dateStr, token: capturedCsrfToken });

    if (result.success) {
      console.log(`SUCCESS [${dateStr}] - PerformanceAK: ${result.performanceAk}`);
      freshData[dateStr] = {
        updatedAt: new Date().toISOString(),
        performanceAk: result.performanceAk,
        availability: result.availability,
        products: result.products
      };
    } else {
      console.warn(`FAIL [${dateStr}]: ${result.error}`);
      if (result.rawPayload) {
        console.warn(` Payload grezzo ricevuto: ${result.rawPayload}`);
      }
    }

    await page.waitForTimeout(1000);
  }

  await browser.close();

  // Merge e pulizia dati
  const mergedData = { ...existingData, ...freshData };
  const cleanedData = {};

  Object.keys(mergedData).sort().forEach(dateKey => {
    if (dateKey >= todayStr) {
      cleanedData[dateKey] = mergedData[dateKey];
    }
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedData, null, 2));
  console.log(`\nSalvataggio completato! Dimensione file finale: ${fs.statSync(OUTPUT_FILE).size} bytes`);
}

runScraper();
