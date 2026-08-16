import { writeFile } from 'node:fs/promises';

const currentYear = new Date().getFullYear();
const API_URL = 'https://queue-times.com/parks/12/queue_times.json';
const OUTPUT_FILE = 'gardaland-stats-current-year.json';

async function main() {
  console.log(`📡 Chiamata API Queue-Times per Gardaland...`);

  try {
    const res = await fetch(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    const rides = [];

    // I dati sono divisi in "lands" (aree del parco)
    if (data && data.lands) {
      for (const land of data.lands) {
        if (land.rides) {
          for (const ride of land.rides) {
            rides.push({
              id: ride.id,
              name: ride.name,
              isOpen: ride.is_open,
              waitMinutes: ride.wait_time,
              lastUpdated: ride.updated_at
            });
          }
        }
      }
    }

    // Ordina per tempo di attesa decrescente
    rides.sort((a, b) => b.waitMinutes - a.waitMinutes);

    const payload = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        year: currentYear,
        totalRides: rides.length,
        source: API_URL
      },
      rides
    };

    await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`✅ Salvate con successo ${rides.length} attrazioni in ${OUTPUT_FILE}`);

  } catch (err) {
    console.error('❌ Errore durante il recupero dei dati:', err.message);
    process.exit(1);
  }
}

main();
