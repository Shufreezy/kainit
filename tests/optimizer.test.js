const { test } = require('node:test');
const assert = require('node:assert/strict');
const Thermal = require('../js/thermal.js');
const Optimizer = require('../js/optimizer.js');

const HOUR = 3600000;
const T0 = new Date('2026-08-02T12:00:00+08:00').getTime();

function makeGrid({ hours = 8, outdoorTemp = 35, cloudCover = 0 } = {}) {
  const grid = [];
  for (let i = 0; i <= hours * 4; i++) {
    grid.push({ time: T0 + i * 15 * 60000, outdoorTemp, cloudCover });
  }
  return grid;
}

const room = { areaSqm: 15, hp: 1, sunExposure: 'afternoon', topFloor: false, construction: 'concrete' };

test('finds latest start that still hits target, later than now', () => {
  const grid = makeGrid();
  const res = Optimizer.optimize(room, grid, 33, 26, T0 + 3 * HOUR, T0, 12);
  assert.equal(res.reachable, true);
  assert.ok(res.startMs > T0, 'should not need to start immediately');
  // 15 minutes later must miss the target (proves it is the latest)
  const later = Thermal.simulate(room, grid, 33, res.startMs + 15 * 60000);
  assert.ok(Thermal.tempAt(later, T0 + 3 * HOUR) > 26, 'starting 15 min later should miss target');
  // and the recommended start actually hits it
  const onTime = Thermal.simulate(room, grid, 33, res.startMs);
  assert.ok(Thermal.tempAt(onTime, T0 + 3 * HOUR) <= 26);
});

test('unreachable target reports reachable=false and achievable temp', () => {
  const big = { areaSqm: 40, hp: 0.5, sunExposure: 'afternoon', topFloor: true, construction: 'light' };
  const grid = makeGrid({ outdoorTemp: 38 });
  const res = Optimizer.optimize(big, grid, 36, 20, T0 + 4 * HOUR, T0, 12);
  assert.equal(res.reachable, false);
  assert.ok(res.achievableTemp > 20);
});

test('mild day with room already below target: start at target time (no pre-cooling)', () => {
  const grid = makeGrid({ outdoorTemp: 24, cloudCover: 100 });
  const res = Optimizer.optimize(room, grid, 23, 26, T0 + 3 * HOUR, T0, 12);
  assert.equal(res.reachable, true);
  assert.equal(res.startMs, T0 + 3 * HOUR);
});

test('cost estimates: cheaper than baseline, consistent with formula', () => {
  const grid = makeGrid();
  const res = Optimizer.optimize(room, grid, 33, 26, T0 + 3 * HOUR, T0, 12);
  assert.ok(res.cost < res.baselineCost);
  const runtimeHours = (T0 + 3 * HOUR - res.startMs) / HOUR;
  assert.ok(Math.abs(res.kwh - Thermal.estimateKwh(1, runtimeHours)) < 1e-9);
  assert.ok(Math.abs(res.cost - res.kwh * 12) < 1e-9);
  assert.ok(Math.abs(res.baselineKwh - Thermal.estimateKwh(1, 3)) < 1e-9);
});
