/**
 * Snow and weather from Open-Meteo (free, no API key):
 * conditions now, fresh snow in the last 24 h, snow depth and a 3-day outlook.
 */

export interface Weather {
  fetchedAt: number;
  tempC: number | null;
  feelsC: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  code: number | null;
  freshSnowCm: number; // last 24 h
  snowDepthCm: number | null;
  days: { date: string; code: number | null; minC: number | null; maxC: number | null; snowCm: number }[];
}

export function weatherUrl(lat: number, lon: number, elevation: number | null): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly: 'snowfall,snow_depth',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum',
    past_days: '1',
    forecast_days: '3',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  });
  // Forecast for your altitude rather than the valley floor.
  if (elevation != null && Number.isFinite(elevation)) p.set('elevation', String(Math.round(elevation)));
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turns an Open-Meteo response into what the app shows. Missing fields become null. */
export function parseWeather(json: unknown, now = Date.now()): Weather {
  const j = (json ?? {}) as {
    current?: Record<string, unknown>;
    hourly?: { time?: string[]; snowfall?: (number | null)[]; snow_depth?: (number | null)[] };
    daily?: { time?: string[]; weather_code?: (number | null)[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; snowfall_sum?: (number | null)[] };
    utc_offset_seconds?: number;
  };
  const off = (j.utc_offset_seconds ?? 0) * 1000;
  // Open-Meteo times are local wall-clock strings without a zone.
  const toMs = (s: string) => Date.parse(`${s}:00Z`) - off;
  const times = j.hourly?.time ?? [];
  let fresh = 0;
  let depth: number | null = null;
  times.forEach((ts, i) => {
    const t = toMs(ts);
    if (t <= now && t > now - 24 * 3600 * 1000) fresh += num(j.hourly?.snowfall?.[i]) ?? 0;
    if (t <= now) depth = num(j.hourly?.snow_depth?.[i]) ?? depth;
  });
  const today = new Date(now + off).toISOString().slice(0, 10);
  const d = j.daily ?? {};
  const days = (d.time ?? [])
    .map((date, i) => ({
      date,
      code: num(d.weather_code?.[i]),
      minC: num(d.temperature_2m_min?.[i]),
      maxC: num(d.temperature_2m_max?.[i]),
      snowCm: num(d.snowfall_sum?.[i]) ?? 0,
    }))
    .filter((x) => x.date >= today);
  return {
    fetchedAt: now,
    tempC: num(j.current?.temperature_2m),
    feelsC: num(j.current?.apparent_temperature),
    windKmh: num(j.current?.wind_speed_10m),
    gustKmh: num(j.current?.wind_gusts_10m),
    code: num(j.current?.weather_code),
    freshSnowCm: Math.round(fresh * 10) / 10,
    snowDepthCm: depth == null ? null : Math.round((depth as number) * 100), // metres → cm
    days,
  };
}

/** WMO weather code → emoji + short label. */
export function weatherInfo(code: number | null): { emoji: string; label: string } {
  if (code == null) return { emoji: '🌡️', label: '–' };
  if (code === 0) return { emoji: '☀️', label: 'Clear' };
  if (code <= 2) return { emoji: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', label: 'Cloudy' };
  if (code === 45 || code === 48) return { emoji: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: 'Drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { emoji: '🌧️', label: 'Rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { emoji: '🌨️', label: 'Snow' };
  if (code >= 95) return { emoji: '⛈️', label: 'Thunderstorm' };
  return { emoji: '🌡️', label: '–' };
}

export function fmtTemp(c: number | null, units: 'metric' | 'imperial'): string {
  if (c == null) return '–';
  return units === 'metric' ? `${Math.round(c)}°C` : `${Math.round((c * 9) / 5 + 32)}°F`;
}

export function fmtSnow(cm: number | null, units: 'metric' | 'imperial'): string {
  if (cm == null) return '–';
  return units === 'metric' ? `${Math.round(cm)} cm` : `${(cm / 2.54).toFixed(cm < 25 ? 1 : 0)} in`;
}

export function fmtWind(kmh: number | null, units: 'metric' | 'imperial'): string {
  if (kmh == null) return '–';
  return units === 'metric' ? `${Math.round(kmh)} km/h` : `${Math.round(kmh / 1.609)} mph`;
}
