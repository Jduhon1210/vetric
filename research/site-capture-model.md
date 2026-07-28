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
as one across the street. Flat counting overstates the fringe.

**The fix is already built and costs nothing.** The 8/10/12/15-minute budgets are NESTED rings, so
they are a ready-made decay curve. Households per band come from differencing the ZIP mixes we
already ship (`z8`, `z10`, `z12`, `z15`). No new routing, no new data, no file growth.

#### W1 calibration — what the literature actually says (researched 2026-07-27)

Three independent sources, deliberately chosen because they can disagree:

1. **Huff-model convention (GIS/retail standard, Esri + ArcGIS Pro docs).** The distance-decay
   exponent β in `attraction / distance^β` is empirically **1.5–2.0** across retail categories.
   This is generic retail — it includes impulse and convenience goods, which decay FASTER than a
   planned, loyalty-driven service like veterinary care, so it should read as an upper bound.
2. **Trade-area zone convention.** Primary trade area = **60–70% of customers**, secondary 20–25%,
   tertiary the remainder. Drive-time band norms by category: QSR/coffee 5–7 min, grocery 10–12 min,
   specialty retail 15–20 min. Vet care sits in the grocery-to-specialty range, which is what
   independently justifies a 15-minute outer boundary.
3. **Vet-specific client travel (Pfizer Practice Evaluation Survey via dvm360).** Mean client travel
   **5.3 miles**, **27% of clients within 2 miles**.

**A single power law cannot fit both vet facts, and that is the useful finding.** Fitting only
"27% under 2 mi" wants β≈1.55; fitting only "mean 5.3 mi" wants β≈1.8. The gap is the signature of a
distribution tighter near the clinic and fatter in the tail than a pure power law — a handful of
clients who follow a trusted vet a long way. Joint-fitting both facts (grid search over β and an
effective max travel distance) gives **β = 1.38 with an effective range of ~13 mi**, reproducing
mean 5.30 mi and 26.8% under 2 mi — both targets, simultaneously.

**Cross-check against source 2, using our own real polygon areas** (median 19.2 / 32.2 / 53.2 / 98.0
sq mi at 8/10/12/15 min): at β=1.38 the implied client split is **64% inside 10 minutes** — dead
centre of the published 60–70% primary-zone convention. Two unrelated sources land on the same curve.

**Shipping value: β = 1.5.** It is the top of the vet-data fit and the bottom of the Huff convention
range — the one point where all three sources overlap — and it is deliberately the more conservative
(steeper) end of that overlap, so the fringe is discounted harder rather than softer. Ring weights,
computed as the area-weighted mean of `t^-β` within each band and normalised to the inner ring:

| band | weight | share of captured clients |
|---|---|---|
| 0–8 min | 1.00 | 55% |
| 8–10 min | 0.28 | 11% |
| 10–12 min | 0.21 | 14% |
| 12–15 min | 0.15 | 20% |

→ primary (0–10 min) = **67%** of captured demand, inside the 60–70% convention.

`CATCH_DECAY_BETA` is a named constant so this is a one-line retune, not a rebuild — the four ring
budgets are already in the artifact.

**Consequence: absolute visit counts DROP to ~35% of the flat count.** That is the correction, not a
regression — the old number counted a household 14 minutes away exactly like one across the street.
Rankings only move where the ring MIX differs between cells, i.e. freeway-stretched catchments lose
more than compact ones. That is precisely the distortion W1 exists to remove.

**Not double-counting distance:** the decay weight answers "does this household participate in the
market at all", the existing Huff `_grav` term answers "which clinic wins them". Standard two-stage
formulation; the terms are complementary, not duplicative.

#### W1 + W2 — BUILT AND VALIDATED (2026-07-27)

Implemented together because both are build-time, and because validating W1 exposed two real bugs
that had to be fixed first.

**Bug 1 — ZIP coverage was quantised, badly, and only at large budgets.** `ringZipMix` used a FIXED
26x26 sample grid over each ring's bounding box. As a ring grows 24 -> 129 sq mi the same 676 samples
get coarser, so a small ZIP's coverage was estimated in ~0.2 steps at 15 min while being accurate at
8 min. ZIP 75226 read **100% covered at 8 min and 31% at 15 min** — physically impossible. Differencing
the four cumulative rings to get bands surfaced it: 2,857 cells had a ZIP whose coverage SHRANK as the
polygon grew. Flat-summing the 15-min ring had hidden it completely.

**Fix — one fine-resolution pass instead of four coarse ones.** The rings are built from 72 evenly
spaced rays out of one origin, so they are **star-shaped**: containment is "is this sample nearer than
the boundary at its own bearing", an O(1) interpolation rather than a 72-edge crossing test. That makes
a fixed 0.25-mi sample grid affordable. A ZIP raster built once at the same resolution turns the
per-sample ZIP lookup into an array index (it was the real cost). Each sample lands in exactly one
band, so **band mixes are disjoint by construction and monotonicity is structural, not checked**.
Artifact v2 ships `b` = four disjoint band mixes instead of four nested cumulative ones.
Residual: raster sampling still quantises very small ZIPs (a 0.4 sq mi ZIP gets ~6 samples), so bands
are normalised per ZIP to cap cumulative coverage at 1.0 — preserving the band distribution, which is
what decay reads. Before the fix: median overflow 1.04, max 1.42, every worst case a ZIP far under the
53.7 sq mi median.

**Bug 2 — the share formula was wrong in a way that flatters no one.** Summing per-competitor overlaps
and taking `1/(1+sum)` is NOT the same as splitting each household among the clinics that actually
reach it and then averaging. By Jensen's inequality it systematically over-penalises. Correct share on
real data is **1.91x** the aggregate form. The per-household split is build-time information, so the
artifact now ships `cd[n]` = the household-weighted share of the market reached by exactly n
competitors; the app computes `sum cd[n]/(1+n)` and can still layer its own roster weights on top.

**W2 proper:** overlap is now weighted by ACS household density per sample rather than by area, so a
competitor covering the empty half of a market no longer prices the same as one covering the dense
half. This is the build's only Census call, cached locally; the app still owns the pet model.

#### THE VALIDATION GATE — and it passes

The decay curve is calibrated from published trade-area literature. DVM rosters are scraped from
clinic websites. Nothing connects them, so agreement is real evidence.

Modelled winnable visits/yr at 831 real clinic locations, against scraped rosters (n=2,408,
median 2 DVMs, mean 3.12) at `DVM_VISIT_CAPACITY` 3,200:

| model | median visits/yr | implied DVMs | vs empirical median of 2.0 |
|---|---|---|---|
| **decayed, beta=1.5** | **6,071** | **1.90** | **within 5%** |
| flat (today) | 17,053 | 5.33 | 167% too high |

Real practices run below full capacity, so landing slightly under 2.0 is the right side to miss on.
32% of clinics fall inside the 6,400-9,990 full-capacity band.

**This retires the "flat is fine" hypothesis.** Flat counting does not merely inflate absolute
numbers — it implies the median DFW clinic is a 5-DVM hospital, which the roster data directly refutes.

Caveat kept honest: the gate omits the senior-age and low-income damps (extra Census calls), both of
which only REDUCE demand — so the true figure sits slightly below 1.90, not above. This validates the
DECAY CURVE, not the whole demand chain; W3 remains open.

#### W6 — SPEND POWER (added 2026-07-27, user: "we still need to include how important household income is")

Wiring the capture model re-opened the **vet-desert trap** the ZIP List closed in June. Raw
road-network geometry ranks a market on EMPTINESS: southeast Dallas topped all of DFW on reach x
share alone. The whitespace is REAL — verified directly against the shipped clinic data, **0 clinics
within 3 miles, 1 within 5** (controls: Plano 17 within 3 mi, Frisco 21) — but ability to REACH a
market and ability to PAY are different axes, and the capture score had dropped income entirely.

**Literature-derived, and deliberately NOT the ZIP List's percentile `_util` curve.** The capture
score encodes absolute winnable VISITS, so a percentile damper would mean something different in
every region and would distort the visit count itself. Anchored in dollars instead:

- **BLS Consumer Expenditure Survey** — top income quintile spends ~2.5-3x the bottom on pets,
  driven by spend PER PET rather than pet count. Bottom/top ratio ~0.36.
- That total already contains the ownership difference, which `_incDampF` models separately (0.85
  floor). Netting it out leaves the utilisation+spend residual: **0.36 / 0.85 = 0.42**. Applying
  both then reproduces the published 0.36 end to end instead of double-counting it.
- **AVMA 2017 Pet Demographics** — 69% of dog owners under $20k see a vet annually vs 93% at
  $100k+ (82% overall), so ~0.74 of the gap is participation and the remainder is spend per visit.
- BLS puts the behavioural inflection at $65-75k; the curve passes through it near 0.70.

`_catchSpendF(inc)` = clamp(0.42 + 0.58 x (inc - 25k)/85k, 0.42, 1.0). Unknown income -> 0.85 (a
mild haircut, never a free pass). No boost above $110k — only poverty deflates, matching
`_incDampF`'s asymmetry. Income is the **catchment's** decay- and household-weighted mean across
every ZIP the site reaches, not the single ZIP it sits in.

Effect on the live DFW run: SE Dallas raw reach 47,868 visits/yr -> **31,653** after a 0.66 spend
multiplier, and it stays #1 at 96/100 — surviving on economics rather than on emptiness, with four
affluent markets now competing directly against it instead of being buried by it.

#### Wiring defect found and fixed in the same pass
The runtime siting gate re-tested every candidate for retail within 280 m using `evalData.retail` —
a CAPPED OSM fetch at metro bbox — even though the candidate had already passed a commercial-fabric
gate at build time built from COMPLETE data (5,905 dfw-retail points UNION 16,868 county
vacant-commercial parcels). A worse dataset was re-filtering what a better one had approved:
**9,627 candidates cut to 433 (95%)**, and the verified SE Dallas whitespace was silently dropped
before scoring. Capture-mode cells now skip the retail-proximity test (zoning EXCLUDE still
applies). Scored cells went 433 -> **8,830**, and the offline prediction and the in-app result then
agreed exactly — which is what confirms the wiring is faithful to the validated model.

#### W4a — SIZED ENTRANT (2026-07-27, user: "the best sites would support higher revenue clinics")

**The user was right, and the miss was mine.** My W1 validation checked ONE point of the
distribution (median 1.90 model vs 2.0 roster), declared the curve validated, and moved on. Checking
the whole distribution against 576 clinics with scraped rosters shows the model tracked the median
and then collapsed:

| | p25 | p50 | p75 | p90 | max |
|---|---|---|---|---|---|
| fixed 2.5-DVM probe | 1.2 | 1.9 | 2.6 | 3.1 | 4.8 |
| actual roster | 1.0 | 2.0 | 4.0 | 7.0 | 25 |
| ratio | — | 0.95 | **0.64** | **0.45** | — |

**Cause is structural, not calibration.** `A_OWN` was a CONSTANT — "one more typical 2-3 DVM
clinic" — so the model was really asking *"how much could a small clinic win here"* and was
incapable of returning "this supports seven doctors". Meanwhile we already size every COMPETITOR
through `_staffW`. Sizing every rival but not ourselves is an inconsistency in the model.

**Fix — orthodox Huff with a fixed-point solve.** Attraction is a property of the facility:
`share(n) = A(n)/(A(n)+k*wBar)` over the `cd[k]` buckets; solve for `reach*share(n) = n*3200`, the
size at which a practice fills exactly what it can win. The root is unique: share rises but is
bounded by 1, so `reach*share(n)` is bounded while capacity grows without limit — exactly one
crossing. No tuning knob.

**Two confounds found and removed on the way:**
1. *Measurement, not model* — the roster's top end included ER/urgent-care practices that draw
   regionally rather than from a 15-minute GP catchment (max=25 is an urgent care). Excluding them
   moved the p90 ratio 0.45 -> 0.62 on its own. This was my measurement error, not a model gain.
2. *A real bug the verification caught* — the solver first used `_staffW` for the entrant, which is
   NON-MONOTONIC across fractional sizes (`_staffW(0.5)=1.0` but `_staffW(1)=0.8`, because of its
   "unknown roster" sentinel) and clamps to [0.8,1.8] to guard against roster-scrape undercounting.
   Both are correct for an OBSERVED competitor and wrong for a solved-for entrant. The fixed point
   landed on nonsense (0.42 DVM) until `_catchAttract` was split out: same sqrt(n/2.5) shape and
   centring, no sentinel, no measurement clamp. Verified monotonic, and the identity
   `reach*share == n*capacity` holds to 0 decimal places at the solution.

**Result (live DFW):** ceiling 4.8 -> 7.7 DVM. Ratios are now roughly UNIFORM at ~0.65-0.76 across
the distribution instead of 0.95 at the median collapsing to 0.45 at p90 — a shape-correct model
with a known scale factor, which is far more useful than one right in the middle and wrong at both
ends. Dense high-reach markets became competitive for the first time: a Plano/Frisco cell reaching
105,658 visits at only 14% share now supports 4.7 doctors.

**The residual ~0.7 ratio is probably CORRECT and should not be tuned away.** The model predicts
what a NEW entrant can win; an incumbent has a client base built over years. That gap is the
incumbency premium, and a site-selection model should not claim to predict decades of reputation
from geography. Honest target is matching p75, not the max.

**KNOWN AND ACCEPTED:** this lowers the median (1.9 -> 1.5) because a small entrant in a weak market
now correctly sizes DOWN.

**NOT fixed by this:** the user's second intuition, that the best sites should sit in higher-income
areas. Top-5 mean catchment income is $89k against a DFW median of $95k — the sized entrant made
dense MID-income markets competitive rather than tilting toward affluence. Shifting that would be a
deliberate weighting preference, not a literature-derived correction, so it is left as an explicit
open choice rather than quietly tuned into `_catchSpendF`.

#### W6b — VISITS vs PRICE, and ranking on REVENUE (2026-07-27, user: "what matters is revenue")

**A real error, surfaced by the user asking whether a $59k catchment should really rank first.**
The income effect is not one number. It decomposes:

    0.36 total  =  0.85 ownership  x  0.74 visits per owner  x  0.57 price per visit
    (BLS)          (_incDampF)        (AVMA participation:      (the residual)
                                       69% of owners under
                                       $20k see a vet annually
                                       vs 93% at $100k+)

The first version applied a single **0.42 floor to VISITS** and left price flat at `REV_PER_VISIT`.
Total spend came out right (0.85 x 0.42 = 0.36) **so the BLS check passed** — but both halves were
wrong, and the errors do NOT cancel in the ranking, because the score was a VISIT-VOLUME metric.
A poor market genuinely supports MORE doctors (more visits per dollar of income) and LESS revenue.

Proof, ranking the same corrected model two ways:

| ranking metric | #1 catchment | top-5 mean income |
|---|---|---|
| doctors | $63k, 10.2 doctors | $95k |
| **revenue** | **$97k, $5.67M** | **$100k** |

Fixed: `_catchSpendF` floor 0.42 -> **0.74** (visits only), new `_catchACTF` floor **0.57** (price
per visit), and the score is now `winRev / CATCH_REV_FULL` where the anchor is ten doctors billing
at full-price ACT — so EVAL_STRONG 0.22 still means the same thing, now readable as **$1.36M
revenue**. Verified end to end: 0.85 x 0.74 x 0.57 = 0.359 against the BLS 0.36, top end exactly 1.0.

**HONEST OUTCOME: this did NOT flip the ranking to high-income markets.** Live DFW still puts a
$63k SE Dallas catchment first, now at $4.44M revenue, and top-5 mean income moved only $89k ->
$91k. The offline estimate that predicted a $97k #1 used STUB rosters (every competitor assumed 2
DVMs); the live run reads REAL rosters, and dense affluent markets carry bigger incumbent rosters,
which raises `wBar` and cuts their share. That gap between the stub prediction and the live result
is a caution about trusting offline estimates that stub out a live input.

So after correcting a genuine modelling error, the model's answer is unchanged in direction: SE
Dallas leads on revenue because the market is large AND uncontested, not because of a metric
artifact. Any further tilt toward affluence would now be a TARGET-MARKET PREFERENCE applied on top
of a corrected model — a legitimate product feature (a filter or a weight the user sets), but not a
correction, and it should not be buried inside `_catchSpendF`.

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
