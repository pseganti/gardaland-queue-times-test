// ============================================
// generate-gardaland-insights.mjs
// Genera gardaland-insights.json (affluenza prevista + giorni migliori)
// Va nello stesso repo/progetto satellite "gardaland-wait-times",
// NON tocca gardaland.html — quello resta pubblicato a mano da Paolo.
//
// Uso: node scripts/generate-gardaland-insights.mjs
//
// Dati letti via HTTP da paolotickets.netlify.app (stesso pattern del
// wait-times-scraper: opening-hours.json e gardaland-calendar-export.json
// vivono nel sito principale, non in questo repo)
// Output:
//   - gardaland-insights.json
// ============================================

import { writeFile } from 'node:fs/promises';

const GARDALAND_LAT = 45.4297;
const GARDALAND_LON = 10.7203;
const DAYS_AHEAD = 10;
const CROWD_USELESS_THRESHOLD = 60;

const MAIN_SITE_BASE = 'https://paolotickets.netlify.app';

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function dayLabelIt(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`⚠️  ${url} → HTTP ${res.status}`);
      return {};
    }
    return await res.json();
  } catch (err) {
    console.warn(`⚠️  Impossibile scaricare ${url}: ${err.message}`);
    return {};
  }
}

async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${GARDALAND_LAT}&longitude=${GARDALAND_LON}` +
    `&daily=weathercode,temperature_2m_max,precipitation_probability_max&timezone=Europe%2FRome&forecast_days=${DAYS_AHEAD}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  const byDate = {};
  data.daily.time.forEach((dateStr, i) => {
    byDate[dateStr] = {
      tempMax: data.daily.temperature_2m_max[i],
      precipProb: data.daily.precipitation_probability_max[i],
      weatherCode: data.daily.weathercode[i]
    };
  });
  return byDate;
}

function weatherScore(day) {
  if (!day) return 0;
  if (day.precipProb >= 60) return 0;
  if (day.precipProb >= 30) return 1;
  return 2;
}

function crowdLevelToNumber(crowdLevel) {
  if (!crowdLevel) return null;
  return parseInt(String(crowdLevel).replace('%', ''), 10);
}

function getGardalandDayData(dateStr, gardalandCalendar) {
  const monthKey = dateStr.substring(0, 7);
  const monthData = gardalandCalendar?.months?.[monthKey];
  if (!monthData?.days) return null;
  return monthData.days.find(d => d.date === dateStr) || null;
}

function buildBestDays(gardalandCalendar, weatherByDate) {
  const today = new Date();
  const candidates = [];

  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = toDateStr(d);

    const dayData = getGardalandDayData(dateStr, gardalandCalendar);
    if (!dayData || dayData.hours === undefined) continue;

    const crowdNum = crowdLevelToNumber(dayData.crowdLevel);
    const wScore = weatherScore(weatherByDate[dateStr]);
    const crowdScore = crowdNum === null ? 50 : crowdNum;
    const totalScore = crowdScore - (wScore * 15);

    candidates.push({
      date: dateStr,
      label: dayLabelIt(dateStr),
      hours: dayData.hours,
      crowdLevel: dayData.crowdLevel || null,
      weather: weatherByDate[dateStr] || null,
      totalScore
    });
  }

  candidates.sort((a, b) => a.totalScore - b.totalScore);
  return candidates.slice(0, 3).map(({ totalScore, ...rest }) => rest);
}

function buildCrowdForecast(gardalandCalendar, weatherByDate) {
  const today = new Date();
  const rows = [];

  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = toDateStr(d);
    const dayData = getGardalandDayData(dateStr, gardalandCalendar);

    if (!dayData) {
      rows.push({ date: dateStr, label: dayLabelIt(dateStr), status: 'closed_or_unknown' });
      continue;
    }

    const crowdNum = crowdLevelToNumber(dayData.crowdLevel);
    const advice = crowdNum !== null
      ? (crowdNum < CROWD_USELESS_THRESHOLD ? 'express_probably_unnecessary' : 'express_recommended')
      : null;

    rows.push({
      date: dateStr,
      label: dayLabelIt(dateStr),
      hours: dayData.hours || null,
      crowdLevel: dayData.crowdLevel || null,
      advice
    });
  }

  return rows;
}

async function main() {
  const [openingHours, gardalandCalendar, weatherByDate] = await Promise.all([
    fetchJsonSafe(`${MAIN_SITE_BASE}/opening-hours.json`),
    fetchJsonSafe(`${MAIN_SITE_BASE}/gardaland-calendar-export.json`),
    fetchWeather()
  ]);

  const output = {
    generatedAt: new Date().toISOString(),
    crowdForecast: buildCrowdForecast(gardalandCalendar, weatherByDate),
    bestDays: buildBestDays(gardalandCalendar, weatherByDate)
  };

  await writeFile('gardaland-insights.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log('✅ gardaland-insights.json generato:', JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('❌ Errore generazione insights:', err);
  process.exit(1);
});
