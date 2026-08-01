(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Thermal = isNode ? require('./thermal.js') : root.Thermal;
  const api = factory(Thermal);
  if (isNode) module.exports = api;
  else root.Optimizer = api;
})(typeof self !== 'undefined' ? self : this, function (Thermal) {
  'use strict';

  const HOUR = 3600000;

  // Finds the latest AC start time on the grid that reaches targetTemp by targetTimeMs.
  // Returns {reachable, startMs, kwh, cost, baselineKwh, baselineCost} or {reachable:false, achievableTemp}.
  function optimize(room, grid, initialTemp, targetTemp, targetTimeMs, nowMs, ratePerKwh) {
    let best = null;
    for (const point of grid) {
      if (point.time < nowMs || point.time > targetTimeMs) continue;
      const series = Thermal.simulate(room, grid, initialTemp, point.time);
      if (Thermal.tempAt(series, targetTimeMs) <= targetTemp) best = point.time; // keep latest
    }

    if (best === null) {
      const series = Thermal.simulate(room, grid, initialTemp, nowMs);
      return { reachable: false, achievableTemp: Thermal.tempAt(series, targetTimeMs) };
    }

    const runtimeHours = (targetTimeMs - best) / HOUR;
    const baselineHours = (targetTimeMs - nowMs) / HOUR;
    const kwh = Thermal.estimateKwh(room.hp, runtimeHours);
    const baselineKwh = Thermal.estimateKwh(room.hp, baselineHours);
    return { reachable: true, startMs: best, kwh, cost: kwh * ratePerKwh, baselineKwh, baselineCost: baselineKwh * ratePerKwh };
  }

  return { optimize };
});
