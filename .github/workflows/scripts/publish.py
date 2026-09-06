import json
import requests
from datetime import datetime

# Se usi un file JSON locale:
def carica_dati_locali(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)

# Se i dati si trovano su un endpoint remoto:
def carica_dati_url(url):
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def genera_post_meteo_orari(data):
    # Esempio di estrazione dai dati del parco/meteo
    # Adatta i campi in base alla struttura esatta del tuo JSON
    
    # Dati di oggi
    oggi_meteo = "Soleggiato, temperatura fino a 33°C (minima 22°C)"
    
    # Orari Gardaland
    gardaland_oggi = data.get("gardaland", {}).get("orari", {}).get("oggi", "10:00 - 23:00")
    sealife_oggi = data.get("sealife", {}).get("orari", {}).get("oggi", "10:00 - 18:00")
    legoland_oggi = data.get("legoland", {}).get("orari", {}).get("oggi", "10:00 - 19:00")
    
    gardaland_domani = data.get("gardaland", {}).get("orari", {}).get("domani", "10:00 - 18:00")
    sealife_domani = data.get("sealife", {}).get("orari", {}).get("domani", "10:00 - 18:00")
    legoland_domani = data.get("legoland", {}).get("orari", {}).get("domani", "10:00 - 18:00")

    post = f"""☀️ **Meteo e Orari dei Parchi a Castelnuovo del Garda** 🎡

📍 **Oggi**
* **Meteo:** {oggi_meteo}
* **Gardaland:** {gardaland_oggi}
* **Sea Life:** {sealife_oggi}
* **Legoland Water Park:** {legoland_oggi}

***

🌤️ **Domani**
* **Meteo:** Prevalenza di sole, temperatura massima 32°C (minima 21°C).
* **Gardaland:** {gardaland_domani}
* **Sea Life:** {sealife_domani}
* **Legoland Water Park:** {legoland_domani}
"""
    return post

if __name__ == "__main__":
    # Sostituisci con il percorso del tuo file .json o chiama carica_dati_url(...)
    data = carica_dati_locali("attrazioni.json")
    testo_post = genera_post_meteo_orari(data)
    print(testo_post)
