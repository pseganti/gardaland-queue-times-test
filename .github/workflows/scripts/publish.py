import os
import json
import requests

URL_OPENING_HOURS = "https://paolotickets.netlify.app/opening-hours.json"

def scarica_orari_da_netlify(url):
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()

def genera_post_meteo_orari(opening_hours_data):
    oggi_meteo = "Soleggiato, temperatura fino a 33°C (minima 22°C)"
    domani_meteo = "Prevalenza di sole, temperatura massima 32°C (minima 21°C)"
    
    gardaland_oggi = opening_hours_data.get("gardaland", {}).get("orari", {}).get("oggi", "N/D")
    sealife_oggi = opening_hours_data.get("sealife", {}).get("orari", {}).get("oggi", "N/D")
    legoland_oggi = opening_hours_data.get("legoland", {}).get("orari", {}).get("oggi", "N/D")
    
    gardaland_domani = opening_hours_data.get("gardaland", {}).get("orari", {}).get("domani", "N/D")
    sealife_domani = opening_hours_data.get("sealife", {}).get("orari", {}).get("domani", "N/D")
    legoland_domani = opening_hours_data.get("legoland", {}).get("orari", {}).get("domani", "N/D")

    return f"""☀️ **Meteo e Orari dei Parchi a Castelnuovo del Garda** 🎡

📍 **Oggi**
* **Meteo:** {oggi_meteo}
* **Gardaland:** {gardaland_oggi}
* **Sea Life:** {sealife_oggi}
* **Legoland Water Park:** {legoland_oggi}

***

🌤️ **Domani**
* **Meteo:** {domani_meteo}
* **Gardaland:** {gardaland_domani}
* **Sea Life:** {sealife_domani}
* **Legoland Water Park:** {legoland_domani}
"""

def pubblica_su_facebook(messaggio):
    page_id = os.environ.get("FB_PAGE_ID")
    access_token = os.environ.get("FB_PAGE_ACCESS_TOKEN")

    if not page_id or not access_token:
        raise ValueError("I Secrets FB_PAGE_ID o FB_PAGE_ACCESS_TOKEN non sono stati trovati nell membri dell'ambiente.")

    url = f"https://graph.facebook.com/v20.0/{page_id}/feed"
    payload = {
        "message": messaggio,
        "access_token": access_token
    }
    
    response = requests.post(url, data=payload, timeout=10)
    response_data = response.json()

    if response.status_code == 200:
        print(f"Post pubblicato con successo! ID: {response_data.get('id')}")
    else:
        print(f"Errore durante la pubblicazione su Facebook: {response_data}")
        response.raise_for_status()

if __name__ == "__main__":
    data = scarica_orari_da_netlify(URL_OPENING_HOURS)
    testo_post = genera_post_meteo_orari(data)
    
    # Invia il post a Facebook
    pubblica_su_facebook(testo_post)
