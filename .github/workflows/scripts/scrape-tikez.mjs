import fs from 'fs';
import * as cheerio from 'cheerio';

// Mappa delle pagine da monitorare
const TARGET_PAGES = {
  gardaland: 'https://www.tikez.it/ticket/gardaland/20190607160133-1-giorno-parco',
  caneva_movieland_2parchi: 'https://www.tikez.it/ticket/canevaworld/20190613144030-caneva-movieland-1-giorno-2-parchi',
  gardaland_legoland_sealife: 'https://www.tikez.it/ticket/20250529133105-legoland-gardaland/20250607111846-gardalandlegolandsea-life',
  movieland: 'https://www.tikez.it/ticket/movieland/20190612153253-la-citt-del-cinema',
  caneva_aquapark: 'https://www.tikez.it/ticket/canevaworld/20190612152132-acqua-park',
  gardaland_legoland: 'https://www.tikez.it/ticket/20250529133105-legoland-gardaland/20260701122234-gardaland-legoland'
};

const HISTORY_FILE = 'tikez-stock-history.json';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'it-IT,it;q=0.9'
};

async function fetchAndParsePage(categoryKey, url) {
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const tickets = {};

    $('img#plus').each((_, element) => {
      const imgPlus = $(element);
      const maxAttr = imgPlus.attr('max');
      const maxAvailable = maxAttr ? parseInt(maxAttr, 10) : 0;

      const row = imgPlus.closest('.row');
      const name = row.find('p.font-semi-bold').text().trim();

      const rawText = row.text();
      const priceMatch = rawText.match(/(\d+[\.,]\d{2})\s*€/);
      const price = priceMatch ? priceMatch[1] : 'N/D';

      if (name) {
        tickets[name] = {
          price: price,
          available: maxAvailable,
          soldToday: 0
        };
      }
    });

    return { categoryKey, tickets };
  } catch (error) {
    console.error(`⚠️ Errore su ${categoryKey} (${url}):`, error.message);
    return { categoryKey, tickets: {} };
  }
}

async function scrapeAndCalculate() {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentData = {
    date: todayStr,
    categories: {}
  };

  // Esegue tutte le richieste HTTP in parallelo
  const results = await Promise.all(
    Object.entries(TARGET_PAGES).map(([key, url]) => fetchAndParsePage(key, url))
  );

  let totalTicketsFound = 0;
  for (const { categoryKey, tickets } of results) {
    currentData.categories[categoryKey] = tickets;
    totalTicketsFound += Object.keys(tickets).length;
  }

  if (totalTicketsFound === 0) {
    console.error('❌ Nessun biglietto estratto da nessuna pagina!');
    process.exit(1);
  }

  // Carica storico precedente
  let history = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
      history = {};
    }
  }

  const dates = Object.keys(history).filter(d => d !== todayStr).sort();
  const lastDate = dates[dates.length - 1];

  // Calcolo vendite giornaliere per ogni categoria e tipologia di biglietto
  if (lastDate && history[lastDate]?.categories) {
    const prevCategories = history[lastDate].categories;

    for (const [catKey, tickets] of Object.entries(currentData.categories)) {
      const prevTickets = prevCategories[catKey] || {};

      for (const [ticketName, data] of Object.entries(tickets)) {
        const prevAvailable = prevTickets[ticketName]?.available;

        if (prevAvailable !== undefined) {
          if (data.available < prevAvailable) {
            data.soldToday = prevAvailable - data.available;
          } else {
            data.soldToday = 0;
          }
        }
      }
    }
  }

  // Salvataggio
  history[todayStr] = currentData;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log(`✅ Scraping completato con successo per il ${todayStr}!`);
  console.dir(currentData.categories, { depth: null });
}

scrapeAndCalculate();
