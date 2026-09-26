import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import planeImg from '../assets/jota-plane.png';
import { meteoconUrl } from '../lib/meteocons';
import { fetchCurrentWeather, formatTemperature, formatWindSpeed, weatherCondition } from '../lib/weather';

/** Open-Meteo updates its "current" block every 15 minutes. */
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/**
 * The Dashboard title's mascot slot: the Jota plane by default, replaced by
 * an animated Meteocons weather icon (with a details tooltip on hover/focus)
 * once a location is set in Settings and Open-Meteo has answered. Any
 * failure (no location, offline, API error) quietly falls back to the plane.
 *
 * Same data and tooltip as `WeatherWidget` (the hand-drawn-icon variant,
 * kept for reuse elsewhere); only the icon differs.
 */
export default function AnimatedWeatherWidget() {
  const { t, i18n } = useTranslation();
  const locationQuery = useQuery({
    queryKey: ['weatherLocationPreference'],
    queryFn: api.getWeatherLocationPreference,
  });
  const location = locationQuery.data?.location ?? null;
  const unitQuery = useQuery({
    queryKey: ['temperatureUnitPreference'],
    queryFn: api.getTemperatureUnitPreference,
  });
  const unit = unitQuery.data?.temperatureUnit ?? 'celsius';
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
    // Only explain the plane once we know why it's there. While either query
    // is still loading it's just the mascot, with no tooltip.
    const hint =
      locationQuery.isSuccess && !location
        ? t('weather.setLocationHint')
        : location && weatherQuery.isError
          ? t('weather.unavailable', { name: location.name })
          : null;
    const plane = <img className="dashboard-title-plane" src={planeImg} alt="" />;
    if (!hint) return plane;
    return (
      <div className="weather-widget weather-widget-plane" tabIndex={0} aria-label={hint}>
        {plane}
        <div className="weather-tooltip weather-tooltip-hint" role="tooltip">
          {hint}
        </div>
      </div>
    );
  }

  const condition = weatherCondition(weather.weatherCode);
  const conditionLabel = t(`weather.conditions.${condition}`);
  const deg = (celsius: number) => formatTemperature(celsius, unit);
  const degWithUnit = (celsius: number) => formatTemperature(celsius, unit, true);
  const updated = new Date(weather.fetchedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="weather-widget" tabIndex={0} aria-label={`${conditionLabel}, ${degWithUnit(weather.temperature)} — ${location.name}`}>
      <img className="weather-icon weather-icon-animated weather-icon-light" src={meteoconUrl(weather.weatherCode, weather.isDay, 'light')} alt="" />
      <img className="weather-icon weather-icon-animated weather-icon-dark" src={meteoconUrl(weather.weatherCode, weather.isDay, 'dark')} alt="" />
      <span className="weather-temp">{deg(weather.temperature)}</span>
      <div className="weather-tooltip" role="tooltip">
        <div className="weather-tooltip-location">{location.name}</div>
        <div className="weather-tooltip-main">
          <span className="weather-tooltip-temp">{degWithUnit(weather.temperature)}</span>
          <span>{conditionLabel}</span>
        </div>
        <dl className="weather-tooltip-grid">
          <dt>{t('weather.feelsLike')}</dt>
          <dd>{degWithUnit(weather.apparentTemperature)}</dd>
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
          <dd>{formatWindSpeed(weather.windSpeed, unit)}</dd>
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
