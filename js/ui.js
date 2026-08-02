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

  // datetime-local wants local ISO without seconds
  function localISO(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function defaultTargetTime() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return localISO(d);
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
    if (!(rate >= 1 && rate <= 50)) throw new Error('Rate must be between 1 and 50 ₱/kWh.');
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
    const indoorSeries = Thermal.simulate(state.room, state.grid, state.initialTemp, startMs, state.targetTemp);
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
          plugins: {
            acBand: { startMs, endMs: state.targetTimeMs },
            tooltip: {
              callbacks: {
                title: (items) => (items.length ? fmtTime(items[0].parsed.x) : ''),
                label: (item) => item.dataset.label + ': ' + item.parsed.y.toFixed(1) + '°C',
              },
            },
          },
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
    $('resultCard').classList.add('hidden');
    try {
      if (!state.city) throw new Error('Search and select a city first.');
      const inputs = readInputs();
      const forecast = await Weather.fetchForecast(state.city.latitude, state.city.longitude);
      const full = Thermal.buildQuarterHourGrid(forecast);
      const grid = full.filter((p) => p.time >= Date.now() - 15 * 60000);
      if (grid.length < 4) throw new Error('Not enough forecast data.');
      const nowMs = grid[0].time;
      if (inputs.targetTimeMs > Date.now() + 24 * 3600000) throw new Error('Target time is more than 24 hours ahead.');
      if (inputs.targetTimeMs > grid[grid.length - 1].time) throw new Error('Target time is beyond the forecast horizon (end of tomorrow).');

      Object.assign(state, inputs, { grid, nowMs, initialTemp: Weather.initialIndoorEstimate(forecast, Date.now()) });

      // current humidity: first forecast hour at/after now (display only in v1)
      const hi = forecast.times.findIndex((t) => t >= Date.now());
      state.humidity = forecast.humidity[hi === -1 ? forecast.humidity.length - 1 : hi];

      const res = Optimizer.optimize(state.room, grid, state.initialTemp, state.targetTemp, state.targetTimeMs, nowMs, state.rate);

      if (!res.reachable) {
        $('resultText').innerHTML =
          state.targetTemp + '°C isn\'t reachable by ' + fmtTime(state.targetTimeMs) + ' with this unit; ' +
          'earliest achievable is <b>' + res.achievableTemp.toFixed(1) + '°C</b> — turn it on now, ' +
          'or try a higher target temp or a later time.';
      } else {
        $('resultText').innerHTML =
          'Turn on the AC at <b>' + fmtTime(res.startMs) + '</b> to reach ' + state.targetTemp + '°C by ' +
          fmtTime(state.targetTimeMs) + '. Est. cost <b>' + peso(res.cost) + '</b> (' + res.kwh.toFixed(2) +
          ' kWh) — turning it on now would cost ' + peso(res.baselineCost) + '.';
      }
      $('resultText').innerHTML += ' <span class="text-sm opacity-70">(current humidity ' + state.humidity + '%)</span>';

      const slider = $('startSlider');
      slider.min = nowMs;
      slider.max = state.targetTimeMs;
      slider.value = res.reachable ? res.startMs : nowMs;
      $('resultCard').classList.remove('hidden');
      renderChart(Number(slider.value));
      saveSettings();
    } catch (err) {
      if (err instanceof TypeError || err instanceof SyntaxError || /request failed/i.test(err.message)) {
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

  const targetTimeInput = $('targetTime');
  targetTimeInput.value = defaultTargetTime();
  // forecast window is capped at 24 hours ahead
  const maxD = new Date(Date.now() + 24 * 3600000);
  targetTimeInput.min = localISO(new Date());
  targetTimeInput.max = localISO(maxD);
  // manual typing bypasses the calendar picker's greyed-out dates — surface it immediately
  targetTimeInput.addEventListener('change', () => targetTimeInput.reportValidity());
  loadSettings();
  $('citySearchBtn').onclick = searchCity;
  $('cityQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCity(); });
  $('optimizeBtn').onclick = runOptimizer;
  $('startSlider').addEventListener('input', () => renderChart(Number($('startSlider').value)));
})();
