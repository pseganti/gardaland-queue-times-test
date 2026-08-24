import fs from 'fs';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://www.tikez.it/ticket/gardaland/20190607160133-1-giorno-parco';
const HISTORY_FILE = 'tikez-stock-history.json';

async function scrapeAndCalculate() {
  try {
    const response = await fetch(TARGET_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`Risposta HTTP non valida: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const todayStr = new Date().toISOString().split('T')[0];
    const currentData = {
      date: todayStr,
      tickets: {}
    };

    // Estrazione dei dati cercando i tag img#plus con l'attributo max
    $('img#plus').each((_, element) => {
      const imgPlus = $(element);
      const maxAttr = imgPlus.attr('max');
      const maxAvailable = maxAttr ? parseInt(maxAttr, 10) : 0;

      // Risale alla riga principale del biglietto
      const row = imgPlus.closest('.row');

      // Nome del biglietto
      const name = row.find('p.font-semi-bold').text().trim();

      // Prezzo
      const rawText = row.text();
      const priceMatch = rawText.match(/(\d+[\.,]\d{2})\s*€/);
      const price = priceMatch ? priceMatch[1] : 'N/D';

      if (name) {
        currentData.tickets[name] = {
          price: price,
          available: maxAvailable,
          soldToday: 0
        };
      }
    });

    if (Object.keys(currentData.tickets).length === 0) {
      console.error('❌ Nessun biglietto trovato nella pagina fornita.');
      process.exit(1);
    }

    // Gestione dello storico e calcolo delle vendite
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

    if (lastDate && history[lastDate]?.tickets) {
      const yesterdayTickets = history[lastDate].tickets;

      for (const [ticketName, data] of Object.entries(currentData.tickets)) {
        const prevAvailable = yesterdayTickets[ticketName]?.available;

        if (prevAvailable !== undefined) {
          if (data.available < prevAvailable) {
            data.soldToday = prevAvailable - data.available;
          } else {
            data.soldToday = 0;
          }
        }
      }
    }

    history[todayStr] = currentData;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

    console.log(`✅ Scraping completato per il ${todayStr}:`);
    console.dir(currentData.tickets, { depth: null });

  } catch (error) {
    console.error('❌ Errore durante lo scraping:', error);
    process.exit(1);
  }
}

scrapeAndCalculate();
