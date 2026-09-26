// Meteocons (https://github.com/basmilius/meteocons, MIT) animated "line"
// icons for WMO weather codes, as used by Open-Meteo. The icons are imported
// one by one rather than globbed, so Vite bundles only the ~40 this mapping
// uses out of the package's 475. They're rendered through `<img>`: each SVG animates itself
// (SMIL), and keeping each one in its own document stops their internal
// `id`s (masks, clip paths) from colliding with each other or the page.
//
// The line style is drawn for dark backgrounds: cloud outlines (#E6EFFC) and
// fog lines (#E2E8F0) are near-white and vanish on the light theme, while
// "not available" (#202939) vanishes on the dark one. So each icon is
// imported as raw text and recolored into a light- and a dark-theme data
// URL; the widget renders both and app.css shows the one matching
// `data-theme`, so a theme switch needs no re-render.

import clearDay from '@meteocons/svg/line/clear-day.svg?raw';
import clearNight from '@meteocons/svg/line/clear-night.svg?raw';
import extremeDayDrizzle from '@meteocons/svg/line/extreme-day-drizzle.svg?raw';
import extremeDayRain from '@meteocons/svg/line/extreme-day-rain.svg?raw';
import extremeDaySleet from '@meteocons/svg/line/extreme-day-sleet.svg?raw';
import extremeDaySnow from '@meteocons/svg/line/extreme-day-snow.svg?raw';
import extremeNightDrizzle from '@meteocons/svg/line/extreme-night-drizzle.svg?raw';
import extremeNightRain from '@meteocons/svg/line/extreme-night-rain.svg?raw';
import extremeNightSleet from '@meteocons/svg/line/extreme-night-sleet.svg?raw';
import extremeNightSnow from '@meteocons/svg/line/extreme-night-snow.svg?raw';
import fogDay from '@meteocons/svg/line/fog-day.svg?raw';
import fogNight from '@meteocons/svg/line/fog-night.svg?raw';
import mostlyClearDay from '@meteocons/svg/line/mostly-clear-day.svg?raw';
import mostlyClearDayRain from '@meteocons/svg/line/mostly-clear-day-rain.svg?raw';
import mostlyClearDaySnow from '@meteocons/svg/line/mostly-clear-day-snow.svg?raw';
import mostlyClearNight from '@meteocons/svg/line/mostly-clear-night.svg?raw';
import mostlyClearNightRain from '@meteocons/svg/line/mostly-clear-night-rain.svg?raw';
import mostlyClearNightSnow from '@meteocons/svg/line/mostly-clear-night-snow.svg?raw';
import notAvailable from '@meteocons/svg/line/not-available.svg?raw';
import overcastDay from '@meteocons/svg/line/overcast-day.svg?raw';
import overcastDayDrizzle from '@meteocons/svg/line/overcast-day-drizzle.svg?raw';
import overcastDayRain from '@meteocons/svg/line/overcast-day-rain.svg?raw';
import overcastDaySnow from '@meteocons/svg/line/overcast-day-snow.svg?raw';
import overcastNight from '@meteocons/svg/line/overcast-night.svg?raw';
import overcastNightDrizzle from '@meteocons/svg/line/overcast-night-drizzle.svg?raw';
import overcastNightRain from '@meteocons/svg/line/overcast-night-rain.svg?raw';
import overcastNightSnow from '@meteocons/svg/line/overcast-night-snow.svg?raw';
import partlyCloudyDay from '@meteocons/svg/line/partly-cloudy-day.svg?raw';
import partlyCloudyDayDrizzle from '@meteocons/svg/line/partly-cloudy-day-drizzle.svg?raw';
import partlyCloudyDayRain from '@meteocons/svg/line/partly-cloudy-day-rain.svg?raw';
import partlyCloudyDaySleet from '@meteocons/svg/line/partly-cloudy-day-sleet.svg?raw';
import partlyCloudyDaySnow from '@meteocons/svg/line/partly-cloudy-day-snow.svg?raw';
import partlyCloudyNight from '@meteocons/svg/line/partly-cloudy-night.svg?raw';
import partlyCloudyNightDrizzle from '@meteocons/svg/line/partly-cloudy-night-drizzle.svg?raw';
import partlyCloudyNightRain from '@meteocons/svg/line/partly-cloudy-night-rain.svg?raw';
import partlyCloudyNightSleet from '@meteocons/svg/line/partly-cloudy-night-sleet.svg?raw';
import partlyCloudyNightSnow from '@meteocons/svg/line/partly-cloudy-night-snow.svg?raw';
import thunderstormsDayHail from '@meteocons/svg/line/thunderstorms-day-hail.svg?raw';
import thunderstormsDayRain from '@meteocons/svg/line/thunderstorms-day-rain.svg?raw';
import thunderstormsExtremeDayHail from '@meteocons/svg/line/thunderstorms-extreme-day-hail.svg?raw';
import thunderstormsExtremeNightHail from '@meteocons/svg/line/thunderstorms-extreme-night-hail.svg?raw';
import thunderstormsNightHail from '@meteocons/svg/line/thunderstorms-night-hail.svg?raw';
import thunderstormsNightRain from '@meteocons/svg/line/thunderstorms-night-rain.svg?raw';

const ICONS: Record<string, string> = {
  'clear-day': clearDay,
  'clear-night': clearNight,
  'extreme-day-drizzle': extremeDayDrizzle,
  'extreme-day-rain': extremeDayRain,
  'extreme-day-sleet': extremeDaySleet,
  'extreme-day-snow': extremeDaySnow,
  'extreme-night-drizzle': extremeNightDrizzle,
  'extreme-night-rain': extremeNightRain,
  'extreme-night-sleet': extremeNightSleet,
  'extreme-night-snow': extremeNightSnow,
  'fog-day': fogDay,
  'fog-night': fogNight,
  'mostly-clear-day': mostlyClearDay,
  'mostly-clear-day-rain': mostlyClearDayRain,
  'mostly-clear-day-snow': mostlyClearDaySnow,
  'mostly-clear-night': mostlyClearNight,
  'mostly-clear-night-rain': mostlyClearNightRain,
  'mostly-clear-night-snow': mostlyClearNightSnow,
  'not-available': notAvailable,
  'overcast-day': overcastDay,
  'overcast-day-drizzle': overcastDayDrizzle,
  'overcast-day-rain': overcastDayRain,
  'overcast-day-snow': overcastDaySnow,
  'overcast-night': overcastNight,
  'overcast-night-drizzle': overcastNightDrizzle,
  'overcast-night-rain': overcastNightRain,
  'overcast-night-snow': overcastNightSnow,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-day-drizzle': partlyCloudyDayDrizzle,
  'partly-cloudy-day-rain': partlyCloudyDayRain,
  'partly-cloudy-day-sleet': partlyCloudyDaySleet,
  'partly-cloudy-day-snow': partlyCloudyDaySnow,
  'partly-cloudy-night': partlyCloudyNight,
  'partly-cloudy-night-drizzle': partlyCloudyNightDrizzle,
  'partly-cloudy-night-rain': partlyCloudyNightRain,
  'partly-cloudy-night-sleet': partlyCloudyNightSleet,
  'partly-cloudy-night-snow': partlyCloudyNightSnow,
  'thunderstorms-day-hail': thunderstormsDayHail,
  'thunderstorms-day-rain': thunderstormsDayRain,
  'thunderstorms-extreme-day-hail': thunderstormsExtremeDayHail,
  'thunderstorms-extreme-night-hail': thunderstormsExtremeNightHail,
  'thunderstorms-night-hail': thunderstormsNightHail,
  'thunderstorms-night-rain': thunderstormsNightRain,
};

export type MeteoconTheme = 'light' | 'dark';

const RECOLOR: Record<MeteoconTheme, [RegExp, string][]> = {
  light: [
    // Darken the "extreme" icons' back cloud first, so it stays distinct
    // from the front cloud recolored to its old shade just below.
    [/#64748B/gi, '#334155'],
    [/#E6EFFC/gi, '#64748B'],
    [/#E2E8F0/gi, '#64748B'],
  ],
  dark: [[/#202939/gi, '#E2E8F0']],
};

const urlCache = new Map<string, string>();

function toDataUrl(svg: string, theme: MeteoconTheme): string {
  const key = `${theme}:${svg}`;
  let url = urlCache.get(key);
  if (!url) {
    const recolored = RECOLOR[theme].reduce((acc, [from, to]) => acc.replace(from, to), svg);
    url = `data:image/svg+xml,${encodeURIComponent(recolored)}`;
    urlCache.set(key, url);
  }
  return url;
}

type Intensity = 'light' | 'moderate' | 'heavy';
type Precipitation = 'drizzle' | 'rain' | 'snow' | 'sleet';

// Steady precipitation gets cloudier skies as it intensifies; showers sit one
// step sunnier (they're the broken-cloud kind), topping out at the same
// "extreme" icon.
const STEADY_SKY: Record<Intensity, string> = { light: 'partly-cloudy', moderate: 'overcast', heavy: 'extreme' };
const SHOWER_SKY: Record<Intensity, string> = { light: 'mostly-clear', moderate: 'partly-cloudy', heavy: 'extreme' };

/** The Meteocons icon name for a WMO weather code, day or night variant. */
export function meteoconName(code: number, isDay: boolean): string {
  const dn = isDay ? 'day' : 'night';
  const steady = (intensity: Intensity, kind: Precipitation) => `${STEADY_SKY[intensity]}-${dn}-${kind}`;
  const shower = (intensity: Intensity, kind: Precipitation) => `${SHOWER_SKY[intensity]}-${dn}-${kind}`;
  switch (code) {
    case 0: return `clear-${dn}`;
    case 1: return `mostly-clear-${dn}`;
    case 2: return `partly-cloudy-${dn}`;
    case 3: return `overcast-${dn}`;
    case 45: case 48: return `fog-${dn}`;
    case 51: return steady('light', 'drizzle');
    case 53: return steady('moderate', 'drizzle');
    case 55: return steady('heavy', 'drizzle');
    case 56: return steady('light', 'sleet'); // freezing drizzle
    case 57: return steady('heavy', 'sleet');
    case 61: return steady('light', 'rain');
    case 63: return steady('moderate', 'rain');
    case 65: return steady('heavy', 'rain');
    case 66: return steady('light', 'sleet'); // freezing rain
    case 67: return steady('heavy', 'sleet');
    case 71: return steady('light', 'snow');
    case 73: return steady('moderate', 'snow');
    case 75: return steady('heavy', 'snow');
    case 77: return steady('moderate', 'snow'); // snow grains
    case 80: return shower('light', 'rain');
    case 81: return shower('moderate', 'rain');
    case 82: return shower('heavy', 'rain');
    case 85: return shower('light', 'snow');
    case 86: return shower('heavy', 'snow');
    case 95: return `thunderstorms-${dn}-rain`;
    case 96: return `thunderstorms-${dn}-hail`;
    case 99: return `thunderstorms-extreme-${dn}-hail`;
    default: return 'not-available';
  }
}

/** The theme-adjusted Meteocons icon (as a data URL) for a WMO weather code. */
export function meteoconUrl(code: number, isDay: boolean, theme: MeteoconTheme): string {
  return toDataUrl(ICONS[meteoconName(code, isDay)] ?? ICONS['not-available'], theme);
}
