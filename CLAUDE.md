# VetMetric — Project Intelligence for Claude Code

## What this project is
VetMetric is a veterinary market intelligence platform for practice acquisition and site selection in Texas. It is a **single-page app** deployed to Cloudflare Pages. The entire frontend is one HTML file (`index.html`, ~2,900 lines) that loads two data files.

There is no build step, no bundler, no framework. Edit `index.html` directly and push to deploy.

## File structure
```
vetmetric/
├── index.html       # Everything: HTML + CSS + JS (~2,900 lines)
├── pe-data.js       # PE-owned clinic coordinates statewide (~827 TX clinics)
│                    # Defines window.PE_COORDS, window.PE_NAMES
│                    # Loaded as <script src="pe-data.js"> — must be in same directory
├── tx-zips.json     # Texas ZIP boundary GeoJSON (ZCTA polygons, ~2MB)
│                    # Fetched at runtime via loadZipGeometry(), cached in _zipGeoCache
└── CLAUDE.md        # This file
```

## Deploy
Cloudflare Pages. Push to the connected GitHub repo — Pages auto-deploys on push. No build command needed (`index.html` is served directly).

## Architecture overview

### Map stack
- **Leaflet 1.9.4** for the map (CDN)
- **OpenStreetMap** tiles (CartoDB light in some places)
- **MarkerClusterGroup** for clinic pins
- Map is initialized at line ~689: `const map = L.map('map', {minZoom:4, boxZoom:false})`
- `boxZoom:false` is intentional — prevents shift+drag zoom conflict with shift-click ZIP multi-select

### Data sources
1. **PE clinics** — `PE_COORDS` array from `pe-data.js` (loaded synchronously on page load). Complete statewide dataset. `peLoaded` flag set true when ready, `onPEReady()` called.
2. **Independent clinics** — Overpass API (OpenStreetMap), viewport-limited, fetched on `moveend` with 900ms debounce
3. **Income data** — Census ACS 2022 5-year, variable `B19013_001E`, all TX ZIPs, fetched with `force-cache`
4. **Pet density** — Census ACS 2022 5-year housing variables, modeled dog ownership rate per ZIP
5. **Population growth** — Census ACS: 2024 vintage vs 2021 vintage (same 2020-ZCTA boundaries), variable `B01003_001E`, parallel fetch

### Key global state
```js
let clinics = [];          // All loaded clinic objects {name, lat, lon, pe, ...}
let markers = [];          // Leaflet markers, index-matched to clinics[]
let drawnArea = null;      // Active draw area {type:'rect'|'poly', bounds|points}
let selectedZips = new Map();  // zip → {feat} for ZIP selection
let zipLayerMap = new Map();   // zip → Leaflet layer (from choropleth onEachFeature)
let zipBorderLayers = new Map(); // zip → standalone black border geoJSON layer
let incomeData = {};       // zip → median income (number)
let dogData = {};          // zip → {households, rate, est}
let growthData = {};       // zip → decimal pct change (0.12 = +12%)
let oppBaseRows = [];      // Pre-computed per-ZIP scoring inputs for DFW region
let oppScored = [];        // Sorted scoring results after rescoreAndRender()
let fetchSeq = 0;          // Request token — prevents concurrent fetchClinics() corruption
let lastIndependents = []; // Cache of last good Overpass result (Overpass fallback)
```

### Clinic fetch flow (`fetchClinics`)
- Increments `fetchSeq` — each fetch checks `myReq !== fetchSeq` after every `await` and bails if superseded
- Builds into local `local[]` array, only commits to `clinics[]` + redraws at the very end
- Source 1: PE clinics from `PE_COORDS` (gated on `peLoaded`)
- Source 2: Overpass with mirror fallback (kumi.systems) and 400ms backoff between mirrors
- On Overpass failure: falls back to `lastIndependents` for the current view rather than going PE-only
- `loadedBounds` only set when Overpass succeeded — forces retry on next move if degraded

### Choropleth layers
- **Income, pets, growth** are mutually exclusive fills — turning one on turns others off (single-fill rule prevents color muddying)
- All three call `loadZipGeometry()` which returns a singleton — `tx-zips.json` is only fetched and parsed once, cached in `_zipGeoCache`
- Each layer's `onEachFeature` registers the feature's Leaflet layer in `zipLayerMap` so `selectZip` can restyle it

### ZIP selection
- Clicking a ZIP polygon calls `selectZip(zip, feat, shiftHeld)`
- `_highlightZip(zip)`: restyles the choropleth layer if present (via `zipLayerMap`) AND draws a standalone black border from `zipBorderLayers` (works even with no choropleth active)
- `_unhighlightZip(zip)`: reverses both
- Bare map click calls `clearZipSelection()` unless `e.originalEvent._vfZipClick` is set
- ZIP clicks mark their event with `_vfZipClick = true` to prevent the bare-map handler from immediately clearing them
- `boxZoom:false` required — otherwise shift+drag triggers Leaflet's box zoom instead of multi-select
- `zoomend` handler re-asserts border stroke weight to prevent visual drift

### Draw area
- Rectangle or free-draw polygon
- `drawnArea` → `captureAreaClinics()` → `areaClinicKeys` Set
- `applyZipSelection()` and draw area cannot be active simultaneously — `captureAreaClinics()` clears any ZIP selection first
- KPI bar switches to draw-area mode when active, reverts on `clearArea()`

### Opportunity scoring (DFW region)
- `DFW_BOUNDS`: `[32.55, -97.55]` to `[33.45, -96.55]`
- `openOpportunity()`: auto-loads all three data layers, snapshots each into `oppIncomeSnap`, `oppDogSnap`, `oppGrowthSnap`, then tears down all choropleth fills so landing on a ZIP shows the plain base map
- `buildOppBaseInputs()`: iterates TX GeoJSON features, uses `rawBBox()` for cheap bbox (no Leaflet objects), DFW region reject before any polygon math
- `rescoreAndRender()`: min-max normalizes each factor 0–100, blends by weights, sorts descending
- Competition score: `peCount × peMult + indCount`, inverted (less competition = higher score)
- `oppSelect(zip)`: shows overlay on opportunity screen while map prepares behind it, then reveals finished map

## Sensors / gotchas

### Things that broke and were fixed — don't re-break them
- **`boxZoom:false` on map init**: must stay. Shift+click for ZIP multi-select requires this.
- **`leaflet-interactive:focus { outline: none }`** in CSS: must stay. Without it, Chrome draws a blue focus-ring rectangle around clicked ZIP polygons.
- **`_vfZipClick` flag on ZIP click events**: must stay. Without it, the bare-map `click` handler immediately clears the ZIP selection.
- **Standalone `zipBorderLayers`**: borders for selected ZIPs are drawn as separate non-interactive geoJSON layers (in the default overlay pane, NOT a custom pane). Custom pane caused coordinate desync on zoom — revert any attempt to use a custom pane or renderer for borders.
- **Map renderer `padding:1` must stay** (`L.svg({padding:1})` in the `L.map` init). Leaflet's default SVG renderer padding is 0.1, which sized the shared overlay SVG only ~38px larger than the viewport. Panning more than that clipped vector overlays (ZIP borders, choropleth fills, drawn areas) at the SVG edge, so a selected ZIP/area appeared to "follow" the screen / drift out of its boundaries during a drag until the next redraw. `padding:1` draws a full viewport beyond every edge. Do NOT drop it back to the default. Don't crank it far higher either — the SVG area grows as (1+2·padding)² and it renders that much more off-screen choropleth, hurting pan perf with the statewide layer on.
- **`fetchSeq` token in `fetchClinics`**: must stay. Rapid panning triggers concurrent fetches; without the token guard they corrupt `clinics[]` and `markers[]`.
- **`loadedBounds = null` on Overpass failure**: intentional. Forces retry on next move rather than serving stale PE-only results.
- **`force-cache` on Census fetches**: intentional. Census data doesn't change intraday; cache prevents re-downloading on layer retoggle.
- **Overpass mirror order (`OVERPASS_MIRRORS`) — private.coffee FIRST, overpass-api.de LAST**: do NOT reorder to put `overpass-api.de` first. As of 2026 it 406-bounces "programmatic-looking" browser requests via an anti-scraper filter, and a browser `fetch()` cannot set `User-Agent` (a forbidden header), so it often fails outright from this app. `overpass.private.coffee` (no rate limit, no filter, full CORS) and `overpass.kumi.systems` are the reliable primaries; `overpass.openstreetmap.fr` is an independent-operator fallback. Exclude `overpass.osm.ch` (Switzerland-only data — returns 200 but empty for TX).
- **`_overpass` is the single Overpass client — every caller must use it**: `fetchClinics` (map), `_refreshRegionIndependents` (Opportunity), and `_evalFetchContext` (Evaluate) all route through it. It has a per-attempt AbortController timeout (a hung mirror previously had NO timeout in `fetchClinics` and froze the map for minutes on the browser's default socket timeout), sequential mirror fallback, one 429/504 backoff retry, and a guard that returns null on a "200 but query-timed-out" body (no `.elements`). Do not reintroduce a raw inline `fetch` to Overpass — it loses the timeout and the rate-limit handling.
- **Mutual exclusion of choropleth layers**: income, pets, and growth are radio-button exclusive at the fill level. Both datasets can be loaded simultaneously (for scoring snapshots) but only one paints the map.
- **`buildOppBaseInputs` uses `rawBBox()` not `L.geoJSON(f).getBounds()`**: intentional perf fix. The Leaflet call was creating thousands of throwaway objects for non-DFW ZIPs.
- **`oppGeoSnap` holds a reference to the GeoJSON object**: setting `incomeGeoData = null` (in toggle-off) doesn't destroy the object, just drops the variable reference. The snap survives because it holds the same reference.
- **`pointInGeoJSON` handles Polygon + MultiPolygon + holes**: the free-draw `pointInPolygon` only handles simple rings. Use `pointInGeoJSON` for ZIP polygon containment tests.
- **Growth ZIP parsed from `r[r.length-1]`, NOT `r[1]`**: the ACS5 ZCTA geography column shape differs by vintage. ≥2021 returns `[pop, zip]` (ZCTA flat); ≤2019 returns `[pop, state, zip]` (ZCTA nested under state). Hardcoding `r[1]` made every nested-vintage row resolve to state FIPS `"48"`, so `popOld` was never stored and the entire growth layer showed "No data" statewide. Always read the zip from the last column. The requested variable is always col 0.
- **Growth OLD vintage must be ≥2021 (2020-ZCTA boundaries)**: `GROWTH_YEAR_OLD = 2021`, not 2019. ZCTA boundaries were redrawn after the 2020 Census — vintages ≤2020 use 2010 ZCTAs, ≥2021 use 2020 ZCTAs. Comparing across that line is invalid wherever a ZCTA was split/merged/created. Real example: 2019's single 75034 (108k pop) was split into 75033/75034/75036 by 2024, so a 2019↔2024 join showed Frisco at a fake −50%. 2021 is the earliest 2020-boundary vintage = longest valid window. Do NOT move OLD back to ≤2020 to "get a longer time span" — it silently corrupts every fast-growing exurb (the app's primary targets).

### Known limitations (intentional, not bugs)
- Independent clinics are viewport-limited (Overpass). PE clinics are complete statewide. `ensurePEClinicsForSelectedZips()` supplements PE counts on ZIP select.
- Opportunity scoring loads growth data as the third sequential async load. The three loads are sequential, not parallel, because mutual exclusion teardown is interleaved.
- Population growth uses ACS 2024 vs 2021 (same 2020-ZCTA boundaries, ~3yr window). ZIPs with <500 baseline population are excluded (noisy denominators). Values clamped to [-50%, +150%]. Window is 3yr rather than 5yr to stay on consistent ZCTA boundaries (see gotchas).
- Income data is ACS 2022 5-year. Pet density is modeled from ACS 2022 housing variables (not direct survey data).
- DFW scoring region is hardcoded. Adding a new region means changing `DFW_BOUNDS`, `DFW_MIN_LAT/LON/MAX_LAT/LON`.

## Section nav
Four nav items: Map (working), Opportunity (working), Properties (stub — shows toast), Reports (stub — shows toast).
`switchSection(s)` handles routing. The opportunity panel is an `position:absolute` overlay inside `.main` — it covers the map div without resizing it.

## Dev mode
Toggle in search bar. Adds clinic/property via map click, persists to `localStorage`. `getCustomClinics()`, `saveCustomClinics()`, `getDeleted()`, `getOverrides()` all read/write localStorage keys prefixed `vf_`.

## Census API key
Hardcoded in the fetch URLs: `key=3429f2401376a586a8f6ffc02bb5678ee32fbf44`. This is a public demo key. If Census calls start failing with 401, this key needs refreshing at api.census.gov.

## What's been built (current state as of session end)
- ✅ Full clinic map: PE (from sheet) + independents (Overpass), deduplicated, clustered
- ✅ PE/independent color pins (navy/red), dev mode add/edit/delete
- ✅ Draw area: rectangle + free-draw polygon, filters pins + scopes KPIs
- ✅ ZIP selection: click to select, shift+click multi-select, black border overlay
- ✅ Three choropleth layers: income, pet density, population growth (2021→2024)
- ✅ KPI bar: clinics in view, PE penetration, median income, dog households, top opportunity ZIP
- ✅ Opportunity scoring tab: 4-factor weighted score (income, demand, low competition, growth), live weight sliders, PE competition multiplier, 4 presets, ranked list with factor bars
- ✅ oppSelect: loads data behind overlay, reveals finished map with ZIP outlined
- ✅ VetMetric rebrand: logo (analytics bars + pulse), navy gradient tile
- ✅ Concurrent fetch protection (fetchSeq)
- ✅ Overpass fallback on rate-limit
- ✅ Shared geometry cache (tx-zips.json parsed once)
- ✅ Redundant Census fetch eliminated
- ✅ Growth data: ACS 2024 vs 2021 (same-boundary), parallel fetch, clamped, scored

## What's next (planned but not built)
- Population growth as scoring input is live but could be refined with forward projections (Esri/Claritas) in a future paid tier
- Properties tab (currently stub)
- Reports tab (currently stub)
- Opportunity split-view: ranked list + map side by side
- Clinic density as a choropleth layer (fifth factor)
- Opportunity score detail panel (per-ZIP breakdown with actual numbers)
- Weight persistence across sessions (currently resets to defaults)
