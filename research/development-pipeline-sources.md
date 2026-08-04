# DFW development-pipeline data sources — verified inventory (2026-07-22)

*Six parallel research tracks, everything marked VERIFIED was live-fetched 2026-07-22. This is the
source-of-truth inventory behind the development-intelligence build ("I want this data all across DFW
no matter how small... type of pads being leased, when, anyone committed, how many houses, when done,
median price"). Companion: `research/vet-practice-economics.md` (same-day EBITDA research),
`research/mpc-sweep-2026-07-14.md` (the manual sweep this pipeline replaces).*

## The stack (answer-per-effort order)

| # | Source | Answers | Effort | Status |
|---|---|---|---|---|
| 1 | **NCTCOG Developments layer** | how many homes/units, where, who, status — region-wide | LOW | VERIFIED, CORS→vetric.co |
| 2 | **TDLR TABS** | commercial timing + committed tenants + pre-opening competitors | LOW | VERIFIED, stateless |
| 3 | **Comptroller sales-tax outlets** | tenant actually open (any category, incl. vet NAICS) | LOW | VERIFIED, weekly |
| 4 | **TABC pending applications** | restaurant tenants 1–4 mo early | LOW | VERIFIED, daily |
| 5 | **Fort Worth COs / Arlington permits / McKinney planning** | finaled-CO tenant names; earliest site-plan pipeline | LOW | VERIFIED, live |
| 6 | **Collin CAD Socrata** (`vffy-snc6` + permits `82ee-gbj5`) | delivery pace + appraised values, daily | LOW | VERIFIED |
| 7 | **School-district demographic PDFs** (~12 districts, quarterly) | lots + build pace + phase dates + price ranges per subdivision | MED (curation) | VERIFIED content |
| 8 | **TCEQ WaterDistricts + SPDPID CSVs + PID SAPs** | earliest rooftop signal (new MUD) + lot-type pricing | LOW–MED | VERIFIED |
| 9 | **Census BPS place files** | permits-by-city monthly trend (zero-scrape fallback) | LOW | VERIFIED |
| 10 | **Edge Realty all-properties report** | one brokerage's geocoded lease inventory | LOW | VERIFIED, permitted |

Hard walls (final): **closing prices** — Texas non-disclosure, never public, asking ranges only.
**Suite-level vacancy + asking rents** — broker/CoStar territory; deep-links remain the pattern.
**Brokerage flyers** — not an automated source (see §E). **EMMA, Zillow/Redfin/NewHomeSource listings** —
ToS-banned, never automate.

---

## 1. NCTCOG Development Monitoring — THE regional pipeline layer ⭐

- Endpoint: `https://geospatial.nctcog.org/map/rest/services/Features/Features/MapServer/1` (point grain)
- Bulk: `https://data-nctcoggis.hub.arcgis.com/api/download/v1/items/9111035e117b4f61a5409a37c0faa743/csv?layers=1` (7.6 MB CSV, 26,171 records); residential pipeline alone = one 355 KB GeoJSON query
- **26,157 records · 1,740 forward pipeline** (883 Under Construction / 597 Announced / 260 Conceptual)
- Residential pipeline: **1,200 projects / 578,680 units** (SF 639 proj/411,731 u; MF 539/162,929). Commercial 9,080 records (Retail/Office/Industrial/Lodging subclasses)
- Fields: `Name, Class, SubClass, City, Zip, DevStatus, DevType, Units, Doors, Acreage, SqFeet, Developer (59% of resid pipeline), StartDate, Completed, IsMixedUse, Source, SourceDate, LastEdited` + point geometry
- **Freshness: 1,429/1,740 pipeline records LastEdited in 2026** — continuously maintained (newspapers, developer sites, cities, CADs per their methodology PDF)
- Validated: every dfw-mpc.json MPC present at PHASE granularity (Painted Tree = 15 phases; Legacy Hills 7,000u/Centurion American; Windsong 3,500/Terra Verde). Denser + more current than our 35 curated entries.
- Top pipeline cities by units: Fort Worth 60,786 · **Celina 44,045** · Dallas 41,725 · Denton 33,558 · McKinney 28,154. Announced+UC: Celina 40,447 / Princeton 21,511 / Anna 12,929.
- License: **"no use constraints"**, credit line requested ("Data from the North Central Texas Council of Governments…"). CORS echoes `https://vetric.co`. Free, no key. `f=geojson` native.
- ⚠️ Sibling `SUBDIVISIONS (2023)` layer (`Boundaries/Boundaries/MapServer/4`, native `LOTS` field, 4,486 active+proposed subs / 708,931 lots) is **© all-rights-reserved + 2023-vintage — display-only reference, do NOT ship it**.
- Limits: no per-project buildout curve (pace comes from permits/school studies); opportunistic not permit-complete.
- Also free at NCTCOG: annual city population estimates, housing-unit counts (SF/MF 2020 vs 2026), **2050 TAZ-grain forecast** (5,252 zones — a forward sub-ZIP growth vector). No raw permit dataset exists at NCTCOG (confirmed).

## 2. TDLR TABS — statewide commercial registrations ⭐

Every commercial construction/renovation **≥$50k** must register before construction. Statewide, one
format. **Next-day currency** (verified: record registered 7/20 visible 7/21).

- De facto API: `POST https://www.tdlr.texas.gov/TABS/Search/SearchProjects` (DataTables protocol, form-encoded). **No cookies/CSRF/keys.** 100 rows/page cap, `recordsTotal` returned.
- Filters: `ProjectName, ProjectNumber, ProjectStatus, DateBegin/DateEnd` (**estimated-completion window — forward-looking**), `RegistrationDateBegin/End, OwnerName, FacilityName, ArchitectName, LocationAddress, LocationCity, LocationCounty` (coded), `RASNumber`
- County codes: Collin **2043**, Dallas **2057**, Denton **2061**, Tarrant **2220**, Rockwall 2199, Ellis 2070, Johnson 2126, Kaufman 2129, Parker 2184, Wise 2249, Hunt 2116, Hood 2111
- Row fields: ProjectNumber/Name, CreatedOn, Status (3008 Registered, 3009 Review Complete, 3001 Inspection Completed, 3007 Closed), FacilityName, City/County coded, TypeOfWork (9001 New / 9002 Reno / 9003 Addition), **EstimatedCost, EstimatedStartDate, EstimatedEndDate**
- Detail: `GET /TABS/Search/Print/<ProjectNumber>` — clean dt/dd HTML incl. **Owner + TENANT NAME + phone**, design firm, RAS
- Verified example: TABS2026025702 "DONUT SUPREME", Shops at Trinity Falls McKinney, 2,300 sf finish-out, $90k, start 8/1/2026 done 10/1/2026, owner + tenant named
- Verified patterns: `FacilityName=TRINITY FALLS` → the center's committed-tenant pipeline (7 projects: McDonald's, nail bar, eyecare, $4M retail bldg, $13.5M Del Webb amenity). `ProjectName=SHELL` Collin 12mo → 23 shell buildings = **future leasable space**; `RETAIL` → 51 more. Completion-window Denton 12mo → 112 dated projects.
- **Vet early-warning (verified): CITYVET (MELISSA) $667k new construction delivering 10/30/2026; Chewy Vet Care – The Mix; CityVet Providence Village / Grand Prairie / West 7th; Greenlight Vet Arlington — visible MONTHS pre-opening**
- Volume: core DFW ≈ **8,100 projects/yr** (Collin 1,770 / Dallas 2,708 / Denton 990 / Tarrant 2,072 / Rockwall 153 / Ellis 196 / Johnson 103 / Parker 101). Nightly sync = ~8 county list calls + detail fetch per new record.
- Legality: public records (TX PIA); robots.txt does not restrict /TABS/; no anti-automation ToS. Modest rate + identify ourselves.
- Caveats: dates/costs are applicant estimates (slippage real — corroborate with COs); addresses free-text (Census geocoder failed 0/3 — use Nominatim or city+name match); <$50k invisible. No bulk download; PIA request possible for historical backfill.

## 3. Comptroller Active Sales Tax Permit Holders — "actually open" feed ⭐

- `https://data.texas.gov/resource/jrea-zgmq.json` (Socrata SODA, free, no key; app token lifts throttle)
- Every TX business outlet: **NAICS code, outlet street address, permit-issue date, first-sales date**. ~Weekly (verified 7/18).
- New-outlet velocity 2026 YTD: Plano 1,121 · McKinney 886 · Frisco 879 · Prosper 257 · Celina 186
- **`outlet_naics_code='541940'` = statewide weekly VET-OPENING feed** — verified surfacing Painted Tree Veterinary Hospital (McKinney, first sales 6/1/2026) + 14th Street Animal Hospital & Urgent Care (Plano, 6/3/2026)

## 4. TABC — restaurant-tenant early warning

- Pending originals: `https://data.texas.gov/resource/mxm5-tdpj.json` — daily; owner, license type, status, submission date, **full premises address**, county. Live DFW: Dallas 90 / Tarrant 70 / Denton 27 / Collin 23.
- Issued: `7hf9-qc9f` (trade name, owner, address, issue date). Bonus: `naix-2893` mixed-beverage **monthly gross receipts per location** — free center-vitality proxy.
- Lead time: median pending age 15 days; operators file 1–3 mo pre-opening → **~1–4 months early warning**. Use as confirmation + catch for <$50k finish-outs TABS misses.

## 5. City permit / CO / planning feeds (the live ones)

| City | Endpoint | Gives | Freshness |
|---|---|---|---|
| **Fort Worth COs** ⭐ | `https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Certificates_of_Occupancy_Table_view/FeatureServer/0` | 71,617 COs: **Occupant (tenant!)**, ProjectName, CODate, Status(Finaled), JobUse, addr+unit, lat/lon | 7/21/2026 |
| **Arlington** | `https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1` (issued) + `/9` (applications) | 18,937: NameofBusiness, issue/final dates, MainUse, valuation, XY | 7/21/2026 |
| **McKinney planning** | `https://maps.mckinneytexas.org/mckinney/rest/services/OpenData/Planning_Zoning/MapServer/0` | 4,417 case polygons: SP/PP/FP/Z/SUP, status, submittal+approval dates, descriptive names ("Site Plan for Fuel Station (7-Eleven)") | live 2026 |
| **McKinney permits** | `https://services1.arcgis.com/B8MwidgHpU2dWUmv/arcgis/rest/services/ADR_2025/FeatureServer/6` | 1,647 resid permits w/ **Subdivision**: Painted Tree 635 avg $358k / Trinity Falls 203 | annual report |
| **Anna** | `Residential_Permits_2023/FeatureServer/0` + `Residential_Subdivisions` (buildout flag + CAD plat-PDF links) | per-address: **Builder**, Subdivision, Lot/Block, SqFt, Date | verified |
| **Melissa** | `https://services3.arcgis.com/GJeZXOPygZAo5bHm/arcgis/rest/services/Development_Information/FeatureServer/40` | DevelopmentType, PlatType, **plat/site-plan PDF links** | verified |
| **Allen** | `https://gismaps.cityofallen.org/arcgis/rest/services/CommunityDevelopment/Current_Development_Projects/FeatureServer/0` | **77 live projects**: name, developer, land use, stage, P&Z + council dates, polygon (probed directly, pre-agents) | live |
| **Plano** | `https://maps.planogis.org/arcgiswad/rest/services/DevelopmentReview/DevelomentProjectsTrakIt2/MapServer/1` | TrakIt export: PROJECT_NAME/TYPE/SUBTYPE, APPLIED/APPROVED dates, OWNER_NAME (probed directly) | live |
| **Celina** | `https://services1.arcgis.com/x4nhme9V33KOzAfr/arcgis/rest/services/Celina_Developments/FeatureServer/0` | 75 subdivision polys w/ **Lots**: Legacy Hills 6,900, Green Meadows 4,900… ~31k lots | live |
| **Frisco** | `Public/External_Major_Development_Site_Plans/MapServer` (site-plan polys; also `mapcache…/Layers_External/MapServer/73` Active Building Permits — unreachable in test, retry) | site plans | partial |
| **Collin Co EnerGov** | `energov_history/MapServer` | plat + resid-dev cases w/ ApplicationDate — **unincorporated/ETJ only**, thin (≥2024-11), names mostly blank | live |
| **Dallas** | Socrata permits `e7gq-4sah` / COs `9qet-qt9e` / food `dri5-wcct` | **DEAD — end 8/2020, 11/2022, 2/2024. TABS carries Dallas.** | dead |
| Irving | `Commercial_Permits_Issued_2_15_22_Present` | ~17 mo stale | marginal |
| Denton Co | `DEV_Permits/MapServer/0` | 56,500 county permits (septic/culvert flavor) | exurb-only |

Robots note: Arlington GIS robots allows generic agents (`Content-Signal: search=yes, ai-train=no`),
blocks named AI-crawler UAs — a product backend under its own UA is within the allow; no AI-training use.

## 6. Collin CAD — daily parcel + permit APIs ⭐

- `https://data.texas.gov/resource/vffy-snc6.json` — **479,360 rows, daily**: `yr_blt (imprvyearbuilt), abs_subdv_des, curr_market, living_area, percent_compl`. Verified: `$where=imprvyearbuilt>=2024` → live 2024–25 construction w/ subdivision + value.
- Companion permits: `82ee-gbj5` (builder, type, date).
- **Lot counts = count CAD parcels per subdivision** (validated: Auburndale Ph 1 plat says 125 resid + 3 HOA lots; name-LIKE query returns exactly **128**, avg $392,680).
- Other CADs: Denton public GIS `YR_BLT` stops 2019 (use nightly bulk zip); Dallas GIS has **no** yr-built/value (bulk `DCAD2026_CURRENT.ZIP` ~184 MB, scripted downloads blessed); **Tarrant = the obstruction** (current data Cloudflare-403 at tad.org — manual quarterly refresh).

## 7. School-district demographic studies — best "how many + when + price" per subdivision ⭐

Zonda/Templeton, PASA, Cooperative Strategies quarterly board decks, public PDFs, clean text (pypdf, no OCR):
- **Little Elm ISD Winter 2026** (verified): per-subdivision — *Valencia on the Lake: 1,654 total lots · 122 vacant developed · 1,234 occupied · **100–150 homes/yr · $425K–$765K***. Plus a DFW-wide ISD ranking table (Celina ISD: 1,649 starts / 1,772 closings / 6,155 VDL / **32,774 future lots**).
- **Princeton ISD Winter 2026** (verified): explicit phase delivery dates ("Ph 3 (264 lots) delivered fall 2025, Ph 5 (420) end 2025").
- **Northwest ISD**: stable crawlable archive 2017→2026 (`nisdtx.org/departments/facilities/demographic-reports`).
- Weakness = DISCOVERY not content: finalsite CDN hash URLs; **BoardDocs 403s bots**. Pattern: hand-curated ~12-district URL list, quarterly re-poll (curation job like dfw-mpc.json). Target districts: Prosper, Celina, Melissa, Anna, Princeton, Little Elm, Northwest, Denton, McKinney, Frisco, Rockwall, Forney.

## 8. Special districts — the earliest rooftop signal

- **TCEQ WaterDistricts**: `https://gisweb.tceq.texas.gov/arcgis/rest/services/Public/WaterDistricts/MapServer/0` — 434 districts in DFW bbox, `CREATION_DATE` + `COGO_ACRES`. **A new 250-ac MUD ≈ ~1,000 future homes, months before permits.** 10 newest DFW MUDs all 2025–26, Collin-heavy. (MUDs only; PIDs not here.)
- **Comptroller SPDPID bulk CSVs**: `https://assets.comptroller.texas.gov/open-data-files/spdpid-entity.csv` (8 MB, 21,686 rows) + `spdpid-individual-debt.csv` (per-bond principal/maturity/purpose + **proceeds spent/unspent = build-progress proxy**). No auth. 2,817 districts in 2026. (The Socrata mirror is login-gated — use the CSVs.)
- **PID Service & Assessment Plans** (city CivicPlus DocumentCenter + MuniCap CDN `website-media.com/municap-inc/…`, both robots-permitted): verified Mosaic PID Celina — "**~1,470 SF units + 210 townhomes + 336 MF**", phase breakout, **lot-type price table (70' $798,000 / 60' $670,000 / 50' $633,000 / 40' $468,000)**; Annual Service Plan Updates carry dated "Status of Development" tables. MEDIUM (PDF parse, consistent MuniCap template). **Never follow SAP links back to EMMA.**
- **EMMA: DO NOT AUTOMATE** — robots blocks all PDFs; user agreement bans scraping and even OCR. Same docs live free on city sites.

## 9. Census BPS + context prices

- BPS place files: `https://www2.census.gov/econ/bps/Place/South Region/so{YYMM}c.txt` (CSV; c=month, y=YTD, r=cumulative; county: `County/co{YYMM}c.txt`). Verified May 2026: DFW CBSA 19100 = 3,744 SF + 1,330 MF(5+) units across 192 places (Celina 218, Princeton 92, FW 724). FY2025: 39,230 SF + 24,213 MF. ~6–7 wk lag, 17th workday. **No JSON API — files only.** Counts not names; some imputed.
- TRERC repackages BPS (83.8 MB bulk zip, +2 days). HUD SOCDS = same data, no advantage.
- **Redfin Data Center** (separate from the scrape-banned site): open S3, e.g. `zip_code_market_tracker.tsv000.gz` (1.55 GB, MEDIAN_SALE_PRICE/HOMES_SOLD/NEW_LISTINGS by ZIP, updated 6/2026). **Zillow Research** (`Allow: /research/`): `files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_…csv` (122 MB ZHVI). Area price LEVELS, not per-subdivision.
- **Builder pages are automation-legal** (verified: Highland fully-open robots, Perry/Weekley block only search URLs; no anti-scrape ToS): Highland Cambridge Crossing served "from the $530s" + spec prices in **static HTML via curl**. No lot counts/phase dates on builder pages (verified-negative). Most others JS-rendered → per-builder work; price+inventory only.
- **ToS-BANNED (never automate): NewHomeSource** ("You will not conduct automated queries (including screen and database scraping, spiders, robots, crawlers…)"), **Redfin listings** (§2.3.5), **Zillow listings** (robots-blocked; API dead; Bridge = MLS-gated).

## E. Brokerage flyers — manual/deep-link only (audited)

Six firms audited (Weitzman, SRS, Venture, Edge, The Retail Connection, Shop Companies):
- **Weitzman + SRS: Cloudflare-blocked** (403 incl. robots.txt itself) — bypassing = bot evasion, off-limits.
- **The Retail Connection: ToS §11(i) explicitly bans** "spider, crawl, or scrape" + no-reproduction clause + Crawl-delay 3.
- **Venture: no-reproduction/derivative-works clause** (fetch OK, reuse prohibited). Flyers best-structured — suite-level availability WITH dates ("Suite 8304 — Available Q1 2027") as text.
- **Edge + Shop: no ToS page exists** (verified 404s on all candidate paths), open robots — permissible by omission.
- **Edge Realty `/all-properties-report/`** ⭐ — deliberate public HTML table, in their own sitemap: ~694 TX properties (Market/Name/Disposition/Agents/City/**lat/lon**/flyer link/dates), 511 flyer PDFs. **The one defensible automated pull** — low rate, attribution.
- Universal catch: **site plans + tenant logos are raster images with no text layer** (Shop's site-plan PDF: 13 pp, 0 extractable chars). Parseable text = availability SF, demographics, traffic — which we already model.
- Aggregators are no backdoor (second audit confirmed): **CREXi's only API is INBOUND** — "a 1-way data sync that allows qualifying organizations to push their listings onto Crexi.com," partner-gated; no outbound API or bulk export exists at CREXi, LoopNet, Brevitas, or Biproxi. LoopNet/CoStar ToS prohibit "any data mining, gathering or extraction tool, or any robot, spider…" and CoStar litigates it hard (CREXi damages trial pending; Xceligent ~$500M judgment 2019 — winning theory is copyright-over-photos + ToS breach, not CFAA). **No statewide TX commercial MLS exists** — precise phrasing: nearest analogs are Catylist-powered regional CIEs (DFW's MCDX — open to members AND non-members as a broker platform, not a public database) and voluntary marketplaces (CREXi/LoopNet/Commercial Exchange), publicly *searchable* but partial, non-authoritative, and not licensable as data. Even residential NTREIS isn't public (IDX requires membership + broker license).

## Commercial vendors (the pay tier we build against, not buy)

- **Zonda (ex-Metrostudy)**: THE lot-pipeline gold standard, DFW = #1 market (43,830 closings 2024). Enterprise, no pricing, no API. Free index is categorical only.
- **BuildCentral SingleFamilyData**: subdivisions ≥20 homes w/ counts/schedule/contacts — the literal data shape; enterprise-opaque.
- **GatherGov**: 39/40 DFW cities incl. all our exurbs; parses council/P&Z meetings into named projects; API exists but demo-gated, no pricing, city pages Cloudflare-403.
- **Shovels.ai**: real v2 API (verified OpenAPI; permits w/ `unit_count` + a `/decisions` zoning feed w/ developer names) — **from $599/mo**.
- **PermitStack**: genuinely self-serve free tier (100 req/day; $19–149/mo); 77.1M permits, 8,272 cities, ingesting daily (verified stats endpoint); `units`+lat/lng+owner+applicant. Permit-grain; DFW-exurb depth unverified — free tier is the $0 test.
- BuildZoom/Dodge/ConstructConnect/John Burns: enterprise or wrong grain. First Page Sage = SEO content, never cite.

## Per-city ArcGIS inventory (47 cities probed; 31 publish, ~21 with unit/lot data)

**The Corinth data shape is the regional norm for growth cities, not the exception.** Every "(a)" source
below answers the IDENTICAL query (`/query?where=1=1&outFields=*&f=geojson`, paginated 1,000–2,000) —
same client pattern as `DFW_ZONING_SOURCES`. No keys, no observed rate limits. One generic puller + a
registry (`{url, nameField, unitFields|proseField, statusField, dates}`) covers ~25 sources.

**Tier 1 — numeric unit/lot columns (wire first; ~90% of the growth corridor):**
| City | Endpoint | Key fields | n |
|---|---|---|---|
| **Prosper** ⭐ best in metroplex | `services8.arcgis.com/8ofMLzOrtxGP9wVQ/arcgis/rest/services/Planning/FeatureServer/3` (+/4 hist) | Proj_Name, Case_Type, Land_Use, **SF_Lots, Units**, Acreage, **Status, Stage** ("Under Construction"/"P&Z Approved"), Date_Sub, DATE_Appro, Ex/Prop_Zone | 798 |
| Celina | `services1.arcgis.com/x4nhme9V33KOzAfr/…/Subdivisions/FeatureServer/6` (+Celina_Developments/0, SubdivisionsbyDA/0 w/ **Developer**+Date+Link) | Name, Acres, **Lots**, Status, Type | 316 |
| Denton | `services.arcgis.com/9dTWrhPzuDPnUVXr/…/Active_Development_Public_View/FeatureServer/0` | PROJECT_NAME, Status, Dev_Type, **Units** (Craver Ranch MPC = 9,000) | ~232 |
| Fort Worth | `mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/PlanningDevelopment/MapServer/61` (final) + `…/Zoning_case_service/MapServer/4` (prelim) | PLAT_NAME, **R_LOTS / TOTAL_LOTS, RES_UNITS_NOT_MF**, ACRES, **DEVELOPER**, DATE_SUBMITTED, PC_STATUS | 6,493+1,018 |
| McKinney | `services1.arcgis.com/B8MwidgHpU2dWUmv/…/ADR_2023_Residential_Permits/FeatureServer/0` (+UnderConstruction/0, Submittals n=430) | PermitNumber, ProjectName, **NumberOfUnits**, SqFt, Valuation, IssueDate, **CompleteDate**, POINT_X/Y | 1,130+ |
| Midlothian | `maps.midlothian.tx.us/server/rest/services/Subdivision/FeatureServer/0` | Name, Status, **Lots, Built** (= buildout %!), Acre, Type | 397 |
| Rockwall | `gis.rockwall.com/arcgis/rest/services/Subdivisions/FeatureServer/0` | Subd_Name, **LOTS, BUILT_LOTS, VACANT_LOTS**, CON_STATUS, YEAR | 829 |
| Waxahachie | `services5.arcgis.com/akgXEW2N2FkwmHEV/…/Total_Cases_2026/FeatureServer/0` (+ActiveSubdivisionMap/0,/1) | CaseName, CaseType, **LotCount**, CaseStatus, Acreage | 76+34 |
| Melissa (MF) | `services3.arcgis.com/GJeZXOPygZAo5bHm/…/Multi_Family_Projects/FeatureServer/52` (+Development_Information/40 w/ plat PDF links) | Name, Status, **UnitsPermitted, UnitsRemaining**, TCOCOStatus | 21+117 |
| Sanger | `services8.arcgis.com/ovJOFQdikJNb2dMW/…/New_Development/FeatureServer/22` | Name, **SFUnits, MFUnits** (Lane Ranch 1,086+240) | 12 |
| Plano (infill) | `maps.planogis.org/arcgiswad/rest/services/Planning/MultifamilyHousingTypes/MapServer/5` | PROJECTNAME, STATUS, **TOTAL_APPROVED, REMAINING**, ACRES | 100 |
| Frisco | `maps.friscotexas.gov/gis/rest/services/External_Planning_and_Zoning/MapServer/9` | plats w/ **LOTS_PLATTED** | ~2,303 |
| Little Elm | `SubdivisionUp/0` via utility.arcgis.com proxy (anon-OK) | subdivision polys w/ **No_Lots** | 281 |
| Forney | `arcgisint.forneytx.gov/…/ComDev_PD_Utilization/FeatureServer/0` | PD utilization w/ **ResLot** | 8,376 |
| Grapevine (hist) | `maps5.grapevinetexas.gov/ags/rest/services/PW_DEVELOPMENT/Development/MapServer/11` | PlatName, **NumberOfLots**, Status, CouncilDate | 2,190 |
| Burleson | `gis.burlesontx.com/…/Economic_Development_Activity/FeatureServer/0` | dev activity w/ unit counts (**table, no geometry**) | — |

**Tier 2 — units in prose (one shared regex `/(\d[\d,]*)\s*(units|lots|single.?family|multi.?family)/i`):**
Princeton (`services6.arcgis.com/KL1aiRJt0tw3BM7h/…/Development_Projects/FeatureServer/6`, n=123, P&Z/CC
dates, ETJ flag) · Mansfield (`services8.arcgis.com/tUwpuhPn5EkXI11P/…/devSitesTestModAGOL/FeatureServer/0`,
n=70, units+developer in prose) · Sherman (`DevelopmentProjects_(view)/FeatureServer/0`, n=58, COMP_DATE) ·
Wylie (`EDC_Development_Projects/FeatureServer/80`, n=64) · Roanoke (n=10) · Justin
(`JustinDevelopmentProjectsAll`) · Flower Mound (`Development_Projects` + LandRecords LOTS) · Allen
(Current_Development_Projects n=77 — **Developer field**, no unit column) · Anna (Residential_Subdivisions
n=48, plat PDF links, no SF counts; MF layer has units).

**County gap-fillers (cover the no-data small towns):**
Johnson Co `services7.arcgis.com/gVohhGAlfFScDJGs/…/Development_Activity_Areas/FeatureServer/13`
(DevName, **Lots, FutureLots**, Status, n=89 — one call = Cleburne/Alvarado/Godley/Joshua) · Tarrant Co
`mapit.tarrantcounty.com/arcgis/rest/services/Transportation/Subdivision/MapServer/0` (SUBDIV, **UNITS**,
PRELIM/FINAL, PHASE, n=924 — covers Haslet) · Denton Co `Subdivisons_View/FeatureServer/0` (LotCount,
n=166 unincorporated) · Collin Co EnerGov (cases, no units) · Dallas Plats (boundaries only, n=12,808).

**No-data cities (16):** Argyle, Aubrey, Providence Village, Krum, Haslet, Royse City, Sachse,
Farmersville, Weatherford (PDF-only), Highland Village/Trophy Club/Murphy/Southlake/Keller (built out),
Cleburne/Alvarado/Godley/Joshua (→ Johnson Co). Gap-fill with Census BPS counts.

**Operational gotchas:** Waxahachie `Total_Cases_<yyyy>` + McKinney `ADR_<yyyy>_*` rename ANNUALLY —
re-probe each January. Northlake's ideal schema (`Number_of_Residential_Lots, SF_Units, MF_Units`) has
sparse fill — check before relying. Van Alstyne's layer is live but attribute-blank — skip.
**Corinth — the model city — is the one CORS-BLOCKED endpoint** (`gis-portal.cityofcorinth.com/…/MapServer/4`,
SF_LOTS+UNITS n=52): fetch server-side/at build time, not from the browser.

## Answer coverage vs the four questions

| Question | Coverage | How |
|---|---|---|
| Pads/space for lease, size | **Partial** | TABS shells + sq ft; Edge report; deep-links for suites/rents (rents not free anywhere) |
| When delivered/leased | **Good** | TABS Est. start/end (estimates); COs confirm; TABC/sales-tax date the opening |
| Committed tenants | **Best-covered** | TABS finish-outs (tenant NAMED) + TABC + sales-tax NAICS + FW/Arlington COs — 4 independent systems |
| Homes coming / when / price | **Good / Good / Asking-only** | NCTCOG units + school-study pace/phases + CAD/permits pace; price = school studies + PID lot-type tables + builder asking (closing prices legally nonexistent — non-disclosure state) |
