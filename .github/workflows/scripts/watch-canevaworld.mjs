// Controllo novità CanevaWorld (Eventi, Promozioni) e Gardaland (Offerte biglietti) con avviso su Telegram.
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

// mode 'cards': riquadri con titolo (CanevaWorld). mode 'text': righe di testo della parte principale,
// per pagine di cui non conosciamo ancora la struttura (es. Gardaland, oggi "nessuna offerta disponibile").
const PAGES = [
  { key: 'eventi', label: 'CanevaWorld – Eventi', url: 'https://www.canevaworld.it/eventi.html', mode: 'cards' },
  { key: 'promozioni', label: 'CanevaWorld – Promozioni', url: 'https://www.canevaworld.it/promozioni.html', mode: 'cards' },
  { key: 'gardaland-offerte', label: 'Gardaland – Offerte biglietti', url: 'https://www.gardaland.it/offerte/offerte-biglietti/', mode: 'text' }
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

// Pagine senza struttura nota: ogni riga di testo della parte principale diventa una voce
async function readTextLines(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  const lines = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return main.innerText.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(l => l.length > 2);
  });
  return [...new Set(lines)].map(l => ({ title: l, text: l }));
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
      cards = p.mode === 'text' ? await readTextLines(page, p.url) : await readCards(page, p.url);
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
    if (!old) { // prima lettura di questa pagina: solo salvataggio
      if (prev) report.push(`📄 ${p.label}\n👀 Ora controllo anche questa pagina (${Object.keys(items).length} voci).\n🔗 ${p.url}`);
      continue;
    }
    const added = Object.keys(items).filter(t => !old[t]);
    const removed = Object.keys(old).filter(t => !items[t]);
    const changed = Object.keys(items).filter(t => old[t] && old[t].hash !== items[t].hash);
    if (added.length || removed.length || changed.length) {
      const lines = [`📄 ${p.label}`];
      if (p.mode === 'text') {
        // Righe di testo: elenco compatto (max 25 per tipo)
        added.slice(0, 25).forEach(t => lines.push(`➕ ${short(t, 200)}`));
        removed.slice(0, 25).forEach(t => lines.push(`➖ ${short(t, 200)}`));
        if (added.length > 25 || removed.length > 25) lines.push('… altre righe: apri la pagina');
      } else {
        added.forEach(t => lines.push(`➕ NUOVO: ${t}\n   ${short(items[t].text, 300)}`));
        changed.forEach(t => lines.push(`✏️ MODIFICATO: ${t}\n   ${short(items[t].text, 300)}`));
        removed.forEach(t => lines.push(`➖ TOLTO: ${t}`));
      }
      lines.push(`🔗 ${p.url}`);
      report.push(lines.join('\n'));
    }
  }
  await browser.close();

  if (!prev) {
    const counts = PAGES.map(p => `${p.label}: ${Object.keys(state.pages[p.key]?.items || {}).length}`).join(' · ');
    await sendTelegram(`👀 Controllo eventi e offerte attivo.\nVoci lette — ${counts}.\nTi scrivo quando compare, cambia o sparisce qualcosa.`);
  } else if (report.length) {
    await sendTelegram(`🎢 Parchi – novità\n\n${report.join('\n\n')}`);
  } else {
    console.log('Nessuna novità.');
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

run().catch(e => { console.error(e); process.exit(1); });
