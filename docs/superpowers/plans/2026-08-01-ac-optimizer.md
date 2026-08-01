# Kainit — AC Temperature Optimizer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static single-page web app that recommends the best time to turn on an air conditioner (today/tomorrow) based on the Open-Meteo forecast, room size, AC horsepower, and desired temperature — minimizing electricity cost.

**Architecture:** Static site, no build step. Pure-logic modules (`js/thermal.js`, `js/optimizer.js`) are framework-free with a browser/node dual-export shim and are unit-tested with Node's built-in test runner. `js/weather.js` wraps the Open-Meteo API. `js/ui.js` wires the DOM and Chart.js. Styling via Tailwind Play CDN + daisyUI CDN.

**Tech Stack:** Vanilla JS, Chart.js (CDN), Tailwind Play CDN, daisyUI CDN, Open-Meteo API (no key), Node 24 (`node --test`) for tests, Cloudflare Pages for hosting.

**Spec:** `docs/superpowers/specs/2026-08-01-ac-optimizer-design.md`

**Verified API facts (checked 2026-08-01):**
- Geocoding: `https://geocoding-api.open-meteo.com/v1/search?name={q}&count=8&language=en&format=json&country_code=PH` → `{results: [{name, admin1, latitude, longitude, ...}]}`
- Forecast: `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,relative_humidity_2m,cloud_cover&past_days=1&forecast_days=2&timezone=auto` → `{hourly: {time: ["2026-08-01T00:00", ...], temperature_2m: [...], relative_humidity_2m: [...], cloud_cover: [...]}, utc_offset_seconds: 28800}`
- Times come back as local ISO strings **without** offset; parse with `new Date(t + offsetString)` using `utc_offset_seconds`, or accept that the user is in the same timezone as the location (true for this PH-focused personal tool). The code below appends the offset explicitly.

---

### Task 1: Project skeleton

**Files:**
- Create: `index.html`
- Create: `js/.gitkeep`

- [ ] **Step 1: Create directory structure and a minimal `index.html` shell**

```bash
mkdir -p js tests
```

`index.html`:

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kainit — AC Temperature Optimizer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
</head>
<body class="min-h-screen bg-base-200">
  <main class="max-w-3xl mx-auto p-4">
    <h1 class="text-2xl font-bold">Kainit</h1>
    <p class="text-sm opacity-70">AC Temperature Optimizer — estimates only, actual results vary with room conditions.</p>
    <!-- UI built out in Task 6 -->
  </main>
  <script src="js/thermal.js"></script>
  <script src="js/optimizer.js"></script>
  <script src="js/weather.js"></script>
  <script src="js/ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the shell loads**

Run: `python3 -m http.server 8000` (background), open `http://localhost:8000`, expect the heading to render with daisyUI styling and no console errors (404s for the not-yet-created `js/*.js` files are expected at this stage — they are created in Tasks 2–6).

- [ ] **Step 3: Commit**

```bash
git add index.html js tests
git commit -m "chore: project skeleton"
```

---

### Task 2: `thermal.js` — core simulation (TDD)

**Files:**
- Create: `js/thermal.js`
- Test: `tests/thermal.test.js`

The model (from spec): lumped single-zone, 15-minute timesteps on an interpolated grid. `heatGain = cond × (outdoor − indoor) + solarBase × (1 − cloudCover/100)`; `newTemp = temp + (heatGain − coolingIfOn) / mass × dtHours`.

- [ ] **Step 1: Write the failing tests**

`tests/thermal.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/thermal.test.js`
Expected: FAIL — `Cannot find module '../js/thermal.js'`

- [ ] **Step 3: Implement `js/thermal.js`**

```js
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
  // Returns [{time, temp}] — temp at each grid point.
  function simulate(room, grid, initialTemp, acStartMs) {
    const p = roomParams(room);
    const series = [{ time: grid[0].time, temp: initialTemp }];
    for (let i = 1; i < grid.length; i++) {
      const prev = series[i - 1];
      const dtHours = (grid[i].time - grid[i - 1].time) / 3600000;
      const sunFactor = 1 - grid[i - 1].cloudCover / 100;
      const heatGain = p.cond * (grid[i - 1].outdoorTemp - prev.temp) + p.solarBase * sunFactor;
      const cooling = grid[i - 1].time >= acStartMs ? p.cooling : 0;
      series.push({ time: grid[i].time, temp: prev.temp + ((heatGain - cooling) / p.mass) * dtHours });
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

  return { roomParams, simulate, tempAt, estimateKwh, WATTS_COOLING_PER_HP, DERATING, INPUT_KW_PER_HP };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/thermal.test.js`
Expected: 4 passing, 0 failing. (The first test encodes the spec's sanity target: ~4.9°C drop in the first hour for 1HP/15sqm/concrete/afternoon-sun at 35°C outdoor. If it lands outside [27.5, 29], tune only within the documented constants and re-check the other tests.)

- [ ] **Step 5: Commit**

```bash
git add js/thermal.js tests/thermal.test.js
git commit -m "feat: thermal simulation core"
```

---

### Task 3: `thermal.js` — forecast grid builder (TDD)

**Files:**
- Modify: `js/thermal.js`
- Test: `tests/thermal.test.js`

`buildQuarterHourGrid` converts the hourly forecast into the uniform 15-minute grid the simulator and slider need, via linear interpolation.

- [ ] **Step 1: Write the failing tests**

Append to `tests/thermal.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/thermal.test.js`
Expected: FAIL — `Thermal.buildQuarterHourGrid is not a function`

- [ ] **Step 3: Implement `buildQuarterHourGrid` in `js/thermal.js`**

Add inside the factory, before the `return`:

```js
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
```

And update the return:

```js
  return { roomParams, simulate, tempAt, estimateKwh, buildQuarterHourGrid, WATTS_COOLING_PER_HP, DERATING, INPUT_KW_PER_HP };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/thermal.test.js`
Expected: 5 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add js/thermal.js tests/thermal.test.js
git commit -m "feat: quarter-hour forecast grid builder"
```

---

### Task 4: `optimizer.js` — best-start-time search (TDD)

**Files:**
- Create: `js/optimizer.js`
- Test: `tests/optimizer.test.js`

Searches grid points from `nowMs` to `targetTimeMs` for the **latest** AC start that still reaches `targetTemp` by `targetTimeMs`. Reports cost vs. the naive "turn it on now" baseline; handles the unreachable case per spec.

- [ ] **Step 1: Write the failing tests**

`tests/optimizer.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/optimizer.test.js`
Expected: FAIL — `Cannot find module '../js/optimizer.js'`

- [ ] **Step 3: Implement `js/optimizer.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: 9 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add js/optimizer.js tests/optimizer.test.js
git commit -m "feat: best-start-time optimizer"
```

---

### Task 5: `weather.js` — Open-Meteo client

**Files:**
- Create: `js/weather.js`

Thin fetch wrapper — no unit tests (network boundary); verified with a live smoke test below. Uses the exact endpoints verified during planning (see header).

- [ ] **Step 1: Implement `js/weather.js`**

```js
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
    const offsetMs = data.utc_offset_seconds * 1000;
    const times = data.hourly.time.map((t) => new Date(t + 'Z').getTime() + offsetMs);
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
```

- [ ] **Step 2: Live smoke test**

Run:

```bash
node -e "
const W = require('./js/weather.js');
(async () => {
  const cities = await W.searchCities('Quezon City');
  console.log('cities:', cities.length, cities[0]);
  const fc = await W.fetchForecast(cities[0].latitude, cities[0].longitude);
  console.log('hours:', fc.times.length, 'first temp:', fc.temps[0]);
  console.log('indoor est:', W.initialIndoorEstimate(fc, Date.now()).toFixed(1));
})();
"
```

Expected: a non-empty city list whose first result is Quezon City (lat ~14.65, lon ~121.05), 72 hourly entries (24 past + 48 forecast), a plausible temperature, and a plausible indoor estimate. Times must parse as Asia/Manila wall-clock hours regardless of machine timezone (the offset arithmetic above guarantees this).

- [ ] **Step 3: Commit**

```bash
git add js/weather.js
git commit -m "feat: Open-Meteo client"
```

---

### Task 6: UI — markup and wiring

**Files:**
- Modify: `index.html`
- Create: `js/ui.js`

No unit tests (thin DOM layer by design) — verified manually in the browser with the checklist below.

- [ ] **Step 1: Replace the `<main>` content of `index.html` with the full UI**

Keep the `<head>` and `<script>` tags from Task 1 unchanged; replace `<main>...</main>` with:

```html
  <main class="max-w-3xl mx-auto p-4 space-y-4">
    <div>
      <h1 class="text-2xl font-bold">Kainit</h1>
      <p class="text-sm opacity-70">AC Temperature Optimizer — estimates only, actual results vary with room conditions.</p>
    </div>

    <div class="card bg-base-100 shadow">
      <div class="card-body gap-3">
        <div class="flex gap-2">
          <input id="cityQuery" type="text" placeholder="Search city (e.g. Quezon City)" class="input input-bordered w-full" />
          <button id="citySearchBtn" class="btn btn-primary">Search</button>
        </div>
        <div id="cityResults" class="flex flex-wrap gap-2"></div>
        <p id="cityLabel" class="text-sm font-medium"></p>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label class="form-control">
            <span class="label-text">Room size</span>
            <div class="join">
              <input id="area" type="number" min="1" max="500" value="15" class="input input-bordered join-item w-full" />
              <select id="areaUnit" class="select select-bordered join-item">
                <option value="sqm">sqm</option>
                <option value="sqft">sqft</option>
              </select>
            </div>
          </label>
          <label class="form-control">
            <span class="label-text">AC horsepower</span>
            <input id="hp" type="number" min="0.5" max="5" step="0.5" value="1" class="input input-bordered" />
          </label>
          <label class="form-control">
            <span class="label-text">Desired temp (°C)</span>
            <input id="targetTemp" type="number" min="16" max="30" value="26" class="input input-bordered" />
          </label>
          <label class="form-control">
            <span class="label-text">Rate (₱/kWh)</span>
            <input id="rate" type="number" min="1" max="50" step="0.1" value="12" class="input input-bordered" />
          </label>
          <label class="form-control">
            <span class="label-text">Sun exposure</span>
            <select id="sunExposure" class="select select-bordered">
              <option value="shaded">Shaded</option>
              <option value="morning">Morning sun</option>
              <option value="afternoon" selected>Afternoon sun</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text">Construction</span>
            <select id="construction" class="select select-bordered">
              <option value="concrete" selected>Concrete</option>
              <option value="light">Light materials</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text">I want it cool by</span>
            <input id="targetTime" type="datetime-local" class="input input-bordered" />
          </label>
          <label class="flex items-end gap-2 pb-2">
            <input id="topFloor" type="checkbox" class="checkbox" />
            <span class="label-text">Top floor (under roof)</span>
          </label>
        </div>

        <button id="optimizeBtn" class="btn btn-primary">Find best time</button>
      </div>
    </div>

    <div id="error" class="alert alert-error hidden"><span id="errorText"></span></div>

    <div id="resultCard" class="card bg-base-100 shadow hidden">
      <div class="card-body">
        <p id="resultText" class="text-lg"></p>
        <input id="startSlider" type="range" class="range range-primary" step="900000" />
        <p id="sliderInfo" class="text-sm opacity-80"></p>
        <div class="h-72"><canvas id="chart"></canvas></div>
      </div>
    </div>
  </main>
```

- [ ] **Step 2: Implement `js/ui.js`**

```js
/* global Thermal, Optimizer, Weather, Chart */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'kainit-settings';
  const peso = (n) => '₱' + n.toFixed(2);
  const fmtTime = (ms) =>
    new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  let state = {
    city: null,        // {name, admin1, latitude, longitude}
    grid: null,        // quarter-hour grid from now
    room: null,
    initialTemp: null,
    targetTemp: null,
    targetTimeMs: null,
    rate: null,
    chart: null,
  };

  // ---------- settings persistence ----------

  function saveSettings() {
    const settings = {
      city: state.city,
      area: $('area').value, areaUnit: $('areaUnit').value, hp: $('hp').value,
      targetTemp: $('targetTemp').value, rate: $('rate').value,
      sunExposure: $('sunExposure').value, construction: $('construction').value,
      topFloor: $('topFloor').checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function loadSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
    if (!s) return;
    if (s.city) { state.city = s.city; $('cityLabel').textContent = '📍 ' + s.city.name + (s.city.admin1 ? ', ' + s.city.admin1 : ''); }
    for (const id of ['area', 'areaUnit', 'hp', 'targetTemp', 'rate', 'sunExposure', 'construction']) {
      if (s[id] != null) $(id).value = s[id];
    }
    if (s.topFloor != null) $('topFloor').checked = s.topFloor;
  }

  // ---------- helpers ----------

  function showError(msg) {
    $('errorText').textContent = msg;
    $('error').classList.remove('hidden');
  }

  function clearError() { $('error').classList.add('hidden'); }

  function defaultTargetTime() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    // datetime-local wants local ISO without seconds
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function readInputs() {
    const area = parseFloat($('area').value);
    const hp = parseFloat($('hp').value);
    const targetTemp = parseFloat($('targetTemp').value);
    const rate = parseFloat($('rate').value);
    const targetTimeMs = new Date($('targetTime').value).getTime();
    if (!(area > 0 && area <= 500)) throw new Error('Room size must be between 1 and 500.');
    if (!(hp >= 0.5 && hp <= 5)) throw new Error('AC horsepower must be between 0.5 and 5.');
    if (!(targetTemp >= 16 && targetTemp <= 30)) throw new Error('Desired temp must be between 16 and 30 °C.');
    if (!(rate > 0)) throw new Error('Rate must be positive.');
    if (!(targetTimeMs > Date.now())) throw new Error('Target time must be in the future.');
    return {
      room: {
        areaSqm: $('areaUnit').value === 'sqft' ? area * 0.092903 : area,
        hp,
        sunExposure: $('sunExposure').value,
        topFloor: $('topFloor').checked,
        construction: $('construction').value,
      },
      targetTemp, rate, targetTimeMs,
    };
  }

  // ---------- chart ----------

  const acBandPlugin = {
    id: 'acBand',
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts || opts.startMs == null || opts.endMs == null) return;
      const { ctx, chartArea, scales } = chart;
      const x1 = scales.x.getPixelForValue(opts.startMs);
      const x2 = scales.x.getPixelForValue(opts.endMs);
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
      ctx.restore();
    },
  };

  function renderChart(startMs) {
    const outdoor = state.grid.map((p) => ({ x: p.time, y: p.outdoorTemp }));
    const indoorSeries = Thermal.simulate(state.room, state.grid, state.initialTemp, startMs);
    const indoor = indoorSeries.map((p) => ({ x: p.time, y: p.temp }));
    const target = [
      { x: state.grid[0].time, y: state.targetTemp },
      { x: state.grid[state.grid.length - 1].time, y: state.targetTemp },
    ];

    if (!state.chart) {
      state.chart = new Chart($('chart'), {
        type: 'line',
        data: {
          datasets: [
            { label: 'Outdoor', data: outdoor, borderColor: '#ef4444', pointRadius: 0, tension: 0.3 },
            { label: 'Indoor (simulated)', data: indoor, borderColor: '#3b82f6', pointRadius: 0, tension: 0.3 },
            { label: 'Target', data: target, borderColor: '#22c55e', borderDash: [6, 6], pointRadius: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: {
              type: 'linear',
              ticks: { maxTicksLimit: 12, callback: (v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
            },
            y: { title: { display: true, text: '°C' } },
          },
          plugins: { acBand: { startMs, endMs: state.targetTimeMs } },
        },
        plugins: [acBandPlugin],
      });
    } else {
      state.chart.data.datasets[0].data = outdoor;
      state.chart.data.datasets[1].data = indoor;
      state.chart.data.datasets[2].data = target;
      state.chart.options.plugins.acBand = { startMs, endMs: state.targetTimeMs };
      state.chart.update();
    }

    const tempAtTarget = Thermal.tempAt(indoorSeries, state.targetTimeMs);
    const runtimeHours = (state.targetTimeMs - startMs) / 3600000;
    const kwh = Thermal.estimateKwh(state.room.hp, runtimeHours);
    $('sliderInfo').textContent =
      'AC on at ' + fmtTime(startMs) + ' → ' + tempAtTarget.toFixed(1) + '°C by ' +
      fmtTime(state.targetTimeMs) + ' · est. ' + peso(kwh * state.rate) + ' (' + kwh.toFixed(2) + ' kWh)';
  }

  // ---------- main flow ----------

  async function runOptimizer() {
    clearError();
    try {
      if (!state.city) throw new Error('Search and select a city first.');
      const inputs = readInputs();
      const forecast = await Weather.fetchForecast(state.city.latitude, state.city.longitude);
      const full = Thermal.buildQuarterHourGrid(forecast);
      const grid = full.filter((p) => p.time >= Date.now() - 15 * 60000);
      if (grid.length < 4) throw new Error('Not enough forecast data.');
      const nowMs = grid[0].time;
      if (inputs.targetTimeMs > grid[grid.length - 1].time) throw new Error('Target time is beyond the forecast horizon (end of tomorrow).');

      Object.assign(state, inputs, { grid, nowMs, initialTemp: Weather.initialIndoorEstimate(forecast, Date.now()) });

      const res = Optimizer.optimize(state.room, grid, state.initialTemp, state.targetTemp, state.targetTimeMs, nowMs, state.rate);

      if (!res.reachable) {
        $('resultText').innerHTML =
          state.targetTemp + '°C isn\'t reachable by ' + fmtTime(state.targetTimeMs) + ' with this unit; ' +
          'earliest achievable is <b>' + res.achievableTemp.toFixed(1) + '°C</b>. Try a lower target or more time.';
      } else {
        $('resultText').innerHTML =
          'Turn on the AC at <b>' + fmtTime(res.startMs) + '</b> to reach ' + state.targetTemp + '°C by ' +
          fmtTime(state.targetTimeMs) + '. Est. cost <b>' + peso(res.cost) + '</b> (' + res.kwh.toFixed(2) +
          ' kWh) — turning it on now would cost ' + peso(res.baselineCost) + '.';
      }

      const slider = $('startSlider');
      slider.min = nowMs;
      slider.max = state.targetTimeMs;
      slider.value = res.reachable ? res.startMs : nowMs;
      $('resultCard').classList.remove('hidden');
      renderChart(Number(slider.value));
      saveSettings();
    } catch (err) {
      if (err instanceof TypeError || /request failed/i.test(err.message)) {
        showError('Weather service is unavailable right now, please try again in a few minutes.');
      } else {
        showError(err.message);
      }
    }
  }

  async function searchCity() {
    clearError();
    $('cityResults').innerHTML = '';
    const q = $('cityQuery').value.trim();
    if (!q) return;
    try {
      const cities = await Weather.searchCities(q);
      if (cities.length === 0) { showError('No matching Philippine city found.'); return; }
      for (const c of cities) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline';
        btn.textContent = c.name + (c.admin1 ? ', ' + c.admin1 : '');
        btn.onclick = () => {
          state.city = c;
          $('cityLabel').textContent = '📍 ' + btn.textContent;
          $('cityResults').innerHTML = '';
          saveSettings();
        };
        $('cityResults').appendChild(btn);
      }
    } catch {
      showError('Weather service is unavailable right now, please try again in a few minutes.');
    }
  }

  // ---------- init ----------

  $('targetTime').value = defaultTargetTime();
  loadSettings();
  $('citySearchBtn').onclick = searchCity;
  $('cityQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCity(); });
  $('optimizeBtn').onclick = runOptimizer;
  $('startSlider').addEventListener('input', () => renderChart(Number($('startSlider').value)));
})();
```

- [ ] **Step 3: Manual verification in browser**

Run `python3 -m http.server 8000`, open `http://localhost:8000`, and check:

1. Search "Quezon City" → result chips appear → click one → label shows the city.
2. Click "Find best time" → recommendation card appears with a start time, cost, and "turning it on now would cost ₱X" comparison; chart shows outdoor (red), indoor (blue), target (green dashed), and a shaded AC-on band.
3. Drag the slider → indoor curve, shaded band, and the info line update instantly without network calls (verify in devtools Network tab).
4. Reload the page → form values and selected city are restored from localStorage.
5. Search "asdfgh" → "No matching Philippine city found."
6. Disconnect network (devtools offline) and click "Find best time" → "Weather service is unavailable right now, please try again in a few minutes."
7. Set desired temp 16 with 0.5 HP and a large room on a hot day → unreachable message with achievable temp.
8. Resize to mobile width → layout stacks cleanly.

- [ ] **Step 4: Commit**

```bash
git add index.html js/ui.js
git commit -m "feat: UI with interactive optimizer chart"
```

---

### Task 7: Deploy to Cloudflare Pages

**Files:** none (deployment only)

- [ ] **Step 1: Deploy**

Either:

- **CLI:** `npx wrangler pages deploy . --project-name kainit` (first run prompts for Cloudflare login and project creation; tests/docs being included in the upload is harmless for a personal project), or
- **Dashboard:** dash.cloudflare.com → Workers & Pages → Create → Pages → "Upload assets" → drag the project folder.

- [ ] **Step 2: Verify production**

Open the `*.pages.dev` URL and repeat Task 6 Step 3 checks 1–3 on the live site. Optionally attach a custom domain in the Pages project settings.

---

## Done-when

- `node --test tests/` — 9 passing, 0 failing
- All Task 6 manual checks pass locally
- Site live on Cloudflare Pages and verified
