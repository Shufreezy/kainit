# Kainit — AC Temperature Optimizer: Design Spec

Date: 2026-08-01

## Purpose

A single-page web app for personal use in the Philippines. Given a room's size, an AC unit's horsepower, a location, and a desired temperature, it recommends the best time to turn on the AC today/tomorrow — minimizing electricity cost while reaching the target comfort level, accounting for weather (heat, sun, rain/cloud cover).

**Explicit non-goal:** this is an *estimate engine*, not a source of truth. It helps people make a sensible decision; it is not a definitive solution to heating/cooling problems. A visible disclaimer in the UI states this.

## Key decisions (from brainstorming)

- **Output:** a simple one-sentence text recommendation + an interactive graph where the user adjusts the AC start time and sees the simulated temperature curve respond.
- **Cost model:** generic cost-comfort calculator. Manual ₱/kWh input with a sensible default (~₱12/kWh). No electric-company branding or tariff data.
- **Location:** city search only (Open-Meteo geocoding API). No browser geolocation.
- **Room model:** square footage + AC HP + three quick toggles: sun exposure (shaded / morning sun / afternoon sun), floor level (top floor under roof / mid or ground floor), construction (concrete / light materials).
- **Stack:** one self-contained `index.html`, vanilla JS, Chart.js via CDN, Open-Meteo API (free, no API key). Styling with Tailwind CSS (Play CDN) + daisyUI (CDN) for polished, modern components — no build step. (shadcn/ui was considered but rejected: it requires a React + build toolchain, which conflicts with the single-file approach.)
- **Thermal engine:** lumped single-zone thermal simulation (Approach A). Self-calibration (Approach C) is a possible future enhancement, out of scope for v1.
- **Deploy:** Cloudflare Pages (static). Drag-and-drop via dashboard, or `npx wrangler pages deploy . --project-name ac-optimizer`. No backend — browser calls Open-Meteo directly.

## Architecture

Single `index.html`, internally organized into four plain-JS modules (separate `<script>` blocks, no build step):

### `weather.js` — Open-Meteo client
- City search: Open-Meteo geocoding API (`geocoding-api.open-meteo.com`), filtered/ranked for Philippine results.
- Forecast: one call for hourly temperature, relative humidity, and cloud cover, covering now → end of tomorrow (up to 48h). Humidity is not used by the thermal model in v1; it is fetched for display (e.g. "feels like" context in the UI) and future use.

### `thermal.js` — simulation engine (pure, no DOM/fetch)
- Input: room parameters (area, HP, toggles), hourly forecast array, AC on/off schedule, initial indoor temp.
- Output: simulated indoor temperature per timestep.
- Model: lumped single-zone, 1-hour timesteps (interpolated for 15-min slider resolution).
  - Cooling capacity: 1 HP ≈ 2.6 kW cooling, scaled by a real-world derating factor.
  - Heat gain: conduction ∝ (outdoor − indoor temp) + solar gain scaled by cloud cover; toggles scale both terms.
  - Update per timestep: `newTemp = temp + (heatGain − coolingIfOn) / thermalMass`; thermal mass scales with room area.
  - Constants sanity-tuned so e.g. 1 HP in a 15 sqm room drops ~4–5 °C in the first hour.
- Initial indoor temp estimate: derived from recent forecast (e.g. trailing average of outdoor temp), since there is no sensor input.

### `optimizer.js` — search layer (pure)
- Searches AC start times in 15-minute steps for the **latest** start time that still reaches the target temp by the user's target time (minimum runtime = minimum cost).
- Reports: recommended start time, estimated kWh and ₱ cost, and the same figures for the naive baseline ("turn it on now") for comparison.

### `ui.js` — DOM + chart (thin, no logic)
- Input panel, recommendation card, Chart.js graph.
- Re-runs `thermal.js` locally on slider input (no network calls).
- Persists all settings to `localStorage`.

## UI layout (single screen, mobile-friendly)

1. **Input panel:** city search; room size (sqm, with sqft toggle); AC HP (0.5–5); desired temp; ₱/kWh (editable, default ~₱12); three toggles; "I want it cool by [time]" (defaults to next reasonable hour; may be any hour from now through end of tomorrow, including past midnight).
2. **Recommendation card:** one sentence, e.g. *"Turn on the AC at **2:15 PM** to reach 26°C by 3:00 PM. Est. cost ₱18 (1.5 kWh) — turning it on now would cost ₱31."* If the target is unreachable (e.g. undersized unit), the card says so plainly — *"26°C isn't reachable by 3:00 PM with this unit; earliest achievable is 27.5°C at 3:00 PM"* — and recommends the earliest start time.
3. **Interactive graph (Chart.js):** now → end of tomorrow. Three series: forecast outdoor temp, simulated indoor temp with chosen schedule, dashed target-temp line. Slider (or drag on chart) sets AC-on time; indoor curve re-simulates live. AC-on periods shown as a shaded background band.
4. **Disclaimer:** "Estimates only — actual results vary with room conditions."

## Error handling

- City not found → inline message under the search field.
- **Open-Meteo unavailable → plain message: "Weather service is unavailable right now, please try again in a few minutes."** No caching, no retry machinery.
- Input validation inline with sensible bounds (HP 0.5–5, temp 16–30 °C, etc.).

## Testing

- `thermal.js` and `optimizer.js` are pure functions → small test suite (`tests.html`, runnable in browser):
  - Known scenarios (hot sunny day vs. rainy afternoon) asserting cooldown times land in expected ranges.
  - Edge cases: target temp already reached, impossible target (e.g. 16 °C with undersized unit), AC start time at boundaries.
- UI verified by hand (logic is thin by design).

## Out of scope (v1)

- Self-calibration from a measured cooldown (future enhancement).
- Time-of-use electricity rates, solar/battery.
- Multi-room or multi-unit support.
- User accounts, server-side anything.
