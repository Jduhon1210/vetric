# Site Capture Model — design spec (2026-07-26)

Status: **DESIGN — not built.** Written before the infrastructure work so the model can be reviewed
on its merits first. Implementation is gated behind a revertible switch (§5) so the current engine
remains the default until this one is proven better on real markets.

---

## 0. Scope — METROPLEX RUNS ONLY (user, 2026-07-26)

This model replaces demand scoring **only inside Evaluate Metroplex**. Every other flow — ZIP
evaluation, drop-a-site, clinic evaluation, Refine-this-area — keeps the current gravity engine
untouched.

That is the right seam, and it narrows the work considerably:

- **The metro run is the only flow that asks the question this model answers.** "Screen everywhere
  and hand me the best areas" needs comparable, absolute demand across a whole region. A drop-site
  evaluation already has a 2-mile grid and the full parcel-grade engine; it doesn't need this.
- **Regression risk drops to near zero** on the flows used most. If the capture model is wrong, it is
  wrong in exactly one button.
- **The precompute only has to cover the metro bbox** — which was already the plan, but now it is a
  hard boundary rather than a coverage compromise.
- **Refine stays gravity**, so the metro→refine handoff still ends in the parcel-grade engine that is
  already field-validated. Capture finds the *area*; the existing engine finds the *parcel*.

Everything below is scoped accordingly.

## 1. What the user asked for

> "Sites now find underserved areas in established suburbs, where when you evaluate all 10–15 minute
> radius within DFW, you find an area that has high household capture and winnable visits. Future
> demand should be nice to have on a site, but should mainly be for land plays."

Two tracks, deliberately separated:

| | **Sites** | **Land plays** |
|---|---|---|
| Question | Where do I make money **now**? | Where do I buy dirt for **later**? |
| Geography | Established suburbs | Growth exurbs |
| Demand | Today's rooftops inside a real drive polygon | Announced/under-construction homes |
| Ranked by | **Winnable visits/yr** (absolute) | Future-play score (as today) |
| Future demand | Disclosed as upside, small scoring weight | The whole thesis |

## 2. What changes from the current engine

**Today** each candidate cell scores demand as crow-flies rooftop gravity — households within 4 km
under a squared distance decay — normalized 0–1, then multiplied by capture share and an access
multiplier. It is a *proxy* for reachability, and it blends announced homes into the site number
(`demandN = min(1,(dem+demF)/maxDem)`), which is what lets an exurb pasture corner outrank an
established suburb on the Sites list.

**Proposed** each candidate is scored on its actual road-network trade area:

```
reachable households (10-min drive polygon)      ← precomputed, road network
      → pet households (existing tract-grain pet model)
      → annual visits (OPP_VISITS_PER_DOGHH / _CATHH)
      → × capture share (existing Huff model, live)
      = WINNABLE VISITS / YEAR                    ← the ranking metric
      → × REV_PER_VISIT                           = modeled revenue
```

Three consequences, stated plainly:

1. **The ranking metric becomes absolute, not an index.** "Site 1 wins ~14,200 visits/yr" instead of
   "Site 1 scores 96." Easier to defend, and it is the AVMA Market Share Estimator method buyers
   recognize (research/vet-site-selection-report.md).
2. **Announced homes stop inflating site scores.** They move to a disclosed upside line (the card
   already has a "Future demand — pipeline" block) and remain the land-play driver.
3. **Picks shift toward density.** Established suburbs with many reachable rooftops will outrank
   growth corridors on the Sites list. That is the stated intent — but it is a real behavioural
   change and is exactly what §6 validation must confirm before this becomes the default.

**"Underserved" is the share term, and it already exists.** High household capture alone would just
find downtown. The winnable-visits metric multiplies reachable demand by capture share, and share is
already suppressed by nearby competitors (and hard-capped near PE clinics). So a dense-but-saturated
suburb scores low, and a dense suburb with weak incumbent coverage scores high. That product is the
definition of underserved: **many reachable households × few competitors for them.**

## 3. Future demand on sites — the weighting decision

Recommended: **under-construction units count toward site demand; "announced" units do not.**

NCTCOG pipeline records carry a status split (`uc` vs announced), so this is observed data rather
than an assumption. A framed subdivision is contractually arriving within a de novo's ramp period; a
press release is not. Announced volume stays exclusively a land-play signal, which preserves the
Celina/exurb thesis where it belongs.

If this proves fiddly in practice, the fallback is **strict** (sites count today's rooftops only) —
simpler and more conservative, with the land-play pin beside it carrying the growth story.

## 4. Data contract

The expensive half (road network) is precomputed and shipped static; the volatile half (competition,
zoning, retail, analyst overrides) stays live. This is what keeps Vetric a static page on Cloudflare
— no routing server in production.

`dfw-catchments.json`
```
{ v:1, built:"YYYY-MM-DD", grid:<spacing in miles>, engine:"osrm|ors",
  cells: { "<lat*1000>_<lon*1000>": { h10, h15, d10, c10, d15, c15, a10, a15 } } }
```
- `h*` reachable households, `d*`/`c*` dog/cat households, `a*` polygon area mi² (sanity + display)
- Grid spacing ~1.5 mi over the DFW bbox; candidates snap to the nearest grid cell
- Pet households precomputed with the SAME tract-grain model the app uses, so the two can't drift
- Regenerating is a local batch job; the app only ever reads the artifact (pattern: `vet-staff.js`)

**Why precompute rather than query live:** a metro run scores up to 1,296 candidate cells. Via Google
Routes that is 93,312 billable elements ≈ **$466 per evaluation** — which is why the current engine
uses crow-flies gravity at all. Precomputed, it is a lookup.

## 5. The revert switch (required)

`EVAL_MODEL` — `'gravity'` (current engine, **default**) | `'capture'` (this model).

- Persisted in `localStorage.vf_evalmodel`; Settings → Data & Logic toggle
- **Consulted only when `_metroRun` is true.** Every other evaluation path ignores it entirely and
  runs gravity, so the toggle cannot affect drop-site, ZIP, clinic or refine evaluations
- Read at the top of `_evalComputeAndRender`; the two demand paths diverge at exactly one place —
  how `g.dem` is derived — and rejoin for share/access/tiers, so the blast radius is one function
- `'capture'` degrades to `'gravity'` automatically when `dfw-catchments.json` is absent or the
  candidate is outside the precomputed grid (non-DFW), so nothing can hard-fail
- Site cards state which model produced the number, so a screenshot is never ambiguous
- No scoring constant is deleted. Reverting is flipping the toggle, not a code rollback.

## 6. Validation before it becomes default

1. **Engine accuracy** — compare OSRM/ORS polygons against the Google isochrones already cached in
   `localStorage.vf_iso_*` (free, already paid for). Expect OSRM to run slightly *larger*: OSM
   free-flow speeds, no traffic model. Record the bias; if systematic, correct the time budget.
2. **Side-by-side rankings** — run a full DFW metro evaluation under both models and diff the top-5.
   (Metro is the only flow affected, so this is the whole comparison surface.) The diff should show
   picks moving from growth corridors toward established suburbs with weak incumbent coverage; if it
   instead moves toward saturated density, the share term is under-weighted.
3. **The underserved test** — the new model must rank a dense-but-saturated suburb BELOW a dense
   suburb with weak incumbent coverage. If it doesn't, the share term isn't doing its job.
4. **Land plays must not move.** They are scored off future demand and are out of scope; any change
   to their ranking is a bug.

## 7. Infrastructure — options and the real constraint

Build machine: **8 GB RAM, no Docker.** Texas-wide OSRM preprocessing typically wants 8–12 GB and
would likely thrash, so a statewide extract is not viable as-is.

| Option | Cost | Notes |
|---|---|---|
| **OSRM, DFW-clipped extract** (recommended) | free | Clip the Texas PBF to the DFW bbox first (~200–400 MB), which fits comfortably. Needs `osrm-backend` + `osmium`/`osmconvert` via Homebrew (currently v3.2.14 — old, may need `brew update`). Unlimited queries once built. |
| **Valhalla** | free | Native `/isochrone` endpoint returns polygons directly rather than ray-sampling — a better fit for this job. Heavier install. |
| **OpenRouteService public API** | free tier | Zero install, native isochrones, but a daily request cap — a full DFW grid would take days of background running. Good fallback / cross-check. |
| Google Routes | $441+ for DFW | Violates the standing free-usage rule. Rejected. |

Recommendation: OSRM on a DFW-clipped extract, with ORS as the accuracy cross-check.

### 7b. BUILT — what actually happened (2026-07-27)

**ORS was rejected on licensing, not capability.** Their terms restrict the free tier to a "Single
End User", require a commercial plan for commercial use, and explicitly forbid redistributing hosted
API output. Baking it into a product sold to PE firms sits inside that prohibition. Self-hosting has
no such restriction — OSM data is ODbL, which wants attribution, not exclusivity.

**Pipeline as built:** Docker (Homebrew was too old to parse the formula — v3.2.14 from 2021) →
`ghcr.io/project-osrm/osrm-backend` → Texas extract from Geofabrik (679 MB) → clipped to the DFW
bbox with a locally-compiled `osmconvert` (184 MB, 26 s) → extract/partition/customize. Peak RAM in
`osrm-extract` was **3.3 GB against Docker's 3.8 GB** — statewide would have OOM'd, so the clip was
load-bearing, not an optimisation.

GOTCHAS worth keeping:
- **macOS ControlCenter (AirPlay Receiver) squats on port 5000** — the container silently sits in
  `Created` and never starts. Run on 5001.
- No osmium Docker image resolved; `osmconvert` is a single C file that compiles with the system
  clang in seconds. Use that.
- `tx-zips.json` carries a plain `zip` property, NOT the Census `ZCTA5CE20`/`ZCTA5CE10` names.
  Assuming the Census names produced a **silently empty ZIP mix on every cell** — the whole demand
  half was null and the build still "succeeded". Validate field names against real output.

**Output** `dfw-catchments.json` — 1.6 MB, 911 clinic catchments, 1,146 candidate cells, 36 rays,
budgets 8/10/12/15 min. Whole sweep ~2 minutes at ~18 locations/sec.

**Calibration finding that corrected an earlier assumption.** I had claimed a real 10-minute drive
polygon is roughly half the area of a 3.5-mile circle. Measured, it is **not**: OSRM 10-min polygons
run 39–55 sq mi vs the circle's 38, and *downtown Dallas is the largest* because free-flow OSM speeds
have no congestion model and downtown has the most freeway convergence. Google's Routes isochrones
are traffic-aware, which is why they came back smaller and why the app's drive-time button lowered
revenue. Resolution: compute **four budgets from the same ray sample at zero extra cost**, so
calibration is a runtime field choice rather than a rebuild. Headline stays 10-min free-flow — its
~3.6 mi equivalent radius is conservative against the 5.3-mi mean client travel distance in the
industry survey, and flat-weight counting suits a tight polygon.

**Competitor-overlap cap.** First pass capped each cell's competitor list at 20 and 615 of 1,146
cells were cutting a meaningful (>0.10) competitor — understating competition exactly in the dense
markets where it decides the ranking. Raised to 120 (effectively uncapped; observed max 117).

**Discrimination check — the model separates saturated from underserved as designed:**

| | ZIP-equivalent reach (10m) | competitive pressure |
|---|---|---|
| Richardson | 4.68 | 11.55 |
| Plano | 3.52 | 13.61 |
| Flower Mound | 1.52 | 12.11 (saturated — matches the app's independent read) |
| Prosper | 1.00 | 11.66 |
| Celina | 0.41 | 6.17 (correctly not a site — it is a land play) |
| SE Dallas cluster | 2.60 | **0.49** ← the underserved signal |

## 8. Build order

1. This spec reviewed and approved
2. Model switch + Settings toggle shipped with `'gravity'` default (revert path exists before the
   new model does)
3. OSRM stood up on a DFW-clipped extract; validate §6.1 against cached Google rings
4. `build-catchments.mjs` → `dfw-catchments.json`
5. Wire the `'capture'` path; run §6.2 side-by-sides
6. Only then consider changing the default

## 8b. KNOWN WEAKNESSES — all five to be fixed (user, 2026-07-27)

Ranked by how much they distort the answer. All five are agreed work; do them after the catchment
build lands and before the capture model becomes the metro default.

### W1 — No distance decay inside the catchment (biggest, and cheapest to fix)
Every household inside the polygon is counted at FULL weight, so one at the far edge counts the same
as one across the street. The Pfizer Practice Evaluation Survey puts **27% of clients within 2 miles**
and mean travel at 5.3 mi — demand is heavily near-weighted, and flat counting overstates the fringe.

**The fix is already built and costs nothing.** The 8/10/12/15-minute budgets are NESTED rings, so
they are a ready-made decay curve: weight the 0–8 min band ~1.0, 8–10 ~0.7, 10–12 ~0.45, 12–15 ~0.25
(curve to be calibrated). Households per band come from differencing the ZIP mixes we already ship
(`z8`, `z10`, `z12`, `z15`). No new routing, no new data, no file growth.
Consequence: absolute visit counts will DROP. That is the correction, not a regression.

### W2 — Overlap is area-weighted, not household-weighted
`overlapFrac` samples the candidate ring on a uniform grid and asks what share of that AREA a
competitor also covers. But households are not uniform inside a catchment, so a competitor covering
the empty half of your area is priced the same as one covering the dense half. Systematically
misprices competition at the urban/rural seam — exactly where the underserved cells surface, so this
one can move rankings.

**Fix:** weight the overlap samples by the household density of the ZIP each sample falls in (the
`zipAt` lookup already runs in the same pass). Build-time change only.

### W3 — The demand chain is modeled end to end and never observed
ACS housing → modeled dog-ownership rate → 2.4 visits/dog-HH → $193/visit. Four inferential steps,
errors compounding, none validated against a real clinic's actual visit count. Internal coherence
(Flower Mound saturated, Celina land-play, SE Dallas underserved) is NOT accuracy.

**Fix path — this is the Buxton Benchmark tier, and it needs data we don't have yet:** the first
customer who uploads real per-clinic visit/revenue figures lets us regress predicted vs actual and
calibrate. Until then this is a DISCLOSURE, not a code change: the model screens, it does not predict.
Interim partial check: compare modeled revenue against the `$538/sq-ft` cross-check already in the
clinic editor for clinics with known building sqft.

### W4 — Capture share assumes parity attractiveness
`A_OWN = 1.0` says the entrant is exactly as attractive as a typical incumbent. No adjustment for
rating, review volume, hours, or service breadth — so a 4.9★ 7-day operator and a 3.7★ weekday-only
practice compete identically. Note `_revW` was deliberately neutralised to 1.0 in 2026-07 because
review-weighting punished new PE clinics; any fix must not reintroduce that failure.

**Fix:** a bounded attractiveness multiplier on the entrant and on incumbents, driven by data we
already scrape (rating, review count, days/wk, service-category count), clamped tightly (e.g.
0.85–1.２5) so it refines rather than dominates. Must be re-validated against the Celina/Prosper/
Argyle trio that calibrated the current constants.

### W5 — Competition counts clinics, not utilization
A practice at 60% capacity leaks demand you can take; one turning patients away leaks more. Today
both count identically at their `_staffW` weight.

**Fix:** we already compute the two-sided read (`_practiceEcon`: demand ceiling vs DVM capacity) for
individual clinics. Extend it to competitors — a clinic whose catchment demand exceeds its roster
capacity should contribute LESS competitive pressure, because it is already full. Needs roster
coverage, which is ~65% statewide, so it must degrade gracefully to today's behaviour when unknown.

**Ordering:** W1 and W2 are build-time and change the numbers — do them together, then re-run the
side-by-side. W4 and W5 are runtime scoring changes; do them after, one at a time, each re-validated
against the anchor markets. W3 is a disclosure now and a product tier later.

## 9. Open questions

- 10 vs 15 minutes as the site headline. Evidence: 15 min is the practice-valuation trade-area
  standard; 10 min is the core. Our catchment applies **no distance decay inside the polygon**, so a
  15-min boundary would overstate unless decay is added. Precompute both; headline 10; show 15 as
  full-trade-area upside. Revisit if decay is added.
- Whether the Opportunity ZIP list should also move to capture-based demand (currently ZIP-grain,
  crow-flies). Out of scope — metro runs only, per §0.
- Whether other metros get precomputed catchments later (Houston/Austin/San Antonio). The build is
  per-metro by construction, so adding one is re-running the pipeline on a different bbox — but each
  adds an artifact to ship, so do it on demand rather than speculatively.
