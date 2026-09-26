import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import planeImg from '../assets/jota-plane.png';
import { fetchCurrentWeather, weatherCondition, weatherIconKind, type WeatherIconKind } from '../lib/weather';

/** Open-Meteo updates its "current" block every 15 minutes. */
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/**
 * The Dashboard title's mascot slot: the Jota plane by default, replaced by
 * a current-weather icon (with a details tooltip on hover/focus) once a
 * location is set in Settings and Open-Meteo has answered. Any failure —
 * no location, offline, API error — quietly falls back to the plane.
 */
export default function WeatherWidget() {
  const { t, i18n } = useTranslation();
  const locationQuery = useQuery({
    queryKey: ['weatherLocationPreference'],
    queryFn: api.getWeatherLocationPreference,
  });
  const location = locationQuery.data?.location ?? null;
  const weatherQuery = useQuery({
    queryKey: ['weather', location?.latitude, location?.longitude],
    queryFn: () => fetchCurrentWeather(location!),
    enabled: location !== null,
    staleTime: WEATHER_REFRESH_MS,
    refetchInterval: WEATHER_REFRESH_MS,
    retry: 1,
  });
  const weather = weatherQuery.data;

  if (!location || !weather) {
    return <img className="dashboard-title-plane" src={planeImg} alt="" />;
  }

  const condition = weatherCondition(weather.weatherCode);
  const conditionLabel = t(`weather.conditions.${condition}`);
  const deg = (n: number) => `${Math.round(n)}°`;
  const updated = new Date(weather.fetchedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="weather-widget" tabIndex={0} aria-label={`${conditionLabel}, ${deg(weather.temperature)}C — ${location.name}`}>
      <WeatherIcon kind={weatherIconKind(condition)} isDay={weather.isDay} />
      <span className="weather-temp">{deg(weather.temperature)}</span>
      <div className="weather-tooltip" role="tooltip">
        <div className="weather-tooltip-location">{location.name}</div>
        <div className="weather-tooltip-main">
          <span className="weather-tooltip-temp">{deg(weather.temperature)}C</span>
          <span>{conditionLabel}</span>
        </div>
        <dl className="weather-tooltip-grid">
          <dt>{t('weather.feelsLike')}</dt>
          <dd>{deg(weather.apparentTemperature)}C</dd>
          {weather.high !== null && weather.low !== null && (
            <>
              <dt>{t('weather.highLow')}</dt>
              <dd>
                {deg(weather.high)} / {deg(weather.low)}
              </dd>
            </>
          )}
          <dt>{t('weather.humidity')}</dt>
          <dd>{Math.round(weather.humidity)}%</dd>
          <dt>{t('weather.wind')}</dt>
          <dd>{Math.round(weather.windSpeed)} km/h</dd>
          {weather.precipitationProbability !== null && (
            <>
              <dt>{t('weather.precipitation')}</dt>
              <dd>{Math.round(weather.precipitationProbability)}%</dd>
            </>
          )}
        </dl>
        <div className="weather-tooltip-updated">{t('weather.updated', { time: updated })}</div>
      </div>
    </div>
  );
}

// --- Icons (64×64 viewBox; colors come from app.css's `.wx-*` classes so
// they adapt to the light/dark theme) ---

const CLOUD_PATH = 'M19 52a11 11 0 0 1-1.6-21.9A15 15 0 0 1 46.4 27 12.5 12.5 0 0 1 46.5 52z';

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const inner = r + 4;
    const outer = r + 9;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * inner}
        y1={cy + Math.sin(a) * inner}
        x2={cx + Math.cos(a) * outer}
        y2={cy + Math.sin(a) * outer}
      />
    );
  });
  return (
    <g className="wx-sun">
      <g className="wx-sun-rays">{rays}</g>
      <circle cx={cx} cy={cy} r={r} />
    </g>
  );
}

function Moon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  // A crescent: the disc with an offset disc masked out.
  const maskId = `wx-moon-mask-${cx}-${cy}-${r}`;
  return (
    <>
      <mask id={maskId}>
        <rect x="0" y="0" width="64" height="64" fill="white" />
        <circle cx={cx + r * 0.55} cy={cy - r * 0.35} r={r * 0.8} fill="black" />
      </mask>
      <circle className="wx-moon" cx={cx} cy={cy} r={r} mask={`url(#${maskId})`} />
    </>
  );
}

function Cloud({ dx = 0, dy = 0, scale = 1, dark = false }: { dx?: number; dy?: number; scale?: number; dark?: boolean }) {
  return (
    <path
      className={dark ? 'wx-cloud wx-cloud-dark' : 'wx-cloud'}
      d={CLOUD_PATH}
      transform={`translate(${dx} ${dy}) scale(${scale})`}
    />
  );
}

function WeatherIcon({ kind, isDay }: { kind: WeatherIconKind; isDay: boolean }) {
  let body: ReactNode;
  switch (kind) {
    case 'clear':
      body = isDay ? <Sun cx={32} cy={32} r={12} /> : <Moon cx={30} cy={32} r={16} />;
      break;
    case 'partlyCloudy':
      body = (
        <>
          {isDay ? <Sun cx={24} cy={22} r={9} /> : <Moon cx={24} cy={22} r={11} />}
          <Cloud dx={10} dy={12} scale={0.82} />
        </>
      );
      break;
    case 'cloudy':
      body = (
        <>
          <Cloud dx={14} dy={-2} scale={0.7} dark />
          <Cloud dx={0} dy={4} scale={0.9} />
        </>
      );
      break;
    case 'fog':
      body = (
        <>
          <Cloud dx={4} dy={-6} scale={0.9} dark />
          <g className="wx-fog">
            <line x1="12" y1="48" x2="52" y2="48" />
            <line x1="18" y1="55" x2="46" y2="55" />
          </g>
        </>
      );
      break;
    case 'drizzle':
    case 'rain':
      body = (
        <>
          <Cloud dx={2} dy={-10} scale={0.95} dark={kind === 'rain'} />
          <g className="wx-rain">
            {(kind === 'rain' ? [22, 32, 42] : [24, 38]).map((x) => (
              <line key={x} x1={x} y1="46" x2={x - 4} y2={kind === 'rain' ? 58 : 53} />
            ))}
          </g>
        </>
      );
      break;
    case 'snow':
      body = (
        <>
          <Cloud dx={2} dy={-10} scale={0.95} />
          <g className="wx-snow">
            {[22, 32, 42].map((x, i) => (
              <circle key={x} cx={x} cy={i === 1 ? 56 : 50} r="3" />
            ))}
          </g>
        </>
      );
      break;
    case 'thunder':
      body = (
        <>
          <Cloud dx={2} dy={-10} scale={0.95} dark />
          <path className="wx-bolt" d="M34 40l-9 12h7l-4 10 12-14h-7l4-8z" />
        </>
      );
      break;
  }
  return (
    <svg className="weather-icon" viewBox="0 0 64 64" aria-hidden="true">
      {body}
    </svg>
  );
}
