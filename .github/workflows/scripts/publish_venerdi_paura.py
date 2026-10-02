"""
Post Facebook "Venerdì da Paura" (Gardaland Magic Halloween, serate del venerdì).

Lo avvia cron-job.org (workflow_dispatch del workflow halloween-facebook-post.yml).
Pubblica SOLO se oggi Gardaland apre la sera (apertura dalle 16:00 in poi in
opening-hours.json): negli altri giorni esce senza pubblicare, quindi il cron
può girare ogni venerdì (o anche ogni giorno) senza rischi.

Variabili d'ambiente:
  FB_PAGE_TOKEN  token della Pagina (GitHub Secret)
  DRY_RUN        "true" = stampa il messaggio nel log senza pubblicare
  FORCE          "true" = pubblica anche se oggi non è una serata (solo per prove)
"""
import os
import random
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
import requests

# ============ CONFIGURAZIONE ============
BASE_URL = "https://gardaparks.it"
OPENING_URL = f"{BASE_URL}/opening-hours.json"
PAGE_URL = f"{BASE_URL}/halloween-gardaland.html"
WHATSAPP_URL = "https://wa.me/393667166568"
OFFICIAL_URL = "https://www.gardaland.it/esplora-gardaland/eventi-aperture-speciali/magic-halloween/"
# Immagini del post: ne viene scelta una a caso (devono essere già online sul sito)
IMAGES = [
    f"{BASE_URL}/images/halloween/halloween-1.jpg",
    f"{BASE_URL}/images/halloween/halloween-2.jpg",
    f"{BASE_URL}/images/halloween/halloween-3.jpg",
    f"{BASE_URL}/images/halloween/halloween-4.jpg",
]
EVENING_FROM_HOUR = 16         # apertura da quest'ora in poi = serata
GARDALAND_LAT, GARDALAND_LON = 45.4545, 10.7140

GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì",
          "venerdì", "sabato", "domenica"]
MESI = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

WEATHER_EMOJI = {
    0: "🌙", 1: "🌙", 2: "☁️", 3: "☁️", 45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️", 61: "🌧️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️", 80: "🌦️", 81: "🌧️", 82: "⛈️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}


def italian_date(d, with_weekday=True):
    txt = f"{d.day} {MESI[d.month]}"
    return f"{GIORNI[d.weekday()]} {txt}" if with_weekday else txt


def is_evening(entry):
    try:
        return int(entry["open"].split(":")[0]) >= EVENING_FROM_HOUR
    except Exception:
        return False


def show_time(t):
    return "00:00" if t in ("24:00",) else t


# ============ DATI ============
def load_gardaland_hours():
    r = requests.get(OPENING_URL, timeout=15)
    r.raise_for_status()
    return r.json().get("gardaland", {})


def evening_weather(day_key):
    """Meteo serale (18:00–22:00) a Gardaland: temperatura e pioggia."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={GARDALAND_LAT}&longitude={GARDALAND_LON}"
        "&hourly=temperature_2m,precipitation_probability,weathercode"
        "&timezone=Europe%2FRome&forecast_days=2"
    )
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        h = r.json()["hourly"]
        idx = [i for i, t in enumerate(h["time"])
               if t.startswith(day_key) and 18 <= int(t[11:13]) <= 22]
        if not idx:
            return ""
        temps = [h["temperature_2m"][i] for i in idx]
        rain = max((h["precipitation_probability"][i] or 0) for i in idx)
        code = h["weathercode"][idx[len(idx) // 2]]
        emoji = WEATHER_EMOJI.get(code, "🌡️")
        return (f"{emoji} Meteo in serata: {round(max(temps))}°C → {round(min(temps))}°C"
                f" • ☔ {rain}%")
    except Exception as e:
        print(f"⚠️ Meteo non disponibile: {e}")
        return ""


# ============ MESSAGGIO ============
def build_message(today, entry, next_dates):
    o, c = show_time(entry["open"]), show_time(entry["close"])
    parts = [
        f"🎃👻 STASERA VENERDÌ DA PAURA A GARDALAND! 👻🎃\n{italian_date(today).capitalize()}",
        f"⚠️ Il parco apre SOLO LA SERA, dalle {o} alle {c}.\n"
        f"Di giorno Gardaland è CHIUSO: non presentatevi al mattino!",
    ]

    weather = evening_weather(today.strftime("%Y-%m-%d"))
    if weather:
        parts.append(weather)

    parts.append(
        "🧟 Al buio alcune zone diventano Zombie Area, con creature e scenari più spaventosi del giorno.\n"
        "👽 Da provare PREDA, la novità 2026: un labirinto da attraversare in silenzio.\n"
        "👨‍👩‍👧 Con bambini piccoli o paurosi meglio Magic Halloween di giorno, nel weekend."
    )

    parts.append(
        "💡 I miei consigli:\n"
        "• Arrivate per l'apertura, così sfruttate tutta la serata\n"
        "• Portate una felpa: a ottobre la sera sul lago fa fresco\n"
        "• Organizzatevi per la cena al parco\n"
        "• Controllate prima come tornare: la sera bus e navette sono meno frequenti"
    )

    if next_dates:
        parts.append("📅 Prossime serate: " + ", ".join(italian_date(d, False) for d in next_dates))

    parts.append(
        f"📖 Guida completa (orari, cosa vedere, se è adatto ai bambini):\n{PAGE_URL}\n"
        f"🌐 Programma ufficiale: {OFFICIAL_URL}\n"
        f"💬 Domande? Scrivimi su WhatsApp, rispondo io: {WHATSAPP_URL}"
    )

    parts.append("#gardaland #magichalloween #venerdidapaura #halloween #lagodigarda #gardalandresort")
    return "\n\n".join(parts)


# ============ PUBBLICAZIONE ============
def main():
    dry_run = os.environ.get("DRY_RUN", "").lower() == "true"
    force = os.environ.get("FORCE", "").lower() == "true"
    token = (os.environ.get("FB_PAGE_TOKEN") or "").strip()
    if not token and not dry_run:
        print("❌ FB_PAGE_TOKEN non impostato.")
        sys.exit(1)

    now = datetime.now(ZoneInfo("Europe/Rome"))
    today_key = now.strftime("%Y-%m-%d")

    try:
        hours = load_gardaland_hours()
    except Exception as e:
        print(f"❌ opening-hours.json non disponibile: {e}")
        sys.exit(1)

    entry = hours.get(today_key)
    if not entry or not is_evening(entry):
        if not force:
            print(f"ℹ️ {today_key}: oggi non c'è una serata (orari: {entry or 'chiuso'}). Nessun post.")
            return
        print("⚠️ FORCE attivo: pubblico anche se oggi non è una serata.")
        entry = entry if entry and "open" in entry else {"open": "17:00", "close": "22:00"}

    next_dates = sorted(
        datetime.strptime(k, "%Y-%m-%d") for k, v in hours.items()
        if k > today_key and isinstance(v, dict) and is_evening(v)
    )[:4]

    message = build_message(now, entry, next_dates)
    image = random.choice(IMAGES)
    print("----- MESSAGGIO -----")
    print(message)
    print("---------------------")
    print(f"🖼️ Immagine scelta: {image}")

    if dry_run:
        print("🧪 DRY_RUN: messaggio NON pubblicato.")
        return

    # 1) Post con foto (immagine a caso fra le 4) e testo come didascalia
    res = requests.post(
        "https://graph.facebook.com/v19.0/me/photos",
        data={"url": image, "caption": message, "access_token": token},
        timeout=60,
    )
    if res.status_code == 200:
        print(f"✅ Post con foto pubblicato: {res.json()}")
        return
    print(f"⚠️ Foto non pubblicata ({res.status_code}): {res.text}")

    # 2) Riserva: post con anteprima della pagina Halloween
    res = requests.post(
        "https://graph.facebook.com/v19.0/me/feed",
        data={"message": message, "link": PAGE_URL, "access_token": token},
        timeout=30,
    )
    if res.status_code == 200:
        print(f"✅ Post pubblicato senza foto (anteprima pagina): {res.json()}")
    else:
        print(f"❌ Errore ({res.status_code}): {res.text}")
        sys.exit(1)


if __name__ == "__main__":
    main()
