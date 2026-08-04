# Veterinary practice economics — benchmarks behind the revenue/EBITDA model

*Researched 2026-07-22. Primary sources fetched directly; the AVMA 65-page and AAHA/VMG 141-page PDFs
were extracted locally rather than read via search snippet. Feeds `_practiceEcon` / `_ebitdaMargin` /
`_ebitdaMultiple` in index.html.*

## Bottom line

Three of the six inputs have solid neutral primary sources. Three **do not exist as neutral published
data** and are dominated by sell-side marketing. That split drove the model design: anchor hard on what
AVMA actually measures, and clearly label the rest as Vetric assumptions.

| Input | Data quality | Outcome |
|---|---|---|
| Revenue per FTE DVM | **Strong** — AVMA, two vintages, quartiles | `REV_PER_DVM=616667` |
| Visits per FTE DVM | **Strong** — AVMA | `DVM_VISIT_CAPACITY=3200` |
| Revenue per visit | Derived, cross-checked | `REV_PER_VISIT` ≈ $193 (never set directly) |
| EBITDA margin by size | **No neutral data exists** | Labeled Vetric model assumption |
| EBITDA multiples | **Contested ~2×** | Shipped as a band |
| Margin vs revenue curve | Mechanism documented, curve not published | Not modeled beyond size tiers |

## 1. Revenue per FTE DVM — $616,667

AVMA 2025 report (data year 2023), **companion-animal-exclusive** practices — the right peer group:

| | Q1 (25th) | **Median** | Q3 (75th) |
|---|---|---|---|
| Companion animal exclusive | $411,111 | **$616,667** | $867,901 |
| Companion animal predominant | $351,500 | $608,553 | $760,887 |
| Mixed animal | $277,500 | $416,250 | $597,396 |

Data year 2024 (2025 Practice Owners Survey): average gross revenue per FTE veterinarian **$554,982**,
$288 per vet-hour, ~$1.5M average practice revenue, 2.76 FTE vets/practice, $538 revenue per sq ft.

**AVMA's own framing: $554,982 is down in inflation-adjusted terms from nearly $600,000 in 2019.** This
contradicts the common assumption that the figure rose fast post-2020 — in real terms it has fallen.

The commonly-quoted **$650k sits ~60th percentile**. Broker figures of $700–850k are aspirational targets
from consultancies selling improvement services; the 2019 Well-Managed $734,000 comes from ~100
self-selected top practices, consistent with AVMA's Q3.

## 2. Visits per FTE DVM — 3,200 sustained

| Metric | Value | Year |
|---|---|---|
| Appointment slots per full-time DVM per weekday | 13–14 | 2023 |
| Scheduled appointments completed per day | ~15 | 2024 |
| Time per patient | ~30 min | 2024 |
| Active clients per FTE vet | 1,499 (falling ~15/yr) | 2024 |

- **Theoretical max** ~3,900–5,200/yr — assumes no vacation, CE, surgery blocks or unfilled slots.
- **Realistic sustained** ~2,800–3,600/yr. Cross-check: $554,982 ÷ $288/vet-hour ⇒ ~1,927 worked hours/yr
  (≈40 hrs × 48 weeks), ~215–240 working days.

We take the sustained midpoint, **3,200**.

Dissent worth knowing: consultant Mark Opperman (VMC) holds that 1,900–2,000 *active client files* are
needed per FTE vet, versus AVMA's measured 1,499 — the gap is itself the story of the current market.

## 3. Revenue per visit — derived, ~$193

`616,667 ÷ 3,200 = $192.71`. Never set independently, so the demand and capacity ceilings cannot drift.

Cross-checks: AVMA's own $288/vet-hour at ~30 min/patient ⇒ ~$206 once non-appointment hours net out.
The research-derived band off the 2024 average was $165–185.

**The dollar-level ACT is not published in any free neutral source** — AVMA, VHMA public commentary,
iVET360 releases and Total Practice Solutions all report ACT as *percent change only*. Dollar levels sit
behind the VHMA member dashboard, the iVET360 full report and VetSuccess.

What is published (Vetsource, ~6,000 practices, Aug 2023–Aug 2024, via AVMA): **$622 average annual
revenue per patient** ($499 services + $203 product), +7% YoY, visits −2.3%, average days between visits
57.6 → 85.8 (+48%).

Consumer "average vet visit cost" figures run higher than $193 because this denominator includes tech
visits, rechecks and product-only pickups.

Industry direction across every source: **revenue growth is entirely price-led, volume is negative.**
iVET360 2025: ATC +7.5%, transaction volume −4.7%, net revenue +2.6%. Brakke/AVMA: 2025 revenue +2.5%,
visits −3%. Vetsource found **Invoices Per Patient outweighs ACT** as a revenue driver — visit frequency
beats ticket size.

## 4. EBITDA margin — no neutral data exists

**This is the most important caveat in the file.** AVMA does not publish practice profit margins at all —
verified by extracting the full 65-page 2025 report; it contains revenue, productivity, staffing and
revenue-mix data but no P&L, expense ratios, margin or EBITDA. Every size-segmented margin number in
circulation traces to M&A brokers and valuation-marketing pages.

**Neutral structural frame — AAHA/VMG Chart of Accounts** (ed. 10/1/2025), the profession's standard
financial framework:

> "Labor and related human resource costs amount to about **forty to fifty percent of revenues**."

> Drugs, professional supplies, hospital supplies, laboratory costs "contribute another **seventeen to
> twenty-five percent of revenue** cost."

Critically, **all labor including veterinarian compensation sits in the 7000 series** — the Direct Costs
group explicitly excludes wages. So 40–50% is fully-loaded labor *including DVM comp*. That leaves
**25–43%** for facility, equipment, administration, marketing and profit — the arithmetic that makes a
10–21% EBITDA band plausible.

**Published margin figures, with provenance:**

| Source | Figure | Flag |
|---|---|---|
| Business Valuation Resources, 2019 | Target 14–17%; average **11–12%** small-animal. Grading: >18% superior, 16–18% excellent, 13–15% good, 8–12% fair, <8% poor | Neutral-ish; 2019; page 403s, snippet only |
| Transitions Elite, 2026 | GP 15–22%; specialty/ER 22–30% | **INTERESTED PARTY** |
| Well-Managed Practice | "profit-to-gross 33% to 42%" | **NOT EBITDA — see below** |

⚠️ **The Well-Managed 33–42% number is a trap.** It is (a) ~100 self-selected top-performing practices
and (b) a "profit" definition *before* full owner/DVM compensation normalization. Applying an M&A
multiple to it overstates value roughly 2–3×. Expect a seller to quote it.

**Reported vs adjusted EBITDA.** The only quantification found — from an M&A broker, so a pre-diligence
claim — is that normalization "typically raises EBITDA **15 to 30 percent** above the raw P&L number."
Add-backs ranked by frequency: owner compensation above market (largest, $100–250k), family payroll,
personal vehicle/travel, one-time legal/professional fees, CE above 1–1.5% of revenue, personal
insurance, marketing above 1–2%. A buyer's Quality of Earnings review eliminates undocumented add-backs.

**Our curve** (solo 10% / 2–3 DVM 14% / 4–6 DVM 18% / 7+ 21%) sits inside the BVR neutral band and is
scaled by the documented operating-leverage mechanism. It is presented in-app as a Vetric assumption
with the derivation shown — deliberately, because a PE analyst can discredit a broker table in one search.

## 5. EBITDA multiples — contested, shipped as a band

The disagreement is not noise, it is **selection bias**: brokers report their own closed deals, which are
the larger, multi-DVM, competitively-marketed practices consolidators want.

**Neutral / low-incentive — Octus** (private-credit research, sells to lenders), 16 Jan 2026:
private practices at **mid- to high single digits** as of Q1 2025; specialty higher. Western Veterinary
Partners high-teens (~$2B EV, 325+ hospitals); Mission Pet Health $8.6B on ~$580M EBITDA ⇒ **~14.8×**
(platform scale, 750+ locations). BDC exposure $3.1B; **PetVet Care Centers debt marked at 88% of par** —
lowest among BDCs, a genuine distress signal.

**Interested parties — Ackerman Group** (vet M&A advisory): 12–15× for larger GP; SVP/MVP consolidator
merger at 17–18× (Dec 2024); market-wide 8–13× for 2023. Notably against their own interest, they report
deal terms deteriorating: cash at closing averaged 71% in Q1 2025, and only **64% of deals had 70%+ cash
upfront, down from 81% in 2024.**

**Transitions Elite** (broker; strongest sell-side bias — their thesis is "hire us to run a process"):

| Profile | Direct offer | "Competitive process" |
|---|---|---|
| Solo, owner-dependent | 4–6× | 6–8× |
| Solo with associate | 5–7× | 7–9× |
| Multi-doctor general | 5.5–7.5× | 9–12× |
| Multi-doctor with growth | 7–9× | 11–14× |
| Scaled / specialty / ER | 9–12× | 13×+ |

**Read the left column, discount the right.** The direct-offer column is broadly consistent with Octus.

**Our bands:** solo 4–6× · solo+associate 5–7× · multi-DVM GP 6.5–9.5× · large/multi-site 8.5–12×.
Trajectory: compressed ~1.5–2.5 turns off the 2021–22 peak, stabilised ~15–20% below, "a rebase, not a
collapse." Deal volume recovering in 2026 (Capstone: 18 pet-sector deals early 2026 vs 8 same window 2025).

*First Page Sage appears often in search results as a multiples source — it is an SEO content-marketing
agency, not a data provider. Do not cite it.*

## 6. Operating leverage — mechanism documented, curve not published

Clearest published illustration (Associated Veterinary Partners, a consolidator — interested party, but
the arithmetic is checkable): fair-market rent of $50,000 is **10% of revenue at $500,000 and 5% at
$1,000,000**. Their worked example: a clinic at 5% margin ($25k on $500k) that doubles revenue sees
EBITDA **quadruple to $100,000** — margin 5% → 10%.

This is why **margin and multiple both rise with size**, a double effect on enterprise value that the
model captures via the two tiered functions.

Offsetting constraint: brokers cite a labor benchmark of ~30–40% of revenue as the volatility threshold;
the neutral AAHA/VMG figure of 40–50% fully-loaded is the one to trust (the gap is likely definitional —
whether owner clinical comp is included).

Scale fragility (iVET360 2026): practices under $2.5M revenue grew 8.6% vs 6.7% overall, but averaged
~1.0 months of operating cash reserves vs 1.3 average.

**No published table of the form "practices above $2M revenue average X% margin" could be found.** If it
exists it is inside VHMA benchmarks, the Well-Managed study, or iVET360's paid report.

## Gaps that could not be closed from free sources

1. EBITDA margin segmented by DVM count — no neutral dataset; AVMA does not collect it.
2. ACT as a dollar figure — percent change only in free sources.
3. A published margin-vs-revenue operating-leverage curve.
4. The reported-vs-adjusted EBITDA gap from a *neutral* source (only broker figures exist).
5. Revenue per invoice vs per visit as distinct dollar levels.

**Closing 1–3 would take the VHMA benchmark suite + the iVET360 full report** — VHMA is a neutral
association with a real practice-manager panel; iVET360 has 1,500+ practices and no M&A incentive.
AVMA's report is excellent for revenue and productivity but structurally cannot solve the margin
problem: they don't collect P&L data.

## Sources

**Neutral primary**
- AVMA, *2025 Report on the Economic State of the Veterinary Profession* (Jan 2025, data year 2023).
  Quartile productivity p. 51, appointment slots p. 48, staffing p. 44 —
  https://ebusiness.avma.org/files/productdownloads/002_AVMA_SotPReport25_NoPasswordPRO.pdf
- AVMA News, "Benchmarking data plus elevating efficiency equals practice productivity" (2024 data;
  $554,982/FTE DVM, $288/vet-hour, 15 patients/day, $538/sq ft) —
  https://www.avma.org/news/benchmarking-data-plus-elevating-efficiency-equals-practice-productivity
- AVMA News, "Less foot traffic at veterinary practices spells declining revenue" (Vetsource, ~6,000
  practices; $622/patient/yr) —
  https://www.avma.org/news/less-foot-traffic-veterinary-practices-spells-declining-revenue
- AVMA News, "Veterinarians report increasing price sensitivity, decreasing visits" (Brakke 2025) —
  https://www.avma.org/news/veterinarians-report-increasing-price-sensitivity-decreasing-visits
- VMG/AAHA Chart of Accounts, ed. 10/1/2025 (labor 40–50%, direct costs 17–25%) —
  https://pages.aaha.org/hubfs/Chart%20of%20Accounts/VMG_AAHA-COA-Book-10-1-25.pdf
- VHMA Insiders' Insights KPI Quarterly Commentary, Oct 2025 / Apr 2025 — https://www.vhma.org

**Low-incentive commercial**
- Octus, "Private-Credit Exposure to Veterinary Rollups Shows Growing Dispersion," 16 Jan 2026 —
  https://octus.com/resources/articles/private-credit-exposure-to-veterinary-rollups-shows-growing-dispersion-vsos-under-increasing-pressure/
- iVET360 2026 Veterinary Industry Benchmark Report — https://ivet360.com/2026-veterinary-industry-benchmark-report/
- Today's Veterinary Business, "Client Visits Dropped 4% in 2024" — https://todaysveterinarybusiness.com/ivet360-report-042625/
- Vetsource, "Veterinary ACT versus visits for revenue" — https://vetsource.com/blog/veterinary-act-versus-visits-for-revenue/

**Interested parties — use with discount**
- Ackerman Group Q1 2025 Market Update — https://ackerman-group.com/owner-education/market-trends/quarterly-update/2025-q1-veterinary-industry-market-update/
- Transitions Elite, "EBITDA Benchmarks in Vet Practice Sales" (2026) — https://transitionselite.com/ebitda-benchmarks-in-vet-practice-sales/
- Associated Veterinary Partners, "Improving EBITDA at Your Veterinary Practice" — https://associatedveterinary.com/news/improving-ebitda-at-your-veterinary-practice/
- Well-Managed Practice Benchmarks Study (the 33–42% figure) — https://wellmp.com/what-is-the-benchmarks-study/

**Could not retrieve**
- Business Valuation Resources, "Six Profit Indicators to Consider When Valuing Veterinary Practices"
  (2019) — HTTP 403, snippet only. Source of the 14–17% target / 11–12% average and the grading scale.
