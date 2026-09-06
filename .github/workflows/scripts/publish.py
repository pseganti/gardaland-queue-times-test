import json
import os
import sys
import requests

def get_weather(lat=45.44, lon=10.71):
    """
    Recupera il meteo da Open-Meteo per Castelnuovo del Garda (45.44, 10.71).
    """
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FRome"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        max_temp = data["daily"]["temperature_2m_max"][0]
        min_temp = data["daily"]["temperature_2m_min"][0]
        return f"🌡️ Meteo oggi: Min {min_temp}°C / Max {max_temp}°C"
    except Exception as e:
        print(f"Attenzione: Impossibile recuperare i dati meteo: {e}")
        return ""

def get_opening_hours():
    """Recupera gli orari dei parchi direttamente da Netlify."""
    url = "https://paolotickets.netlify.app/opening-hours.json"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        gardaland_oggi = data.get("gardaland", {}).get("orari", {}).get("oggi", "N/D")
        sealife_oggi = data.get("sealife", {}).get("orari", {}).get("oggi", "N/D")
        legoland_oggi = data.get("legoland", {}).get("orari", {}).get("oggi", "N/D")
        
        return f"🎡 Orari Oggi:\n• Gardaland: {gardaland_oggi}\n• Sea Life: {sealife_oggi}\n• Legoland: {legoland_oggi}"
    except Exception as e:
        print(f"Attenzione: Impossibile recuperare gli orari da Netlify: {e}")
        return ""

def publish_to_facebook():
    """Pubblica il post sulla Pagina Facebook tramite Graph API."""
    access_token = os.environ.get("FB_PAGE_TOKEN")

    if not access_token:
        print("Errore: La variabile d'ambiente FB_PAGE_TOKEN non è impostata.")
        sys.exit(1)

    weather_info = get_weather()
    hours_info = get_opening_hours()

    message_parts = ["☀️ Buongiorno! Ecco gli aggiornamenti per oggi:"]
    
    if weather_info:
        message_parts.append(weather_info)
        
    if hours_info:
        message_parts.append(hours_info)
        
    message_parts.append("\n#gardaland #meteo #orari #castelnuovodelgarda")

    full_message = "\n\n".join(message_parts)

    url = "https://graph.facebook.com/v19.0/me/feed"
    payload = {
        "message": full_message,
        "access_token": access_token
    }

    print("Inizio pubblicazione su Facebook...")
    res = requests.post(url, data=payload)

    if res.status_code == 200:
        print(f"✅ Post pubblicato con successo! Response: {res.json()}")
    else:
        print(f"❌ Errore durante la pubblicazione ({res.status_code}): {res.text}")
        sys.exit(1)

if __name__ == "__main__":
    publish_to_facebook()
