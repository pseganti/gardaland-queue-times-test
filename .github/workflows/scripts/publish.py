import json
import requests

URL_OPENING_HOURS = "https://paolotickets.netlify.app/opening-hours.json"

def scarica_orari_da_netlify(url):
    response = requests.get(url, timeout=10)
    response.raise_for_status()  # Solleva un errore se la chiamata HTTP fallisce (es. 404, 500)
    return response.json()

def genera_post_meteo_orari(opening_hours_data):
    # Dati meteo di esempio per Castelnuovo del Garda
    oggi_meteo = "Soleggiato, temperatura fino a 33°C (minima 22°C)"
    domani_meteo = "Prevalenza di sole, temperatura massima 32°C (minima 21°C)"
    
    # Estrazione orari dal JSON di Netlify
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

if __name__ == "__main__":
    # Scarica il JSON aggiornato direttamente da Netlify
    data = scarica_orari_da_netlify(URL_OPENING_HOURS)
    
    # Genera e stampa il testo del post
    testo_post = genera_post_meteo_orari(data)
    print(testo_post)
