// Live weather for Gandhinagar from Open-Meteo (free, no API key, CC BY 4.0 data). Fetched only by the
// server side (Cloudflare Worker or the Vite dev middleware) and cached there, so visitors' browsers still
// talk to this site alone. Maps the WMO weather code to a label and to one of the map's existing layers.

export const GANDHINAGAR = { lat: 23.2156, lon: 72.6369 };
export const CACHE_SECONDS = 600;
export const SOURCE = 'Open-Meteo.com (CC BY 4.0)';

export function weatherUrl({ lat, lon } = GANDHINAGAR) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,cloud_cover,is_day,wind_speed_10m&timezone=Asia%2FKolkata`;
}

const CODES = [
  [[0], 'Clear', '☀️'], [[1], 'Mostly clear', '🌤️'], [[2], 'Partly cloudy', '⛅'], [[3], 'Overcast', '☁️'],
  [[45, 48], 'Fog', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'], [[61, 63, 66, 80, 81], 'Rain', '🌧️'],
  [[65, 67, 82], 'Heavy rain', '🌧️'], [[71, 73, 75, 77, 85, 86], 'Snow', '❄️'], [[95, 96, 99], 'Thunderstorm', '⛈️'],
];
export function describe(code) {
  const row = CODES.find(([codes]) => codes.includes(code));
  return row ? { label: row[1], icon: row[2] } : { label: 'Unknown', icon: '🌡️' };
}
export const isWet = (code) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;

// Which existing layer matches the sky: night after dark, monsoon when it rains (or heavy overcast in
// the June–September monsoon), winter morning light from December to February, otherwise summer day.
export function pickLayer({ code, isDay, cloud }, month) {
  if (!isDay) return 'night';
  if (isWet(code) || (month >= 6 && month <= 9 && cloud >= 85)) return 'monsoon';
  if (month === 12 || month <= 2) return 'winter';
  return 'A';
}

export function fromOpenMeteo(json, now = Date.now()) {
  const c = json?.current;
  if (!c || !Number.isFinite(c.weather_code)) throw new Error('unexpected weather response');
  const month = Number((c.time || new Date(now + 5.5 * 3600e3).toISOString()).slice(5, 7));
  const w = { code: c.weather_code, isDay: c.is_day === 1, cloud: c.cloud_cover ?? 0, temp: Math.round(c.temperature_2m), rain: c.precipitation ?? 0, wind: Math.round(c.wind_speed_10m ?? 0) };
  return { ...w, ...describe(w.code), layer: pickLayer(w, month), observed: c.time || null, fetchedAt: new Date(now).toISOString(), source: SOURCE };
}

// Fetch + map, for any runtime with fetch (Workers, Node 22). Caching is the caller's job.
export async function fetchWeather(fetchImpl = fetch, now = Date.now()) {
  const res = await fetchImpl(weatherUrl(), { headers: { 'user-agent': 'pixel-city-gandhinagar (imlistack.com)' } });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  return fromOpenMeteo(await res.json(), now);
}
