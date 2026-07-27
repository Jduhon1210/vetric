# Site Capture Model — design spec (2026-07-26)

Status: **DESIGN — not built.** Written before the infrastructure work so the model can be reviewed
on its merits first. Implementation is gated behind a revertible switch (§5) so the current engine
remains the default until this one is proven better on real markets.

---

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
2. **Side-by-side rankings** — run both models on the same markets and diff the top-5. Anchor cases:
   a dense established suburb (Plano/Richardson), a saturated one (Flower Mound), a growth exurb
   (Celina/Prosper), and a metro-wide run.
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

## 8. Build order

1. This spec reviewed and approved
2. Model switch + Settings toggle shipped with `'gravity'` default (revert path exists before the
   new model does)
3. OSRM stood up on a DFW-clipped extract; validate §6.1 against cached Google rings
4. `build-catchments.mjs` → `dfw-catchments.json`
5. Wire the `'capture'` path; run §6.2 side-by-sides
6. Only then consider changing the default

## 9. Open questions

- 10 vs 15 minutes as the site headline. Evidence: 15 min is the practice-valuation trade-area
  standard; 10 min is the core. Our catchment applies **no distance decay inside the polygon**, so a
  15-min boundary would overstate unless decay is added. Precompute both; headline 10; show 15 as
  full-trade-area upside. Revisit if decay is added.
- Whether the Opportunity ZIP list should also move to capture-based demand (currently ZIP-grain,
  crow-flies). Out of scope here; sites first.
