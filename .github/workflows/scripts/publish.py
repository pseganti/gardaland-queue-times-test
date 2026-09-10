import json
import os
import sys
from datetime import datetime, timedelta
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

# Emoji per weathercode WMO (Open-Meteo)
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

CROWD_EMOJI = {
    "low": "🟢",
    "medium": "🟡",
    "high": "🔴",
    "unknown": "⚪",
}


def normalize_time(t: str) -> tuple[str, bool]:
    """
    Ritorna (HH:MM, next_day).
    Gestisce '24:00' -> '00:00' next_day=True, '00:00' -> resta ma segnalato.
    """
    if t == "24:00":
        return "00:00", True
    return t, False


def format_hours(entry: dict) -> str:
    """Formatta una voce orari. Ritorna 'CHIUSO' se non ha open/close."""
    if "show" in entry:
        return f"spettacolo ore {entry['show']}"
    if "open" not in entry or "close" not in entry:
        return "CHIUSO"
    o, _ = normalize_time(entry["open"])
    c, next_day = normalize_time(entry["close"])
    suffix = " (+1)" if next_day else ""
    return f"{o} – {c}{suffix}"


def get_weather(lat=45.44, lon=10.71):
    """Meteo da Open-Meteo per Castelnuovo del Garda."""
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


def get_opening_hours(target_date: datetime):
    """Legge opening-hours.json da Netlify e filtra per data."""
    key = target_date.strftime("%Y-%m-%d")
    try:
        r = requests.get(OPENING_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"⚠️ opening-hours.json non disponibile: {e}")
        return None, key

    lines = []
    for park_id, label in PARKS.items():
        park_data = data.get(park_id, {})
        entry = park_data.get(key)
        if entry is None:
            status = "CHIUSO"
        else:
            status = format_hours(entry)
        lines.append(f"• {label}: {status}")
    return "\n".join(lines), key


def get_crowd(target_date: datetime):
    """Legge gardaland-calendar-export.json e ritorna l'affluenza di Gardaland."""
    key = target_date.strftime("%Y-%m-%d")
    month_key = target_date.strftime("%Y-%m")
    try:
        r = requests.get(CALENDAR_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"⚠️ calendar export non disponibile: {e}")
        return ""

    month = data.get("months", {}).get(month_key, {})
    for day in month.get("days", []):
        if day.get("date") == key:
            level = day.get("crowdLevel", "N/D")
            intensity = day.get("crowdIntensity", "unknown")
            emoji = CROWD_EMOJI.get(intensity, "⚪")
            label = {
                "low": "bassa",
                "medium": "media",
                "high": "alta",
                "unknown": "n/d",
            }.get(intensity, intensity)
            return f"{emoji} Affollamento Gardaland: {level} ({label})"
    return ""


def publish_to_facebook():
    access_token = os.environ.get("FB_PAGE_TOKEN")
    if not access_token:
        print("❌ FB_PAGE_TOKEN non impostato.")
        sys.exit(1)

    # Data target: oggi in Italia
    now = datetime.utcnow() + timedelta(hours=2)  # Europe/Rome circa
    today = now
    tomorrow = now + timedelta(days=1)

    weather_info = get_weather()
    hours_today, key_today = get_opening_hours(today)
    hours_tomorrow, _ = get_opening_hours(tomorrow)
    crowd_info = get_crowd(today)

    parts = [f"☀️ Buongiorno! Ecco gli aggiornamenti per oggi ({key_today}):"]

    if weather_info:
        parts.append(weather_info)

    if hours_today:
        parts.append(f"🕒 *Orari oggi:*\n{hours_today}")
    if hours_tomorrow:
        parts.append(f"📅 *Orari domani:*\n{hours_tomorrow}")
    if crowd_info:
        parts.append(crowd_info)

    parts.append("\n#gardaland #meteo #orari #castelnuovodelgarda #gardalandresort")

    full_message = "\n\n".join(parts)
    print("----- MESSAGGIO -----")
    print(full_message)
    print("---------------------")

    url = "https://graph.facebook.com/v19.0/me/feed"
    payload = {"message": full_message, "access_token": access_token}
    res = requests.post(url, data=payload)
    if res.status_code == 200:
        print(f"✅ Post pubblicato: {res.json()}")
    else:
        print(f"❌ Errore ({res.status_code}): {res.text}")
        sys.exit(1)


if __name__ == "__main__":
    publish_to_facebook()
