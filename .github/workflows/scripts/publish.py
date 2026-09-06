import json
import os
import sys
import requests

def get_weather(lat=45.19, lon=11.31):
    """
    Recupera il meteo da Open-Meteo per le coordinate specificate.
    Coordinate predefinite: Legnago / Verona (45.19, 11.31).
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

def get_custom_message():
    """Legge il messaggio dal file data.json."""
    json_path = "data.json"
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                content = json.load(f)
                return content.get("frase_del_giorno", "Buona giornata!")
        except Exception as e:
            print(f"Errore nella lettura di data.json: {e}")
    return "Buona giornata!"

def publish_to_facebook():
    """Pubblica il post sulla Pagina Facebook tramite Graph API."""
    access_token = os.environ.get("FB_PAGE_TOKEN")

    if not access_token:
        print("Errore: La variabile d'ambiente FB_PAGE_TOKEN non è impostata.")
        sys.exit(1)

    weather_info = get_weather()
    custom_phrase = get_custom_message()

    message_parts = [f"☀️ {custom_phrase}"]
    if weather_info:
        message_parts.append(weather_info)
    message_parts.append("\n#buongiorno #meteo")

    full_message = "\n\n".join(message_parts)

    # Usiamo /me/feed: con il Page Access Token pubblicherà direttamente sulla pagina proprietaria del token
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
