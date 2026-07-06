# Vetric — 5-Minute Demo Video Script

**Audience:** PE corp-dev / real-estate teams, regional group owners, potential design partners.
**Arc:** the industry's own funnel — *screen the market → score the site → check the parcel* — told in their language.
**Golden rule:** never say a data-source name or a formula on camera. Say what it tells them, not where it came from.

---

## Shot-by-shot script

> Spoken lines are suggestions — say them your way. The **click path** is the part to rehearse until it's muscle memory.

### 0:00 – 0:25 · Cold open — the problem (Map tab, DFW at city zoom)

**On screen:** Map tab, zoomed to Frisco/Plano area. Pins visible (navy = independent, red = PE). Hover slowly.

**Say:**
> "If you're building or buying vet clinics, the two questions that matter are *where's the next market* and *is this specific site any good.* This is Vetric — every veterinary clinic in Texas, live, with corporate-owned in red and independents in navy. Watch how fast we can go from 'the whole metroplex' to 'this exact parcel.'"

**Move:** click one PE pin → popup shows photo, rating, owner, "N veterinarians on staff." One beat:
> "We know who owns every clinic — and how many doctors work in it."

### 0:25 – 1:40 · Market screen (Opportunity → List)

**On screen:** click **Opportunity**. (Pre-warmed → loads instantly; panel covers full canvas.)

**Say:**
> "Step one: screen the market. Every ZIP in Dallas–Fort Worth, ranked on four factors — income, pet demand, competition, growth. The default weighting mirrors the published industry standard — competition carries a third of the score — and the sliders are your thesis, not a black box."

**Move:** click the **High-growth** preset → list visibly re-ranks → click **Industry standard** to restore.
> "Change your thesis, the ranking answers instantly."

**Move:** expand the **#1 ZIP** (click the row). Walk the card top to bottom with the cursor:
> "Here's the demand walk for the number-one market: households… dog- and cat-owning households… roughly seventeen thousand vet visits a year of demand… enough to sustain about eight full-time doctors. And the tool tells you what kind of market it is —" *(point at the verdict line)* "— whitespace, balanced, or a hub that's already serving its neighbors."

**Point at the Commercial fabric line:**
> "It even tells you whether there's anywhere to *build* — this one has thirty-six commercial nodes. A wealthy ZIP with zero vets and no retail land isn't whitespace; it's a bedroom community. Vetric knows the difference."

### 1:40 – 2:50 · Site scoring (Surface)

**Move:** click **Surface** toggle. ("Scoring ~10,000 one-mile sites…" flashes, honeycomb paints over the live map.)

**Say:**
> "Step two: inside the market, where exactly? We score roughly ten thousand one-mile sites across the metroplex — demand a new clinic could actually *capture*, given every existing competitor around it. Darker green, stronger site."

**Move:** click **Emerging** filter chip.
> "Filter to emerging areas — fast-growing corridors where the rooftops are arriving ahead of the vets."

**Move:** click your **rehearsed top spot** (see checklist — pick one whose card reads "Commercial corridor at this spot"). Card opens, area zooms.
> "This spot: ten thousand dog households in the trade area, thirty-some-thousand visits of demand, a new clinic captures the overwhelming share — enough for a multi-doctor hospital, not a solo shop."

### 2:50 – 4:00 · Parcel check (Evaluate)

**Move:** click **"Evaluate this spot →"** on the hex card. Staged loader runs (~10–20s — talk over it):

> "Now it gets granular. It's pulling zoning, parcels, retail corridors, and traffic for this exact area — because a great market with no commercial land is a pass."

**When sites render:**
> "Three recommended sites — and here's the part nobody else does: these are gated to *commercial* land. City zoning, county parcels. It will never recommend the middle of a subdivision. Blue dots are independent competitors, red are corporate — sized by how strong they are. The whole ZIP gets a letter grade for saturation."

**Move:** click a site pin → popup. Then click **"◔ 10-min drive area"** → isochrone draws:
> "And the real catchment — ten minutes' drive — with every competitor inside it counted."

**Move:** click **✕ Hide drive area**. Clean.

### 4:00 – 4:35 · Buy-side + the leave-behind (Acquisitions, fast)

**Move:** click **Acquisitions** tab.
> "Same engine, buy-side: every independent clinic ranked as a target — *whitespace* plays where you'd be first, *tuck-ins* near platforms you already own, review volume as a proxy for how busy they are."

**Move:** click **Export** on any list (or flash the Watchlist).
> "Everything exports. We feed your underwriting model — we don't pretend to replace it."

### 4:35 – 5:00 · Close + CTA (back to Map, statewide zoom-out)

**Say:**
> "What you just saw runs on three assets nobody else has assembled: the ownership map of every Texas clinic, doctor headcounts inside them, and zoning-aware site screening. It's live for Texas today — and any metro you care about can be online in days."
>
> "Here's my offer: send me one market you're actually looking at, and I'll screen it live with your team in thirty minutes. My contact's below."

**End card (title slide):** Vetric logo · your name · email/phone · "Send me a market — I'll screen it live."

---

## Pre-flight checklist (do ALL of these before recording)

1. **Record against the deployed site** (vetfinder.pages.dev) — Street View photos in popups only work there.
2. **Warm every cache:** open the Opportunity tab once (DFW), enter Surface once, run one Evaluate — *then* record. Do **not** clear the browser/localStorage between rehearsal and take.
3. **Rehearse the exact Surface hex** you'll click. Pick a Top Spot whose card says **"Commercial corridor at this spot"** (or nearest ≤ 0.5 mi) — those reliably yield Evaluate sites. Have a second known-good hex as backup. A rural hex can legitimately return "no sites" — that's the worst possible beat on camera.
4. **Surface stays in DFW** (other regions have no lake outlines). The List can tour other metros; if you show the region picker, open each region once beforehand.
5. **15-minute landing-frame pass:** default entry → top-10 list → expand #1 → Surface top spots → one hex card → Evaluate. Confirm every close-up label reads clean. No "Loading…" in any shot.
6. **Browser hygiene:** 1920×1080 window, 100% zoom, bookmarks bar hidden, notifications off (Do Not Disturb), no other tabs visible.
7. **Numbers change with live data** — say numbers the *screen* shows, or keep phrasing loose ("roughly," "about") so narration never contradicts the pixels.

## Recording setup (keep it simple)

- **Tool:** QuickTime screen recording is fine; Screen Studio (~$90) if you want automatic zoom-on-click polish; Loom if you want a face bubble + instant share link.
- **Audio matters more than video:** any USB or earbud mic in a quiet room beats laptop mic. Record narration *while* driving the app — it sounds natural; re-record a sentence by re-taking that section rather than chasing one perfect take.
- **Pace:** slower than feels natural. Pause a full second after each click so the viewer's eye catches up.
- **Delivery:** unlisted link (Loom/YouTube unlisted/Vimeo) — a link plays instantly; an attachment gets filtered.

## If they ask… (scripted answers)

- **"Is this drive-time based?"** → "Trade areas are radius-based today with drive-time on individual sites — full drive-time catchments are the next engineering item."
- **"Can it project revenue / IRR?"** → "We feed your underwriting model, we don't replace it — every input exports. Revenue forecasting is exactly what the founding-partner tier unlocks with portfolio data."
- **"What about cannibalization vs our own clinics?"** → "Load your clinic list and the same capture engine flags trade-area overlap above 25% — that's the benchmark tier."
- **"Where's the data from?"** → "Public demographic and geographic sources plus two proprietary datasets we build and maintain ourselves — the ownership registry and the doctor rosters. Happy to walk through methodology under NDA."
- **"Other states?"** → "The pipeline is metro-agnostic — Texas is live, any new metro is days, not months."
