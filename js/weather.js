(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Weather = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // City search, Philippine results only. Returns [{name, admin1, latitude, longitude}].
  async function searchCities(name) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) +
      '&count=8&language=en&format=json&country_code=PH';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Geocoding request failed: ' + res.status);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      name: r.name,
      admin1: r.admin1 || '',
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }

  // Hourly forecast: past 24h through end of tomorrow.
  // Returns {times: ms[], temps: [], humidity: [], cloud: []} — humidity is display-only in v1.
  async function fetchForecast(latitude, longitude) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude +
      '&hourly=temperature_2m,relative_humidity_2m,cloud_cover&past_days=1&forecast_days=2&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Forecast request failed: ' + res.status);
    const data = await res.json();
    // Open-Meteo returns local wall-clock strings (e.g. "2026-08-02T14:00" means 14:00 in
    // the location's timezone). As a UTC instant that is t-as-if-UTC MINUS the offset.
    const offsetMs = data.utc_offset_seconds * 1000;
    const times = data.hourly.time.map((t) => new Date(t + 'Z').getTime() - offsetMs);
    return {
      times,
      temps: data.hourly.temperature_2m,
      humidity: data.hourly.relative_humidity_2m,
      cloud: data.hourly.cloud_cover,
    };
  }

  // Estimated current indoor temp: mean outdoor temp over the past 6 hours
  // (fallback: nearest known hour). No sensor input exists.
  function initialIndoorEstimate(forecast, nowMs) {
    const past = [];
    for (let i = 0; i < forecast.times.length; i++) {
      if (forecast.times[i] <= nowMs && forecast.times[i] >= nowMs - 6 * 3600000) past.push(forecast.temps[i]);
    }
    if (past.length === 0) {
      let nearest = 0;
      for (let i = 1; i < forecast.times.length; i++) {
        if (Math.abs(forecast.times[i] - nowMs) < Math.abs(forecast.times[nearest] - nowMs)) nearest = i;
      }
      return forecast.temps[nearest];
    }
    return past.reduce((a, b) => a + b, 0) / past.length;
  }

  return { searchCities, fetchForecast, initialIndoorEstimate };
});
