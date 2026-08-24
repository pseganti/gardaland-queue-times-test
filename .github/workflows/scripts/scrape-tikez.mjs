import fs from 'fs';
import * as cheerio from 'cheerio';

// Modifica con l'URL corretto se diverso
const TARGET_URL = 'https://www.tikez.it/categoria/scheda/gardaland'; 
const HISTORY_FILE = 'tikez-stock-history.json';

async function scrapeAndCalculate() {
  try {
    const response = await fetch(TARGET_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const todayStr = new Date().toISOString().split('T')[0];
    const currentData = {
      date: todayStr,
      tickets: {}
    };

    // Cerchiamo direttamente gli elementi img con id="plus" che contengono l'attributo max
    $('img#plus').each((_, element) => {
      const imgPlus = $(element);
      const maxAttr = imgPlus.attr('max');
      const maxAvailable = maxAttr ? parseInt(maxAttr, 10) : 0;

      // Risaliamo al contenitore di riga del biglietto
      const row = imgPlus.closest('.row');

      // Nome del biglietto (contenuto nel tag p con classe font-semi-bold)
      const name = row.find('p.font-semi-bold').text().trim();

      // Prezzo (estraiamo il valore numerico con decimali)
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

    // Controllo se sono stati estratti biglietti
    if (Object.keys(currentData.tickets).length === 0) {
      console.error('❌ Nessun biglietto trovato! Verificare che TARGET_URL sia la pagina corretta con la scheda del biglietto.');
      process.exit(1);
    }

    // Carica lo storico precedente
    let history = {};
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      } catch (e) {
        history = {};
      }
    }

    // Identifica la data dell'ultimo scraping
    const dates = Object.keys(history).filter(d => d !== todayStr).sort();
    const lastDate = dates[dates.length - 1];

    // Calcolo delle vendite rispetto al precedente scraping
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

    // Salvataggio nello storico
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
