# Market-Capture Methodology — Deep Research & Recommended Architecture

*2026-07-16. Deep-research harness: 5 search angles, 21 primary sources fetched, 104 claims extracted.
Verification caveat: the adversarial-verify stage died on a subagent billing limit after confirming 2 claims
(2–0 votes); remaining claims are single-extractor reads of primary sources — treat numbers as
quoted-from-source but not independently re-verified.*

## 1. Bottom line

**The structure of Vetric's current model is right; the parameters are the gap.** The literature and the
industry agree on the same three-step ladder:

1. **Gravity/Huff with distance + capacity is the correct backbone.** In the strongest healthcare
   analogue found (BC Bio patient-choice study, ~14M referral records), model error collapsed from
   closest-facility (SSE 1.8×10¹⁰) → distance-only (1.1×10¹⁰) → **distance + capacity (2.8×10⁹)** —
   and every further attractiveness variable added only marginal accuracy. Hospital-choice literature
   (226k admissions, Derbyshire UK) found distance dominant and **published quality/ratings metrics
   statistically non-significant** once distance and capacity were controlled. Both directly validate
   Vetric's roster-weighted, review-neutral competitor pull.
2. **Uncalibrated exponents are the documented weakness.** Esri ships Huff with default exponents and
   explicitly warns they "may not fit a given trade area." An uncalibrated textbook Huff predicted
   grocery revenue at MAPE ~64% (Pseudo-R² 0.51); a survey-calibrated size-plus-distance model explains
   only ~R² 0.46–0.60. **Huff parameters are not transferable across regions or industries** — each
   market needs its own fit. Fitted decay exponents in the wild run ~0.4–1.6, far from any universal
   constant, and vary by city and category.
3. **Calibration against observed behavior is what buys accuracy.** Calibrated models hit Pearson
   0.86–0.91 on visit-share prediction (Whole Foods/Trader Joe's/Ross vs SafeGraph flows; PSO-fitted
   exponents), 0.89–0.91 on card-transaction patronage (150 shopping centers), pseudo-R² 0.80–0.87 on
   healthcare facility volumes with **out-of-sample aggregate share within 2 points (predicted 76% vs
   actual 74%)**, and store-level revenue MAPE ~22% (calibrated extended Huff, 76% of block-level share
   variance explained — ~50% better than uncalibrated). PSO/derivative-free fitting beat the classical
   Nakanishi–Cooper OLS **(confirmed 2–0)**; per-district calibrated Huff hit r 0.89–0.91 in
   convenience categories **(confirmed 2–0)**.

**Honest accuracy ceiling without proprietary visit data: roughly "half the variance."** Size+distance
gravity with assumed parameters ≈ R² 0.5 territory with wide site-level error. With calibrated
parameters from a behavioral dataset: correlation 0.85–0.9 / MAPE ~20–25% at facility level — the
practical maximum until actual client revenue data exists (Buxton gates its true forecasting tier at
50+ client locations with patient-level histories for exactly this reason).

One category warning: gravity fits are category-dependent — convenience categories (grocery, gas)
calibrate to r ~0.9, but hedonic/destination categories (restaurants r 0.76, worst districts
unpredictable) fit worse. Vet care almost certainly behaves convenience-like (supported by the
distance-dominance findings in human healthcare), but **no published vet-clinic trade-area study was
found** — the closest is Fülöp/Kopetsch/Schoepe 2011 (medical-practice catchments, Annals of Regional
Science). Whoever calibrates vet-specific decay first has a genuinely novel data asset.

## 2. What the industry actually does (and what it means for Vetric)

- **Esri Business Analyst**: ships uncalibrated Huff + a dedicated calibration tool that fits exponents
  from customer records **or mobile-movement data**; attractiveness is MCI-style (multiple variables,
  each with its own exponent). Vetric's architecture maps 1:1 onto this — minus the calibration step.
- **Buxton**: no universal formula. Every variable (distance decay, competition, co-tenancy,
  cannibalization) is a *candidate* tested per client against observed performance. Model ladder gated
  by client data: 0–20 locations → site-score; 21–50 → benchmark; 51+ → true revenue forecasting
  (requires patient addresses + visit/revenue history). Publishes zero accuracy figures.
- **Placer.ai**: replaced modeled trade areas with *observed* ones ("True Trade Areas" = actual visitor
  home CBGs from its phone panel). Claims 90%+ correlation with first-party data (aggregate-level,
  unvalidated at single-site level, and by definition unavailable for de novo sites). Healthcare
  vertical exists; nothing vet-specific published. Enterprise ~$50k/yr.
- Positioning takeaway: **nobody in the market has calibrated vet-specific capture.** Buxton calibrates
  per-client (needs the client's data), Placer observes (can't observe a site that doesn't exist).
  A metro-calibrated vet Huff model is white space.

## 3. Calibration datasets, ranked by accuracy-per-dollar

| Rank | Dataset | What it gives | Cost | Caveats |
|---|---|---|---|---|
| 1 | **Pilot-client actuals** (revenue/visits per clinic, later patient ZIPs) | True totals → totals-only calibration; eventually OD flows | Free with pilots | The Buxton path; needs clients first; n grows slowly |
| 2 | **Advan Patterns (ex-SafeGraph) via Dewey Data** | POI visit counts + **visitor home-CBG flows** for TX vet clinics = real OD ground truth | Not published publicly; Dewey is the researcher-tier channel (historically ~$1–3k/yr class, vs Placer $50k) | Panel ~7.5% of US pop but fluctuates 4.5–14.5% (needs normalization); CBG-grain representativeness degrades; Hispanic/low-income underrepresentation (material in TX); **strip-center tenant attribution imprecise — many vet clinics are inline tenants**; slight silver lining: sampling rates skew HIGHER in the South |
| 3 | **Google Popular Times / review-count deltas** (already scraped adjacently) | Relative busyness/patronage proxies per clinic | ~Free | Legally gray to scrape at scale; noisy; no origin data — supports totals-only calibration only |
| 4 | **Card-spend panels** (Affinity etc.) | Merchant revenue as attractiveness mass; validated calibration source in the literature | $$$, enterprise | Overkill until scale |
| 5 | **Customer-origin surveys** | The classical calibration input | Cheap per market but manual | Viable one-off validation for 1–2 metros |

Two findings make the cheap path viable: **(a) totals-only calibration exists.** The MCI/huff R-package
lineage (huff.lambda; Güssefeldt 2002 attraction-fitting) fits the distance-decay exponent from
*per-location totals alone* — annual revenue or total patronage per clinic — no origin-destination data
required, with named fit metrics (Pseudo-R², MAPE, Klein's global error). Vetric's modeled-revenue +
review-count proxies can seed this today; pilot revenue actuals upgrade it. **(b) Free network travel
times.** OpenRouteService (and self-hosted OSRM, already planned as Phase 2 of the catchment work)
provide zero-cost drive-time matrices. The Freiburg grocery study's single biggest accuracy contributor
was **hybrid distance (average of Euclidean and fastest-route time)** — pure Euclidean fails short-range,
pure network fails long-range. Vetric already has both halves; blending them is free accuracy.

## 4. Recommended architecture for Vetric

**Keep:** share = A/(A + Σ pull) with fair-fight entrant; roster-size (capacity) weighting — the
literature's second-strongest predictor after distance; review-neutrality (validated by the hospital
findings); the network-catchment overlap layer (novel vs. everything surveyed except Placer).

**Change (free, near-term):**
1. **Parameterize the decay** — replace fixed linear decay with a power/exponential form
   `d^-β` with β a named constant per metro (start β≈0.8–1.0 per the SafeGraph-calibrated fits), so the
   model *can* be fitted. An unfittable model can never graduate.
2. **Hybrid distance** — demand/competition gravity on the average of straight-line and network time
   (the single biggest accuracy lever in the calibrated-Huff literature; OSRM Phase 2 supplies it).
3. **Totals-only calibration v0** — fit β per metro so model-implied clinic patronage best matches
   observed proxies (review-count totals now; pilot revenue later). Publish the fit metric (Pseudo-R²)
   in the Data tab — "calibrated against N clinics, fit 0.XX" is itself a sales artifact.
4. **Endogeneity note** — roster size is partly a *consequence* of demand, not just a cause (the
   hospital-beds caveat). Keep roster weights sublinear (already are, via _staffW clamp).

**Buy (one purchase, ~$1–3k class): Advan Patterns for Texas vet-care POIs via Dewey.** Home-CBG →
clinic flows for a few hundred DFW clinics = the exact ground truth the Wisconsin/PSO studies used.
Fit α (attractiveness exponent) and β (decay) per metro via PSO; validate holdout clinics; correct for
panel bias (normalize by CBG device counts; flag strip-center clinics as lower-confidence). Expected
outcome per the benchmarks: share-prediction correlation from ~unknown to ~0.85–0.9, and the right to
say "capture model calibrated against observed visit flows for Texas veterinary clinics" — which no
competitor can say.

**Later (client-data tier):** pilot clinics' revenue → per-market attraction refits (Güssefeldt loop);
patient-ZIP exports from any willing pilot → full MCI/OLS calibration with inference stats; publish
error bands per prediction. This is Buxton's $100k tier rebuilt on ~$2k of data and open-source tooling
(the `huff` Python package implements MCI log-centering + MLE fitting).

## 5. Accuracy expectations to communicate honestly

| Model state | Expected performance (from published analogues) |
|---|---|
| Today (fair-fight Huff, assumed params, network overlap) | Structure validated; share point-estimates ±10–15 pts; ~R² 0.5-class on revenue |
| + hybrid distance + fitted β from totals-only calibration | Meaningful but unquantified gain; fit metric becomes publishable |
| + Advan OD calibration (per-metro α, β) | Visit-share correlation ~0.85–0.9; facility MAPE ~20–25%; aggregate share within a few points |
| + client actuals (Buxton-ladder top) | Site-level revenue forecasting; industry ceiling; needs 50+ observed clinic-years |

## Sources (21 fetched; key ones)

- arxiv.org/pdf/1902.03488 — Huff validation vs 4.25M card transactions, 150 centers; PSO > OLS (2 claims confirmed 2–0)
- geography.wisc.edu …2020_TGIS_DynamicHuffModel.pdf — SafeGraph-calibrated Huff, r 0.86–0.90; fitted exponents 0.06–1.58
- cran.r-project.org/web/packages/MCI/MCI.pdf — MCI log-centering; totals-only λ calibration; fit metrics
- semanticscholar 3cdd…3a90.pdf — Karlsruhe survey calibration, R² 0.46–0.60; uncalibrated MAPE 64%
- sciencedirect S014362281300266X — calibrated extended Huff: 76% share variance, MAPE 22.3%, hybrid drive time = biggest lever
- sciencedirect S0966692323002624 — mobile-data Huff calibration (airports); parameter non-transferability
- springer s10729-017-9399-1 — hospital choice: distance dominant, quality metrics non-significant
- sauder.ubc.ca BC Bio patient-choice — MNL pseudo-R² 0.80–0.87; out-of-sample share within 2 pts; distance+capacity carry nearly all power
- esri.com calibrating-huff-model.pdf + pro.arcgis.com Huff docs — industry default-exponent warning; calibration tool inputs
- buxtonco.com (2) — per-client calibration; model ladder gated by location count; top tier needs patient-level data
- placer.ai trade-area guide — observed trade areas; 90% aggregate correlation claim; ~$50k/yr
- journals.plos.org 0294430 — SafeGraph panel bias audit (7.5% avg sampling, 4.5–14.5% swing; TX-relevant demographics)
- deweydata.io/advan — Patterns lineage, home-origin aggregations, US/CA coverage; pricing gated
- researchgate `huff` Python package — open-source MCI/MLE calibration + free ORS travel times
- link.springer s10742-022-00298-4, pmc PMC10540423, arxiv 2601.15977 — attribute-imputation & SafeGraph-for-hospitals feasibility
