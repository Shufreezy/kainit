(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Thermal = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WATTS_COOLING_PER_HP = 2600; // nominal cooling capacity per horsepower
  const DERATING = 0.85;             // real-world vs nominal
  const INPUT_KW_PER_HP = 0.9;       // electrical draw per HP
  const MASS_WH_PER_K_SQM = { concrete: 25, light: 12 }; // effective thermal mass per sqm floor
  const COND_W_PER_K_SQM = 1.5;      // conduction per sqm floor per K indoor/outdoor difference
  const SOLAR_W_PER_SQM = { shaded: 5, morning: 10, afternoon: 20 };
  const TOP_FLOOR_EXTRA_W_PER_SQM = 10;

  function roomParams(room) {
    return {
      mass: room.areaSqm * MASS_WH_PER_K_SQM[room.construction],
      cooling: room.hp * WATTS_COOLING_PER_HP * DERATING,
      cond: room.areaSqm * COND_W_PER_K_SQM,
      solarBase: room.areaSqm * (SOLAR_W_PER_SQM[room.sunExposure] + (room.topFloor ? TOP_FLOOR_EXTRA_W_PER_SQM : 0)),
    };
  }

  // grid: [{time (ms), outdoorTemp, cloudCover (0-100)}] sorted ascending, ideally uniform 15-min steps.
  // acStartMs: AC is on for grid points with time >= acStartMs.
  // holdTemp: optional thermostat — when the AC is on, temperature never drops below this
  // (models the unit cycling off once the desired temp is reached).
  // Returns [{time, temp}] — temp at each grid point.
  function simulate(room, grid, initialTemp, acStartMs, holdTemp) {
    const p = roomParams(room);
    const series = [{ time: grid[0].time, temp: initialTemp }];
    for (let i = 1; i < grid.length; i++) {
      const prev = series[i - 1];
      const dtHours = (grid[i].time - grid[i - 1].time) / 3600000;
      const sunFactor = 1 - grid[i - 1].cloudCover / 100;
      const heatGain = p.cond * (grid[i - 1].outdoorTemp - prev.temp) + p.solarBase * sunFactor;
      const cooling = grid[i - 1].time >= acStartMs ? p.cooling : 0;
      let next = prev.temp + ((heatGain - cooling) / p.mass) * dtHours;
      if (cooling > 0 && holdTemp != null && next < holdTemp) next = holdTemp;
      series.push({ time: grid[i].time, temp: next });
    }
    return series;
  }

  // Linear interpolation of the simulated series at time t (clamped to series bounds).
  function tempAt(series, t) {
    if (t <= series[0].time) return series[0].temp;
    if (t >= series[series.length - 1].time) return series[series.length - 1].temp;
    for (let i = 1; i < series.length; i++) {
      if (series[i].time >= t) {
        const a = series[i - 1], b = series[i];
        return a.temp + ((b.temp - a.temp) * (t - a.time)) / (b.time - a.time);
      }
    }
    return series[series.length - 1].temp;
  }

  function estimateKwh(hp, runtimeHours) {
    return hp * INPUT_KW_PER_HP * runtimeHours;
  }

  // hourly: {times: ms[], temps: [], cloud: []} -> uniform 15-min grid, linear interpolation.
  function buildQuarterHourGrid(hourly) {
    const grid = [];
    const STEP = 15 * 60000;
    for (let t = hourly.times[0]; t <= hourly.times[hourly.times.length - 1]; t += STEP) {
      grid.push({
        time: t,
        outdoorTemp: interp(hourly.times, hourly.temps, t),
        cloudCover: interp(hourly.times, hourly.cloud, t),
      });
    }
    return grid;
  }

  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] >= x) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
    }
    return ys[ys.length - 1];
  }

  return { roomParams, simulate, tempAt, estimateKwh, buildQuarterHourGrid, WATTS_COOLING_PER_HP, DERATING, INPUT_KW_PER_HP };
});
