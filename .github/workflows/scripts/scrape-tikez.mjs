import fs from 'fs';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://www.tikez.it/categoria/scheda/gardaland'; // Sostituisci/estendi con le tue pagine
const HISTORY_FILE = 'tikez-stock-history.json';

async function scrapeAndCalculate() {
  try {
    // 1. Scarica l'HTML della pagina
    const response = await fetch(TARGET_URL);
    const html = await response.text();
    const $ = cheerio.load(html);

    const todayStr = new Date().toISOString().split('T')[0];
    const currentData = {
      date: todayStr,
      tickets: {}
    };

    // 2. Estrazione dei dati dai blocchi biglietto
    $('.list-group-item').each((_, element) => {
      const container = $(element).closest('.row');
      
      // Nome e prezzo del biglietto
      const name = container.find('p.font-semi-bold').text().trim();
      const rawText = container.find('.col-6').first().text();
      const priceMatch = rawText.match(/(\d+[\.,]\d{2})\s*€/);
      const price = priceMatch ? priceMatch[1] : 'N/D';

      // Quantità massima dal tag img#plus
      const maxAttr = container.find('img#plus').attr('max');
      const maxAvailable = maxAttr ? parseInt(maxAttr, 10) : 0;

      if (name) {
        currentData.tickets[name] = {
          price: price,
          available: maxAvailable,
          soldToday: 0
        };
      }
    });

    // 3. Carica lo storico dei giorni precedenti se esiste
    let history = {};
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }

    // Identifica la data dell'ultimo scraping effettuato
    const dates = Object.keys(history).sort();
    const lastDate = dates[dates.length - 1];

    // 4. Confronto con ieri e calcolo delle vendite
    if (lastDate && history[lastDate]?.tickets) {
      const yesterdayTickets = history[lastDate].tickets;

      for (const [ticketName, data] of Object.entries(currentData.tickets)) {
        const prevAvailable = yesterdayTickets[ticketName]?.available;

        if (prevAvailable !== undefined) {
          if (data.available < prevAvailable) {
            // Caso 1: Quantità diminuita = biglietti venduti
            data.soldToday = prevAvailable - data.available;
          } else {
            // Caso 2: Quantità pari o aumentata = restock/ricarica
            data.soldToday = 0;
          }
        }
      }
    }

    // 5. Salva i nuovi dati nello storico
    history[todayStr] = currentData;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

    console.log(`✅ Scraping e calcolo completati per il ${todayStr}:`);
    console.dir(currentData.tickets, { depth: null });

  } catch (error) {
    console.error('❌ Errore durante lo scraping:', error);
    process.exit(1);
  }
}

scrapeAndCalculate();
