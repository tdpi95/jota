// Dashboard weather widget — location search via Nominatim (OpenStreetMap)
// and current conditions via Open-Meteo. Both are free, keyless, and
// CORS-enabled, so they're called straight from the renderer (which, inside
// Electron, also picks up the OS proxy settings) rather than through the
// Express server. Nothing here touches the vault: the chosen location is an
// app-wide preference (`GET/PUT /api/preferences/weather-location`), and the
// weather itself is never persisted anywhere.

export interface WeatherLocation {
  /** Short display name, e.g. "Hanoi, Vietnam". */
  name: string;
  latitude: number;
  longitude: number;
}

export interface LocationSearchResult extends WeatherLocation {
  /** Nominatim's full `display_name`, shown in the Settings result list. */
  fullName: string;
}

export const TEMPERATURE_UNITS = ['celsius', 'fahrenheit'] as const;
export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

/** Open-Meteo is always queried in °C; this converts for display only, so
 * switching units needs no re-fetch. Rounded to a whole degree. */
export function formatTemperature(celsius: number, unit: TemperatureUnit, withUnit = false): string {
  const value = Math.round(unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius);
  return `${value}°${withUnit ? (unit === 'fahrenheit' ? 'F' : 'C') : ''}`;
}

/** Open-Meteo reports wind in km/h; the Fahrenheit setting also switches
 * wind to mph (the imperial pairing), converted for display only. */
export function formatWindSpeed(kmh: number, unit: TemperatureUnit): string {
  return unit === 'fahrenheit' ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
}

export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  isDay: boolean;
  high: number | null;
  low: number | null;
  precipitationProbability: number | null;
  /** When this reading was fetched (ms since epoch), for the tooltip. */
  fetchedAt: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: { country?: string };
}

/**
 * Nominatim's usage policy asks for at most one request per second and no
 * search-as-you-type — callers only invoke this on an explicit submit.
 */
export async function searchLocations(query: string, language: string): Promise<LocationSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '6',
    'accept-language': language,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error(`Nominatim search failed (${res.status})`);
  const results = (await res.json()) as NominatimResult[];
  return results.map((r) => {
    const primary = r.name || r.display_name.split(',')[0].trim();
    const country = r.address?.country;
    return {
      name: country && country !== primary ? `${primary}, ${country}` : primary,
      fullName: r.display_name,
      latitude: Number(r.lat),
      longitude: Number(r.lon),
    };
  });
}

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
    is_day: number;
  };
  daily?: {
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

export async function fetchCurrentWeather(location: WeatherLocation): Promise<CurrentWeather> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  const data = (await res.json()) as OpenMeteoResponse;
  return {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    weatherCode: data.current.weather_code,
    isDay: data.current.is_day === 1,
    high: data.daily?.temperature_2m_max?.[0] ?? null,
    low: data.daily?.temperature_2m_min?.[0] ?? null,
    precipitationProbability: data.daily?.precipitation_probability_max?.[0] ?? null,
    fetchedAt: Date.now(),
  };
}

/** i18n key suffix under `weather.conditions.*` for a WMO weather code. */
export type WeatherCondition =
  | 'clear'
  | 'mainlyClear'
  | 'partlyCloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezingDrizzle'
  | 'rain'
  | 'freezingRain'
  | 'snow'
  | 'snowGrains'
  | 'rainShowers'
  | 'snowShowers'
  | 'thunderstorm'
  | 'thunderstormHail'
  | 'unknown';

/** Which of the widget's icons to draw — coarser than `WeatherCondition`. */
export type WeatherIconKind = 'clear' | 'partlyCloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

// WMO weather interpretation codes, as documented by Open-Meteo.
export function weatherCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57) return 'freezingDrizzle';
  if (code >= 61 && code <= 65) return 'rain';
  if (code === 66 || code === 67) return 'freezingRain';
  if (code >= 71 && code <= 75) return 'snow';
  if (code === 77) return 'snowGrains';
  if (code >= 80 && code <= 82) return 'rainShowers';
  if (code === 85 || code === 86) return 'snowShowers';
  if (code === 95) return 'thunderstorm';
  if (code === 96 || code === 99) return 'thunderstormHail';
  return 'unknown';
}

export function weatherIconKind(condition: WeatherCondition): WeatherIconKind {
  switch (condition) {
    case 'clear':
    case 'mainlyClear':
      return 'clear';
    case 'partlyCloudy':
      return 'partlyCloudy';
    case 'fog':
      return 'fog';
    case 'drizzle':
    case 'freezingDrizzle':
      return 'drizzle';
    case 'rain':
    case 'freezingRain':
    case 'rainShowers':
      return 'rain';
    case 'snow':
    case 'snowGrains':
    case 'snowShowers':
      return 'snow';
    case 'thunderstorm':
    case 'thunderstormHail':
      return 'thunder';
    default:
      return 'cloudy';
  }
}
