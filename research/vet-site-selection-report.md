# How PE Firms & Regional Chains Decide Where to Build/Buy Veterinary Clinics

*A research report for VetMetric. Compiled 2026-06-24.*

> **Status:** Both research passes are complete.
> - **Parts 1–4** (first pass): 21 sources, 91 claims extracted, 25 adversarially fact-checked → **22 confirmed / 3 refuted**. These findings are independently verified.
> - **Part 5** (second pass): 28 sources, 116 claims extracted. The fact-check originally aborted on a rate limit, but was **re-run on 2026-06-24 → all 25 checked claims CONFIRMED 3-0** (verifiers fetched each source directly, incl. parsing the AAVMC PDF, and cross-checked the numbers). Part 5 is now **independently verified**, with a few precision caveats folded in below (the most important: the AAVMC shortage report has since been *withdrawn pending review* — its figures are quoted accurately but its standing is contested).

---

## How to read this

The single most important framing, up front, because it governs how much to trust each section:

**The public record on what *named PE veterinary consolidators* (Mars/VCA, NVA, Thrive, etc.) actually do internally is thin.** Their real weighted scoring models, investment-committee hurdles, and de-novo-vs-acquisition rules are proprietary and essentially unpublished. What *is* well-documented — and what most of this report rests on — is:

1. The **tooling and methods** the industry uses (GIS platforms, demographic vendors, vet-specific demand models). These are confirmed from primary vendor sources.
2. The **directly-analogous playbook from urgent care and dental DSOs**, which buy and build multi-site healthcare on the same logic and *are* documented in detail. Where a finding is borrowed from these adjacent sectors, it's labeled.

So: treat the **tools/methods** findings as high-confidence fact, and the **process/weighting/financial** findings as "the best-documented version of the playbook, much of it from adjacent sectors" — directionally right, not a leaked NVA playbook.

Each finding is tagged **[High]**, **[Medium]**, or **[Analog]** (validated in urgent care/dental, applied to vet by extension).

---

## Executive summary

PE-backed vet consolidators and their multi-site healthcare cousins run a four-stage funnel that is remarkably consistent across sectors:

1. **Screen markets** on demographics + pet/patient demand.
2. **Quantify competition/saturation** inside a drive-time trade area.
3. **Score candidate sites** with a *transparent, analyst-weighted* suitability model.
4. **Clear a financial hurdle** at an investment-committee-style go/no-go gate, anchored to EBITDA economics.

The dominant tool is **Esri ArcGIS Business Analyst** (suitability scoring, drive-time trade areas, location-allocation, cannibalization), fed by **Claritas** demographic/segmentation data, **Placer.ai** foot-traffic, and vendor-built predictive models from **Buxton**. Vet-specific demand sizing uses the **AVMA Market Share Estimator** (a five-step service-area → households → pets → market-potential → share method) and competition density from **Esri's NAICS 541940** business counts.

**The one principle every source agrees on:** competition is *inverted* in scoring — each additional existing clinic inside the radius **lowers** a candidate site's score. That is exactly the absolute-capture logic VetMetric already implements, which is a strong external validation of the app's core design.

---

## Part 1 — The end-to-end process (market → opened clinic)

⚠️ *This is the weakest-documented of your four questions for veterinary specifically. The stage structure below is synthesized from the urgent-care/dental DSO playbook plus vet-specific demand tooling. Timelines and committee mechanics for named vet PE firms were **not** found in the verified set — flagged as an open question for Part 5.*

The composite funnel that emerges:

**Stage 1 — Market screening (the "where to look" filter).** Rank metros/regions on demographic demand (household income, household size, population growth projections) and pet-ownership statistics, then narrow to trade areas. Tools: GIS + demographic vendors. **[Analog/Medium]**

**Stage 2 — Trade-area definition.** Draw the catchment as a **drive-time** (not just a radius) — roughly **10 minutes in urban markets, up to 30+ miles in rural** ones. Trade-area size flexes with density. **[Analog/Medium]** (Esri's Network Analyst powers the drive-time bands.)

**Stage 3 — Site suitability scoring.** Score candidate sites in the trade area on a weighted set of factors (demand up, competition down — see Part 2). Output is a color-coded ranked list. **[High]**

**Stage 4 — Competitive/saturation check.** Count existing clinics + adjacent medical facilities in the radius; assess whether incumbents are at capacity and what share is corporate-owned. **[High/Analog]**

**Stage 5 — Financial underwriting & go/no-go.** Model unit economics, apply EBITDA/return hurdles, decide build (de novo) vs buy (acquisition). **[Medium]** (Specifics → Part 5.)

**Stage 6 — Deal/lease, build-out, open.** Real-estate execution and construction. **[Gap]** — essentially undocumented in the verified set; targeted in Part 5.

**Who's involved** (inferred from the DSO/urgent-care model): a corporate development / M&A team for sourcing, a real-estate/site-selection analyst team running the GIS, and an investment committee for the gate. *Not verified for vet specifically.*

---

## Part 2 — The data points and how they're weighted

### The factors that consistently appear

| Factor | Direction | Confidence | Notes |
|---|---|---|---|
| Household income (median) | ↑ higher = better | [Medium/Analog] | Treated as ~proportional to utilization (a heuristic, not literal) |
| Population growth projections | ↑ | [Medium] | Forward-looking demand |
| Household size / count | ↑ | [Medium] | Feeds pet-population estimate |
| Pet ownership / density | ↑ | [Medium] | Vet-specific demand driver |
| **Competition / clinic density** | **↓ inverted** | **[High]** | More existing clinics = lower score |
| % of competition corporate-owned | context | [Medium] | Validates PE-vs-independent distinction |
| Incumbent capacity ("aging out", overflowed) | ↑ opportunity | [Medium/Analog] | Qualitative |
| Traffic counts / visibility / co-tenancy | ↑ | [High/Analog] | "Impression frequency" |
| Real-estate fundamentals (access, parking, signage) | ↑ | [High/Analog] | Buxton's 4th pillar |
| DVM/labor supply | constraint | [Gap] | Known binding constraint, but the data pipeline was **not** covered → Part 5 |

### How weighting actually works — the key insight

**Weights are analyst-set, not a fixed industry formula.** [High] In Esri's Business Analyst the suitability tool:

- Starts every criterion at an **equal default weight** (e.g., 14 criteria → 7.14% each, summing to 100%).
- The analyst then **manually re-weights and locks** the factors that matter; remaining weights **auto-adjust proportionately**.

The only concrete weighting numbers found anywhere are from **Esri's worked urgent-care example**: **competitor density 33%**, poverty population 10%, health-services businesses 10%. **[Analog]** — illustrative, not a canonical vet scheme. *There is no published "correct" veterinary weighting.* This is itself a product opportunity (see VetMetric implications).

### Inverted competition — the load-bearing principle

[High] Esri sets the existing-facility layer to **"Inverse" influence**: "as the number of urgent care centers in an area rises, the demand for an additional center decreases." Multiple independent sources converge on this. **This is the exact logic in VetMetric's `_evalComputeAndRender` absolute-capture model** (`share = A_OWN/(A_OWN+comp)`), and validates the CLAUDE.md decision *not* to use relative `1−comp/maxComp`.

### Cannibalization (overlap with your own existing sites)

[High] Foot-traffic platforms quantify cannibalization as **trade-area/visitor overlap** — the % of an existing site's visitors who also visit a nearby candidate. Industry thresholds: **~20% = meaningful risk, ~25% = standard modeling cutoff, >30% = likely revenue redistribution.** (A specific Placer.ai worked example showed 22%.) Relevant once an operator has clusters of clinics.

---

## Part 3 — Tools, software, data vendors, tech stack (best-documented section)

### GIS / site-selection platform — Esri ArcGIS Business Analyst [High]

The dominant commercial platform. Bundles demographic/business/lifestyle/spending/census data and provides:

- **Drive-time & ring trade areas** (via the Network Analyst extension)
- **Suitability scoring** (the weighted three-step workflow above)
- **Territory design, location-allocation, market-penetration** analysis
- Ability to **flag underperforming sites and predict how a proposed location will perform**
- Color-coded ranked output, sortable table, Excel/infographic export

Actively maintained (Feb 2026 release notes). This is the closest commercial analog to what VetMetric is — VetMetric is effectively a vet-specialized, web-native, lower-cost slice of Business Analyst.

### Vet-specific demand sizing — AVMA Market Share Estimator [High]

The veterinary-native demand tool. Five-step method:
1. Define the practice's **service area**
2. Estimate **households**
3. Estimate **pets by species**
4. Calculate **market potential** (total patients, visits, revenue potential)
5. Calculate the practice's **market share**

This is the vet-native mirror of VetMetric's per-ZIP demand + capture-share scoring. (Released 2019, still live.)

### Competition density — Esri NAICS 541940 × AVMA extrapolation [High]

A peer-reviewed method (Frontiers in Vet Science, 2022): pull vet locations + employee counts from Esri's business database under **NAICS 541940 (veterinary services)**, and estimate pet populations by extrapolating **AVMA Pet Demographic survey** state totals to local areas via household counts. *Caveat: this was a care-accessibility academic study, not a PE deployment — it proves the method is sound, not that consolidators use it.* Maps directly to VetMetric's "clinic coordinates × ACS-modeled pet density per ZIP."

### Demographic / segmentation data — Claritas [High]

The leading demographic + segmentation vendor. Named products:
- **PRIZM Premier** (68 consumer segments)
- **P$YCLE Premier** (60, financial)
- **ConneXions** (53, tech/telecom)
- **CultureCode** (multicultural)
- Plus core demographics: age, income, education, household composition, wealth, home ownership

Same dimensions as VetMetric's ACS income/growth/household layers — Claritas is the paid, segmentation-rich version.

### Foot-traffic — Placer.ai [High]

Foot-traffic/location-intelligence for visitor patterns and **cannibalization** (trade-area overlap). ⚠️ One Placer.ai marketing claim — that "True Trade Area" replaces ring methods because rings "miss ~20% of traffic" — was **refuted** in fact-checking; don't cite that specific framing.

### Predictive site-scoring vendor — Buxton (3 tiers) [High]

Buxton classifies healthcare site-selection models by **how much of the client's own data they require** — a genuinely useful maturity ladder:

| Tier | What it is | Data required |
|---|---|---|
| **Industry Site Score** | Pre-built / theoretical model | **None** (no client patient data) |
| **Benchmark Site Score** | Model built from the client's own locations | **~21–50 locations** open 1+ yr, sharing patient data |
| **Forecasting Site Score** | Linear-regression forecast of visits/revenue; **models cannibalization** | **51+ locations** sharing location/patient/encounter data |

**This is the single most strategically useful finding for VetMetric.** VetMetric today is a Buxton **"Industry" model** (purely theoretical, no client performance data). The upgrade path is explicit: once a client shares real clinic-performance data, you can build **Benchmark** then **Forecasting** models — a natural paid-tier ladder.

Buxton's urgent-care methodology (directly analogous to vet) has four pillars: **consumer targeting, impression frequency/visibility, supply-demand balance (saturation), real-estate fundamentals** — and assesses saturation by counting existing centers + medical facilities within a radius. (Experity corroborates a "**>20,000 people per urgent-care center = less competition**" ratio heuristic.)

### Other named tools seen
- **SiteZeus** — healthcare site-selection platform (blog-tier evidence)
- **GrowthFactor** — market-saturation/trade-area analysis (cannibalization thresholds)
- **IDEXX** — publishes new-practice startup guidance (PDF fetch failed; unverified)

---

## Part 4 — The go/no-go decision & financials

⚠️ *No source documented an actual named consolidator's investment-committee process or specific IRR/payback hurdles. What's verified is the **valuation environment** that anchors the gate. Hard thresholds → Part 5.*

### Valuation is anchored to EBITDA, and multiples scale sharply with size [Medium]

Veterinary practices trade at EBITDA multiples that rise steeply with earnings (Q1 2025 figures):

| Practice EBITDA | Approx. multiple |
|---|---|
| $500K–1M | ~5.3× |
| $1–5M | ~8.6× |
| $5–10M | ~11.3× |

**Confidence note:** the *size-scaling trend* is high-confidence (corroborated by many brokers: solo 4–6× → multi-doctor 5.5–7.5× → scaled/specialty 9–12×). The *exact decimals* (5.3/8.6/11.3) trace to a single secondary aggregator and are ~17 months old — treat as medium. 2024–25 shows PE becoming **more selective**, with multiples moderating to **~8–14×** from 2021 peaks of **12–18×**.

### Consolidation context [Medium]
- Corporate/PE ownership of vet clinics rose from **~8% (2011) to ~30–50% (2024–25)**.
- **~$51.6B** invested 2017–2023.
- Only **~17.5% of DVMs are practice owners** (down from ~32% in 2002) — and a documented vet shortage constrains capacity. This labor scarcity is a real site-selection constraint that the research did **not** fully map (→ Part 5).

### The implied decision logic
Bigger, multi-doctor practices command disproportionately higher multiples → buyers prefer scale, and de-novo/roll-up strategies aim to *build* scale. The "% of competition corporate-owned" screening question directly validates VetMetric's **PE-vs-independent density distinction** as a real underwriting input.

---

## What I could NOT confirm, and what was actively refuted

**Honesty section — do not act on these.** Three plausible-sounding claims were killed in adversarial fact-checking (0-of-3 verifiers upheld them):

1. ❌ **"Placer.ai 'True Trade Area' replaces ring methods because rings miss ~20% of traffic."** The cannibalization-overlap capability is real; this specific marketing framing is not supported.
2. ❌ **"Low clinic density = highest practice valuation / payout."** Intuitive, but unsupported as a *direct valuation driver* — valuation tracks size/EBITDA far more than local competition. (Competition still matters for *site* scoring; just not as a clean valuation lever.)
3. ❌ **"Consolidators publicly target multi-doctor practices with $2M+ revenue."** The general preference for scale survives; this specific public "target profile" claim does not.

**Genuine gaps (being researched in Part 5):**
- Actual quantitative go/no-go hurdles (IRR, cash-on-cash, payback, revenue-per-DVM, EBITDA ceilings) and **de novo vs acquisition** criteria.
- The **real, weighted factor model** a specific consolidator uses (vs Esri's illustrative 33/10/10).
- **DVM/labor supply** sourcing & weighting (BLS OES, AVMA workforce, vet-school proximity).
- **Deal-sourcing/CRM + financial-modeling stack**, and **real-estate/lease economics** thresholds (rent-to-revenue, build-out $/sqft, square-footage targets).

---

## What this means for VetMetric (product implications)

The research doubles as a roadmap. Direct reads:

1. **Your core competition logic is validated.** The industry's load-bearing principle — invert competition, score absolute capture — is exactly what's in `_evalComputeAndRender`. Keep it; it's correct and defensible to buyers.

2. **You are a Buxton "Industry"-tier tool today — and the upgrade ladder is your monetization path.** Add the ability for a client to upload their own clinic performance data → build "Benchmark" (vs their own portfolio) → eventually "Forecasting" (regression on visits/revenue, with cannibalization). That's a clean Free → Pro → Enterprise story straight from the dominant vendor's own taxonomy.

3. **Adopt the AVMA five-step demand method explicitly.** Your per-ZIP demand model already approximates it; naming/structuring it as "service area → households → pets → market potential → share" makes the output legible to vet buyers who know the AVMA tool.

4. **Drive-time trade areas > fixed radius.** The industry uses drive-time bands that flex by urban/rural density. VetMetric's fixed 3 mi (6 mi slider) is the known limitation already noted in CLAUDE.md (the A_OWN calibration issue). A drive-time catchment (10 min urban → wider rural) is the right next step for the Evaluate engine.

5. **Cannibalization is a feature you can add cheaply.** Once a user marks their own clinics, compute trade-area overlap and flag >25%. It's a recognized, expected analysis.

6. **Add a competition-weight slider with a sane default.** Esri's tool makes weights analyst-controlled; the one concrete number out there is ~33% on competition. VetMetric's opportunity sliders already do this — lean into it as a selling point ("you control the weights, unlike a black-box vendor model").

7. **DVM labor supply is a missing factor worth adding.** The vet shortage is a binding real-world constraint on where you can actually staff a clinic; no consumer tool surfaces it well. A "vet labor availability" layer (BLS/AVMA + vet-school proximity) could be a differentiator. (Part 5 will detail the data pipeline.)

---

## Sources (Part 1)

**Primary / vendor & official:**
- Esri — ArcGIS Business Analyst overview: https://www.esri.com/en-us/arcgis/products/arcgis-business-analyst/overview
- Esri — Urgent-care suitability analysis (weighting + inverted competition): https://www.esri.com/arcgis-blog/products/bus-analyst/analytics/urgent-care-center-suitability-analysis
- Esri — Suitability analysis docs: https://doc.arcgis.com/en/business-analyst/web/suitability-analysis.htm
- AVMA — Market Share Estimator: https://www.avma.org/resources-tools/practice-management/market-share-estimator
- Claritas — Data & segmentation: https://claritas.com/data/ · https://claritas.com/prizm-premier/
- Placer.ai — Site-selection guide: https://www.placer.ai/guides/site-selection-guide
- Frontiers in Vet Science (2022) — NAICS 541940 × AVMA method: https://www.frontiersin.org/journals/veterinary-science/articles/10.3389/fvets.2022.857644/full

**Vendor blog / secondary (named-product taxonomies & methodology):**
- Buxton — 3 types of healthcare site-selection models: https://www.buxtonco.com/blog/understanding-the-primary-types-of-healthcare-site-selection-models
- Buxton — 4 essentials of urgent-care site selection: https://www.buxtonco.com/blog/4-essentials-of-urgent-care-site-selection
- JUCM / Alan Ayers — Successful site selection in urgent care: https://www.jucm.com/successful-site-selection-urgent-care/
- GrowthFactor — Market saturation & trade area: https://www.growthfactor.ai/resources/blog/market-saturation-analysis-trade-area
- SiteZeus — Healthcare: https://sitezeus.com/solutions/industry/healthcare/

**Financial / market context (secondary — treat figures as directional):**
- First Page Sage — Vet practice EBITDA multiples: https://firstpagesage.com/business/veterinary-practice-ebitda-valuation-multiples/
- Bank of America — Location for first veterinary clinic: https://business.bankofamerica.com/en/resources/location-for-first-veterinary-clinic
- TransitionsElite — Vet practice consolidators / PE pricing: https://transitionselite.com/veterinary-practice-consolidators/

*Research method: 5 search angles → 21 sources fetched → 91 claims extracted → 25 verified by 3-vote adversarial check → 22 confirmed, 3 refuted, synthesized to 13 findings.*

---

## Part 5 — Financial hurdles, build economics, labor supply & deal stack

> **✓ Verified (2026-06-24).** All 25 Part-5 claims were independently fact-checked by a 3-vote adversarial pass — **25/25 CONFIRMED unanimously (3-0)**, 0 refuted, 0 uncertain. Verifiers fetched each cited source (including extracting the AAVMC PDF) and cross-checked figures against authoritative sources. Tags below: **[Gov/Assoc]** = primary government/association data; **[Secondary]** = broker/trade analysis; **[Analog/Dated]** = adjacent-sector and/or older. The few precision caveats the verifiers raised are folded inline.

### A. Financial hurdles & unit economics

**Honest headline: even this targeted pass did NOT surface explicit IRR / cash-on-cash / payback hurdles or revenue-per-DVM thresholds for named vet PE firms.** Those numbers appear to be genuinely unpublished. What's available is the *valuation environment* the go/no-go gate is built around:

- **Vet EBITDA multiples, 2024:** typically **8×–13×** *for larger / specialty / corporate-acquired practices*; contracted from a **2021–22 peak of ~10×–18×**. ⚠️ *Verifier nuance:* this range is **not** universal — small independent practices ($500K–1M EBITDA) sell closer to **~5.3×**, and most individual/SBA-financed buyers land around **4×–7×**. The 8–13× band specifically reflects the PE/corporate end of the market (i.e., your competitive set). **[Secondary** — TransitionsElite]
- **Size-graduated vet multiples (Q1 2025):** ~5.3× ($500K–1M EBITDA) → ~8.6× ($1–5M) → ~11.3× ($5–10M); **specialty tops out ~13.2×**. **[Secondary** — First Page Sage; same single-source decimals flagged in Part 4]
- **Dental DSO analog (clean scale premium):** add-on tuck-ins (1–3 locations) **5–8×**; platforms (5+ doctors, multi-site) **9–11×+**. Buyer offers spread **40%+** for the same practice, and deals often include a **retained-equity rollover** stake for the seller. **[Secondary/Analog** — Focus Bankers]

**Takeaway:** the gate is anchored to *EBITDA × a size-scaled multiple*, not a published IRR hurdle. Scale is rewarded disproportionately — which is *why* consolidators roll up and build to density rather than buy one-offs.

### B. Real estate & build economics

- **Vet de novo build cost: ~$225–$350 / sq ft** for a new freestanding hospital — *shell/construction only, excludes medical equipment* (veterinary architect Wayne Usiak / BDA Architecture, ~2016 so likely higher now with inflation). **[Secondary/Dated** — dvm360]
- **Occupancy cost** is tracked as a **rent-to-revenue ratio** — the standard metric in vet real estate (vs. a flat $/sqft). **[Secondary** — TerraMed]
- **Urgent-care analog build economics** (UCAOA, *2012 — dated but structurally useful*): base rent **$18–24/sqft**, CAM **$4–8/sqft**, build-out **$70–90/sqft**; typical facility **3,500–4,000 sqft**, **5–7 exam rooms**, ~2 procedure rooms; parking **5–6 spaces per 1,000 sqft**. **[Analog/Dated** — Ayers/UCAOA]
- **Urgent-care trade area** (analog): **3–5 miles or 12–15 min drive time**; 3-mile population density benchmarked **High >85,000 / Medium 45,000–85,000 / Low <45,000**. **[Analog/Dated** — Ayers/UCAOA] — *a concrete density-tier scheme you could adapt for VetMetric's scoring bands.*

### C. DVM / veterinary labor supply (a real siting constraint — but the "shortage" is contested)

This is the most important *nuance* in Part 5: **the two authorities disagree on whether there's a shortage at all.**

- **AAVMC (vet colleges association) — shortage view:** projects a **~17,166 veterinarian shortfall through 2032** (need 70,092 vs ~52,926 projected graduates ≈ 76% of need); stresses the shortage is **geographically uneven** — small-metro/rural far less served than large urban. Vet unemployment is very low (~0.7–1.8%). **[Gov/Assoc]** ⚠️ *Important standing caveat:* AAVMC has since **withdrawn this report pending review** of its demographic-shift assumptions. The figures above are quoted accurately, but the report's authority is now contested — which actually *reinforces* how unsettled the "shortage" question is.
- **AVMA (via Brakke Consulting) — no-shortage view:** concludes existing US vet-college output is **likely enough to meet demand through 2035**, and **directly disputes** the widely-cited **Mars Veterinary Health "55,000 more vets by 2030"** projection as ignoring supply-demand economics. **[Gov/Assoc]**
- **BLS (Occupational Outlook):** **86,400** vet jobs (2024); median wage **$125,510** (May 2024); employment projected **+10% 2024–2034**; **~3,000 openings/year**. **[Gov]**

**What's actionable regardless of the shortage debate:** *geographic unevenness is real.* Whether or not there's a national shortfall, vet labor is not uniformly distributed, so **local DVM availability is a genuine site-selection constraint** — most operators treat it as a weighted factor (and sometimes a hard gate in rural markets where you simply can't staff). The data pipeline to model it: **BLS OES** (state/metro vet employment & wages), **AAVMC/AVMA workforce** data, and **proximity to the ~33 US vet schools** as a supply proxy.

### D. Deal-sourcing & tech stack (named tools)

- **Deal origination / sourcing:** **Grata** (private-company search & origination for PE) and **SourceScrub** (private-company target data) — which integrates into **DealCloud** (the deal/relationship CRM standard for PE/corp-dev). *Note: SourceScrub was acquired by Grata, consolidating two of these — a sign the sourcing-data layer is itself consolidating.* **[Secondary]**
- **Vet-specific market intelligence — direct VetMetric comparables (watch these closely):**
  - **"Terminal" by The Bird Bath** — a newly launched **veterinary market-intelligence platform + practice database**. **[Blog/PR]**
  - **veterinaryanalytics.com** — veterinary analytics provider. **[Primary]**
  - These are the closest existing products to what VetMetric is building — worth a competitive teardown (what data, what price, what they *don't* do — e.g., do they have the zoning-aware site gate you just built?).
- **PIMS (practice management systems)** like ezyVet / Cornerstone hold the transaction-level data that would feed a Buxton "Forecasting"-tier model — relevant to the upgrade path in Part 3.

### Updated implications for VetMetric (from Part 5)

1. **You have named competitors now** — *Terminal* (The Bird Bath) and *veterinaryanalytics.com*. Do a teardown. Your differentiators to probe: live PE-vs-independent density, the zoning-aware Evaluate gate, and transparent user-controlled weights.
2. **Add a DVM-labor layer.** It's a real, under-served siting factor; geographic unevenness is the actionable signal even amid the shortage debate. Feasible from BLS OES + vet-school proximity.
3. **Occupancy cost (rent-to-revenue) is the real-estate metric of record** — a candidate input if you extend toward unit-economics.
4. **The urgent-care density tiers** (3-mi pop: >85k high / 45–85k med / <45k low) are a ready-made template for labeling VetMetric's demand bands in language buyers recognize.
5. **No public IRR/payback hurdle exists to reverse-engineer** — so VetMetric's value is in the *screening and site-scoring* layer (top of funnel), not in replacing the investment committee's returns model. Position accordingly.

### Sources (Part 5 — unverified)

**Primary (gov/association — reliable):** BLS Occupational Outlook (veterinarians) https://www.bls.gov/ooh/healthcare/veterinarians.htm · AAVMC Demand & Supply to 2032 https://www.aavmc.org/wp-content/uploads/2024/06/Demand-for-and-Supply-of-Veterinarians-in-the-U.S.-to-2032-New.pdf · AVMA "No dire shortage" https://www.avma.org/news/no-dire-shortage-veterinarians-anticipated-coming-years · veterinaryanalytics.com

**Secondary / trade (directional):** First Page Sage (vet EBITDA) · TransitionsElite (vet multiples) https://transitionselite.com/what-is-ebitda/ · Focus Bankers (dental DSO) https://focusbankers.com/dental-practice-ebitda/ · dvm360 (vet build cost) https://www.dvm360.com/view/how-much-money-do-you-need-build-your-veterinary-hospital · TerraMed (vet rent metric) · SourceScrub/DealCloud https://www.sourcescrub.com/post/sourcescrub-and-dealcloud-data-partnership-integration · Grata https://grata.com/solutions/private-equity

**Analog / dated:** Ayers/UCAOA urgent-care site-selection factors (2012–13) · financialmodelslab / projectionhub (clinic startup costs) · thesqftgroup (dental build-out)

**Vet market-intelligence comparables:** "Terminal" by The Bird Bath https://www.prnewswire.com/news-releases/the-bird-bath-launches-terminal-a-new-veterinary-market-intelligence-platform-and-practice-database-302748740.html

*Research method (Part 5): 6 search angles → 28 sources fetched → 116 claims extracted. Initial fact-check aborted on a rate limit; **re-run 2026-06-24 with 25 claims × 3 adversarial verifiers (75 checks) → 25/25 confirmed unanimously**, sources fetched directly. Findings are independently verified.*
