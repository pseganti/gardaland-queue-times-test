import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import requests

# ============ CONFIGURAZIONE ============
BASE_URL = "https://paolotickets.netlify.app"
OPENING_URL = f"{BASE_URL}/opening-hours.json"
CALENDAR_URL = f"{BASE_URL}/gardaland-calendar-export.json"

PARKS = {
    "gardaland": "🎢 Gardaland",
    "sealife":   "🐠 Sea Life",
    "legoland":  "🧱 Legoland",
    "caneva":    "💦 Caneva Aquapark",
    "movieland": "🎬 Movieland",
    "medieval":  "🏰 Medieval Times",
}

GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì",
          "venerdì", "sabato", "domenica"]
MESI = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

WEATHER_EMOJI = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️",
    71: "🌨️", 73: "🌨️", 75: "🌨️", 77: "🌨️",
    80: "🌦️", 81: "🌧️", 82: "⛈️",
    85: "🌨️", 86: "🌨️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}

CROWD_EMOJI = {"low": "🟢", "medium": "🟡", "high": "🔴", "unknown": "⚪"}
CROWD_LABEL = {"low": "bassa", "medium": "media",
               "high": "alta", "unknown": "n/d"}


# ============ UTILITY ============
def italian_date(d: datetime, with_year: bool = True) -> str:
    """giovedì 10 settembre 2026"""
    txt = f"{GIORNI[d.weekday()]} {d.day} {MESI[d.month]}"
    if with_year:
        txt += f" {d.year}"
    return txt


def normalize_time(t: str) -> tuple[str, bool]:
    if t == "24:00":
        return "00:00", True
    return t, False


def format_hours(entry: dict) -> str:
    if "show" in entry:
        return f"spettacolo ore {entry['show']}"
    if "open" not in entry or "close" not in entry:
        return "CHIUSO"
    o, _ = normalize_time(entry["open"])
    c, next_day = normalize_time(entry["close"])
    suffix = " (+1)" if next_day else ""
    return f"{o} – {c}{suffix}"


# ============ METEO ============
def get_weather(lat=45.44, lon=10.71):
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
        f"&timezone=Europe%2FRome"
    )
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        d = r.json()["daily"]
        code = d["weathercode"][0]
        tmax = d["temperature_2m_max"][0]
        tmin = d["temperature_2m_min"][0]
        rain = d.get("precipitation_probability_max", [None])[0]
        emoji = WEATHER_EMOJI.get(code, "🌡️")
        rain_txt = f" • ☔ {rain}%" if rain is not None else ""
        return f"{emoji} Meteo: {tmin}°C / {tmax}°C{rain_txt}"
    except Exception as e:
        print(f"⚠️ Meteo non disponibile: {e}")
        return ""


# ============ ORARI ============
def get_opening_hours(target_date: datetime):
    key = target_date.strftime("%Y-%m-%d")
    try:
        r = requests.get(OPENING_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"⚠️ opening-hours.json non disponibile: {e}")
        return None

    lines = []
    for park_id, label in PARKS.items():
        entry = data.get(park_id, {}).get(key)
        status = format_hours(entry) if entry else "CHIUSO"
        lines.append(f"• {label}: {status}")
    return "\n".join(lines)


# ============ AFFOLLAMENTO ============
def get_crowd(target_date: datetime):
    key = target_date.strftime("%Y-%m-%d")
    month_key = target_date.strftime("%Y-%m")
    try:
        r = requests.get(CALENDAR_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"⚠️ calendar export non disponibile: {e}")
        return None

    month = data.get("months", {}).get(month_key, {})
    for day in month.get("days", []):
        if day.get("date") == key:
            level = day.get("crowdLevel", "N/D")
            intensity = day.get("crowdIntensity", "unknown")
            emoji = CROWD_EMOJI.get(intensity, "⚪")
            label = CROWD_LABEL.get(intensity, intensity)
            return f"{emoji} Affollamento Gardaland: {level} ({label})"
    return None


# ============ FACEBOOK PAGE LINK ============
def get_page_info(access_token: str):
    """Recupera nome e link della Pagina dal token."""
    try:
        r = requests.get(
            "https://graph.facebook.com/v19.0/me",
            params={"fields": "name,link", "access_token": access_token},
            timeout=10,
        )
        r.raise_for_status()
        d = r.json()
        return d.get("name"), d.get("link")
    except Exception as e:
        print(f"⚠️ Impossibile recuperare info pagina: {e}")
        return None, None


# ============ PUBBLICAZIONE ============
def publish_to_facebook():
    access_token = os.environ.get("FB_PAGE_TOKEN")
    if not access_token:
        print("❌ FB_PAGE_TOKEN non impostato.")
        sys.exit(1)

    now = datetime.now(ZoneInfo("Europe/Rome"))
    today = now
    tomorrow = now + timedelta(days=1)

    weather_info = get_weather()
    hours_today = get_opening_hours(today)
    hours_tomorrow = get_opening_hours(tomorrow)
    crowd_today = get_crowd(today)

    # Intestazione con data italiana
    parts = [f"☀️ Buongiorno! Ecco gli aggiornamenti per {italian_date(today)}:"]

    # Meteo + affollamento subito sotto
    if weather_info:
        parts.append(weather_info)
    if crowd_today:
        parts.append(crowd_today)

    # Orari oggi
    if hours_today:
        parts.append(f"🕒 *Orari oggi:*\n{hours_today}")

    # Orari domani (senza anno)
    if hours_tomorrow:
        domani_label = italian_date(tomorrow, with_year=False)
        parts.append(f"📅 *Orari domani {domani_label}:*\n{hours_tomorrow}")

    # Invito a seguire la pagina
    page_name, page_link = get_page_info(access_token)
    if page_link:
        follow = f"👉 Segui la pagina {page_name} per aggiornamenti e info: {page_link}"
    elif page_name:
        follow = f"👉 Segui la pagina {page_name} per aggiornamenti e info!"
    else:
        follow = "👉 Segui la nostra pagina per aggiornamenti e info!"
    parts.append(follow)

    parts.append("#gardaland #meteo #orari #castelnuovodelgarda #gardalandresort")

    full_message = "\n\n".join(parts)
    print("----- MESSAGGIO -----")
    print(full_message)
    print("---------------------")

    res = requests.post(
        "https://graph.facebook.com/v19.0/me/feed",
        data={"message": full_message, "access_token": access_token},
    )
    if res.status_code == 200:
        print(f"✅ Post pubblicato: {res.json()}")
    else:
        print(f"❌ Errore ({res.status_code}): {res.text}")
        sys.exit(1)


if __name__ == "__main__":
    publish_to_facebook()
