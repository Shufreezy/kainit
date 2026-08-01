const { test } = require('node:test');
const assert = require('node:assert/strict');
const Thermal = require('../js/thermal.js');

const HOUR = 3600000;
const T0 = new Date('2026-08-02T12:00:00+08:00').getTime();

// uniform 15-min grid with constant conditions
function makeGrid({ hours = 8, outdoorTemp = 35, cloudCover = 0 } = {}) {
  const grid = [];
  for (let i = 0; i <= hours * 4; i++) {
    grid.push({ time: T0 + i * 15 * 60000, outdoorTemp, cloudCover });
  }
  return grid;
}

const typicalRoom = { areaSqm: 15, hp: 1, sunExposure: 'afternoon', topFloor: false, construction: 'concrete' };

test('AC on from start: 1HP in 15sqm concrete room drops ~4-5.5C in first hour', () => {
  const grid = makeGrid();
  const series = Thermal.simulate(typicalRoom, grid, 33, T0);
  const after1h = Thermal.tempAt(series, T0 + HOUR);
  assert.ok(after1h >= 27.5 && after1h <= 29, `expected 27.5-29, got ${after1h}`);
});

test('AC off: room heats up toward outdoor temp', () => {
  const grid = makeGrid({ outdoorTemp: 35 });
  const series = Thermal.simulate(typicalRoom, grid, 30, Number.POSITIVE_INFINITY);
  const after4h = Thermal.tempAt(series, T0 + 4 * HOUR);
  assert.ok(after4h > 31 && after4h < 35, `expected between 31 and 35, got ${after4h}`);
});

test('cloud cover slows heating when AC is off', () => {
  const sunny = Thermal.simulate(typicalRoom, makeGrid({ cloudCover: 0 }), 30, Number.POSITIVE_INFINITY);
  const cloudy = Thermal.simulate(typicalRoom, makeGrid({ cloudCover: 100 }), 30, Number.POSITIVE_INFINITY);
  const tSunny = Thermal.tempAt(sunny, T0 + 4 * HOUR);
  const tCloudy = Thermal.tempAt(cloudy, T0 + 4 * HOUR);
  assert.ok(tSunny > tCloudy, `sunny ${tSunny} should exceed cloudy ${tCloudy}`);
});

test('light construction cools faster than concrete with same AC', () => {
  const light = { ...typicalRoom, construction: 'light' };
  const concreteSeries = Thermal.simulate(typicalRoom, makeGrid(), 33, T0);
  const lightSeries = Thermal.simulate(light, makeGrid(), 33, T0);
  const tConcrete = Thermal.tempAt(concreteSeries, T0 + HOUR);
  const tLight = Thermal.tempAt(lightSeries, T0 + HOUR);
  assert.ok(tLight < tConcrete, `light ${tLight} should be below concrete ${tConcrete}`);
});

test('buildQuarterHourGrid interpolates hourly forecast to 15-min steps', () => {
  const hourly = {
    times: [T0, T0 + HOUR, T0 + 2 * HOUR],
    temps: [30, 34, 32],
    cloud: [0, 50, 100],
  };
  const grid = Thermal.buildQuarterHourGrid(hourly);
  assert.equal(grid.length, 9); // 2 hours * 4 + 1
  assert.equal(grid[0].outdoorTemp, 30);
  assert.equal(grid[4].outdoorTemp, 34);
  assert.equal(grid[2].outdoorTemp, 32);   // midpoint interpolation
  assert.equal(grid[2].cloudCover, 25);
  assert.equal(grid[8].cloudCover, 100);
  assert.equal(grid[1].time, T0 + 15 * 60000);
});

test('holdTemp: AC does not cool below the hold temperature', () => {
  const grid = makeGrid();
  const series = Thermal.simulate(typicalRoom, grid, 33, T0, 26);
  // reaches 26 and stays there instead of plunging for the rest of the horizon
  assert.equal(Thermal.tempAt(series, T0 + 8 * HOUR), 26);
  // without holdTemp, behavior is unchanged (AC cools indefinitely)
  const unheld = Thermal.simulate(typicalRoom, grid, 33, T0);
  assert.ok(Thermal.tempAt(unheld, T0 + 8 * HOUR) < 26);
});
