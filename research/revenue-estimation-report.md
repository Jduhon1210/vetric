# Estimating Per-Clinic Revenue from Observable Data — Research & Algorithm Spec

*2026-07-13. Sources verified directly against AVMA publications; deep-research harness extracted 25 claims
(verification panels hit a session limit, so the load-bearing constants below were hand-verified against the
primary sources; items marked "unverified" were not).*

## 1. Verified benchmark constants (AVMA, 2024 data unless noted)

| Metric | Value | Source |
|---|---|---|
| Revenue per FTE veterinarian | **$554,982** (down infl.-adj. from ~$600k in 2019) | AVMA Practice Owners Survey via avma.org news, verified 2026-07-13 |
| Revenue per veterinarian-hour | **$288** | same |
| Active clients per practice | 3,351 (declining ~95/yr since 2019) | same |
| Active clients per FTE DVM | 1,499 → implies **~$370/active client/yr** | same |
| Patients per DVM-day | 15 (down from 16.6 in 2021) | same |
| Revenue per square foot | **$538** | same |
| Revenue per exam room | **$444,668/yr** (avg 3,845 sq ft, 3.5 rooms → ~$1.5M avg practice) | same |
| Optimal DVM:staff ratio | 1:4 – 1:5 maximizes revenue/DVM | AVMA via avma.org news, verified 2026-07-13 |
| Avg companion practice staffing | 13.9 FTE: 2.8 DVM / 6.4 tech / 4.5 other (2023) | same |
| Hours open | 9.5 h/day, DVMs booked 7.4 h | same |
| Revenue mix | exams 23.5%, pharmacy 13.6%, lab 12.2%, vaccines 12%, surgery 11.9%, imaging 7%, dentistry 6.3% | same |

**Implication #1: our current $650k/DVM constant is ~17% above the national average — and hotter than that in
practice, because scraped website rosters are HEADCOUNT, not FTE** (part-timers inflate the roster). Recommended
base: **$555k per FTE**, with a 0.9 headcount→FTE discount on scraped rosters (disclosed assumption).

## 2. Signals that predict revenue (evidence quality varies)

- **Review volume as throughput proxy** — the canonical Luca study (HBS working paper 12-016, Yelp × Washington
  State revenue records) ties review signals to actual revenue (a one-star rating increase → 5–9% revenue for
  independents). For VOLUME (not rating): reviews accumulate roughly with client flow, making
  reviews-per-DVM-per-year a relative-scale signal *within a peer set*. Use as a bounded modifier, never a
  dollar generator. (Study verified to exist; the 5–9% figure is for rating, not volume — volume-as-throughput
  is a reasoned proxy, label it as such.)
- **Hours/days open** — capacity scaling via the verified $288/DVM-hour. A 7-day practice runs more bookable
  hours than the 9.5×~5.5 baseline.
- **Support-staff ratio** — verified 1:4–1:5 optimum; rosters only reliably capture DVMs, so usable only where
  team pages list techs (sparse). Hold for later.
- **Local income** — fee levels track local spending power (the app's own income-utilization curve is built on
  the same AVMA research family). Small, bounded effect on average transaction charge.
- **Broker cross-checks (Simmons)**: average transaction charge target >$150; 25–30 transactions/day per FTE
  DVM at ~85% doctor production. (From harness search capture; not independently re-verified.)
- **Cross-industry methodology** (Grata/SourceScrub/Apollo, unverified but consistent): headcount × industry
  revenue-per-employee is the standard external method; multi-signal beats single-signal; B2B firmographic
  data runs ~50% accuracy with headcounts ±20–40% — **wide, honest error bands are the industry norm.**

## 3. Recommended v2 algorithm (all inputs already in Vetric)

```
if kind is large-animal → no estimate (different economics)
FTE      = 0.9 × scraped DVM headcount                      (part-time discount, disclosed)
BASE     = FTE × $555,000                                    (AVMA 2024, verified)
M_sched  = days-open modifier: 7d → 1.08 · 6d → 1.03 · ≤5d → 0.96 · unknown → 1.00   [0.96–1.08]
M_reviews= percentile of (reviews ÷ DVM) among TX clinics with rosters:
           p10 → 0.85 · p50 → 1.00 · p90 → 1.15 (linear between, clamped)             [0.85–1.15]
M_income = (ZIP income ÷ $75k)^0.15, clamped                                          [0.93–1.08]
EST      = BASE × M_sched × M_reviews × M_income
BAND     = ±35%  → display "Est. revenue ~$1.8M–$3.1M (modeled)"
mixed-species → widen band to ±45%; analyst override always wins, shown as-entered
```

Why multiplicative bounded modifiers: mirrors the app's existing model design (damps/weights, never additive
buy-backs), keeps any one noisy signal from moving an estimate more than ~15%, and keeps the whole thing
explainable in one drill-down line per factor.

Secondary cross-check (display-only, drill-down): clients method = 1,499 × FTE × $370 ≈ BASE (by construction
at the mean, diverges usefully for outliers); per-exam-room method usable later if CAD building sq-ft is joined.

## 4. Validation strategy (free)

1. **Distribution sanity**: median estimate across TX rostered clinics should land near AVMA's ~$1.5M average
   practice (2.8 DVM); flag if our median drifts >20%.
2. **PPP ground truth**: ProPublica's public PPP database → payroll for named TX vet clinics → revenue ≈
   2.5× payroll floor-check on a 30-clinic hand sample.
3. **Broker listings**: practice-for-sale listings occasionally publish gross revenue + DVM count — collect
   pairs opportunistically as calibration points.
4. **Pilot feedback loop**: analyst overrides ARE ground truth — log |override − estimate| and recalibrate the
   constants when n ≥ 20.

## 5. What we deliberately do NOT adjust for (yet)

- PE vs independent (no verified revenue differential found)
- Texas-vs-national fee level (no verified state factor; income modifier partially covers metro variation)
- Google rating (compressed 4.2–4.9 range, direction verified by Luca but magnitude untransferable)
- Support-staff ratio (data too sparse in rosters today)
