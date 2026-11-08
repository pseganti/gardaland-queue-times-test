// Controllo novità CanevaWorld (pagine Eventi e Promozioni) con avviso su Telegram.
// Apre le pagine con un browser vero (il sito blocca le letture semplici), legge i riquadri
// (titolo + testo), li confronta con l'ultima lettura salvata e manda un messaggio solo se
// qualcosa è stato aggiunto, tolto o modificato.
// Stato salvato in canevaworld-watch.json nella radice del repository.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const STATE_FILE = path.join(ROOT, 'canevaworld-watch.json');

const PAGES = [
  { key: 'eventi', label: 'Eventi', url: 'https://www.canevaworld.it/eventi.html' },
  { key: 'promozioni', label: 'Promozioni', url: 'https://www.canevaworld.it/promozioni.html' }
];

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

async function readCards(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // Ogni evento/promo è un riquadro .caption-cnt con un titolo h3
  return page.evaluate(() => [...document.querySelectorAll('.caption-cnt')]
    .map(c => {
      const h = c.querySelector('h3.title, h3');
      const title = (h?.textContent || '').trim().replace(/\s+/g, ' ');
      const text = c.innerText.trim().replace(/\s+/g, ' ');
      return { title, text };
    })
    .filter(c => c.title));
}

async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN, chat = process.env.TG_CHAT_ID;
  if (!token || !chat) { console.log('ℹ️ TG_BOT_TOKEN / TG_CHAT_ID non impostati: messaggio non inviato.\n' + text); return; }
  // Telegram accetta al massimo 4096 caratteri per messaggio
  for (let i = 0; i < text.length; i += 3900) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(i, i + 3900), disable_web_page_preview: true })
    });
    if (!r.ok) console.warn('⚠️ Telegram:', r.status, await r.text());
  }
}

async function run() {
  const prev = readJson(STATE_FILE, null);
  const state = { checkedAt: new Date().toISOString(), pages: {} };
  const report = [];

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'it-IT'
  });
  const page = await context.newPage();

  for (const p of PAGES) {
    let cards;
    try {
      cards = await readCards(page, p.url);
    } catch (e) {
      console.warn(`⚠️ ${p.label}: ${e.message}`);
    }
    if (!cards || !cards.length) {
      // Pagina non letta o struttura cambiata: si tiene lo stato precedente, nessun falso allarme
      console.warn(`⚠️ ${p.label}: nessun riquadro letto, stato precedente mantenuto`);
      if (prev?.pages?.[p.key]) state.pages[p.key] = prev.pages[p.key];
      continue;
    }
    const items = {};
    cards.forEach(c => { if (!items[c.title]) items[c.title] = { text: c.text, hash: hash(c.text) }; });
    state.pages[p.key] = { url: p.url, items };
    console.log(`✅ ${p.label}: ${Object.keys(items).length} riquadri`);

    const old = prev?.pages?.[p.key]?.items;
    if (!old) continue; // prima lettura di questa pagina: solo salvataggio
    const added = Object.keys(items).filter(t => !old[t]);
    const removed = Object.keys(old).filter(t => !items[t]);
    const changed = Object.keys(items).filter(t => old[t] && old[t].hash !== items[t].hash);
    if (added.length || removed.length || changed.length) {
      const lines = [`📄 ${p.label}`];
      added.forEach(t => lines.push(`➕ NUOVO: ${t}\n   ${short(items[t].text, 300)}`));
      changed.forEach(t => lines.push(`✏️ MODIFICATO: ${t}\n   ${short(items[t].text, 300)}`));
      removed.forEach(t => lines.push(`➖ TOLTO: ${t}`));
      lines.push(`🔗 ${p.url}`);
      report.push(lines.join('\n'));
    }
  }
  await browser.close();

  if (!prev) {
    const counts = PAGES.map(p => `${p.label}: ${Object.keys(state.pages[p.key]?.items || {}).length}`).join(' · ');
    await sendTelegram(`👀 Controllo CanevaWorld attivo.\nRiquadri letti — ${counts}.\nTi scrivo quando compare, cambia o sparisce qualcosa.`);
  } else if (report.length) {
    await sendTelegram(`🎢 CanevaWorld – novità\n\n${report.join('\n\n')}`);
  } else {
    console.log('Nessuna novità.');
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

run().catch(e => { console.error(e); process.exit(1); });
