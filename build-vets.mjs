#!/usr/bin/env node
// build-vets.mjs — crawl each clinic's website to extract the VETERINARIANS ON STAFF
// (count + names; best-effort vet-school + grad-year). Two-step: homepage → "Our Doctors/Team" page.
// Runs over ALL clinics with a website (PE + independent). Local Node 18+ (global fetch). No API keys, no cost.
//
//   node build-vets.mjs                  # every clinic with a website (statewide)
//   node build-vets.mjs --region=dfw     # DFW metroplex bbox only
//   node build-vets.mjs --limit=50       # quick test on the first 50
//   node build-vets.mjs --concurrency=10 # parallel fetches (default 8)
//   node build-vets.mjs --render         # ALSO render JS team pages (Wix/React) via a headless browser —
//                                         #   needs `npm i playwright && npx playwright install chromium` (free, local).
//                                         #   Graceful: falls back to static-only if Playwright isn't installed.
//
// Output → vet-staff.js:
//   window.VET_STAFF = { "<round(lat*1000)>_<round(lon*1000)>": {n, vets:[names], years?, schools?, src} }
// The app loads it via <script src="vet-staff.js"> and looks clinics up by nearest cell.
// Heuristic extraction — eyeball a --limit run before trusting a full crawl.

import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const REGION = args.region;
const LIMIT  = args.limit ? +args.limit : Infinity;
const CONC   = args.concurrency ? +args.concurrency : 8;
const OUT    = args.out || 'vet-staff.js';
const TIMEOUT = 12000;
const UA = 'Mozilla/5.0 (compatible; VetricBot/1.0; +https://vetfinder.pages.dev)';
const DFW = { s: 32.2, n: 33.5, w: -97.95, e: -96.2 };

// ---- load clinics from vet-clinics.js (rindex skips the comment line) ----
const raw = fs.readFileSync('vet-clinics.js', 'utf8');
const i = raw.lastIndexOf('window.VET_CLINICS'), j = raw.indexOf('[', i), k = raw.lastIndexOf(']');
const all = JSON.parse(raw.slice(j, k + 1));
let clinics = all.filter(c => c.web);
if (REGION === 'dfw') clinics = clinics.filter(c => c.lat >= DFW.s && c.lat <= DFW.n && c.lon >= DFW.w && c.lon <= DFW.e);
if (args.name) clinics = clinics.filter(c => (c.name || '').toLowerCase().includes(String(args.name).toLowerCase())); // --name=<substr> test mode
clinics = clinics.slice(0, LIMIT);
console.log(`Crawling ${clinics.length} clinics (of ${all.length} total · ${all.filter(c => c.web).length} have a website)…\n`);

const key = c => `${Math.round(c.lat * 1000)}_${Math.round(c.lon * 1000)}`;

const VET_SCHOOLS = ['Texas A&M', 'Texas Tech', 'Oklahoma State', 'Kansas State', 'Colorado State', 'Louisiana State', 'LSU',
  'Mississippi State', 'Auburn', 'Tuskegee', 'Purdue', 'Cornell', 'UC Davis', 'University of California, Davis', 'Ohio State',
  'Michigan State', 'University of Illinois', 'University of Missouri', 'University of Minnesota', 'University of Georgia',
  'North Carolina State', 'University of Florida', 'University of Tennessee', 'University of Wisconsin', 'Washington State',
  'Oregon State', 'Iowa State', 'Virginia-Maryland', 'Tufts', 'University of Pennsylvania', 'Western University',
  'Lincoln Memorial', 'Midwestern', 'Ross University', 'St. George', 'St. Matthew', 'St. Matthews'];

const stripTags = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#0?39;|&rsquo;|&apos;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();

async function get(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: ac.signal });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct && !/html|text/.test(ct)) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

// rank candidate "team/doctors" pages by link text + href
function teamLinks(html, baseUrl) {
  const out = []; const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const href = m[1], txt = stripTags(m[2]).toLowerCase(), hl = href.toLowerCase();
    let score = 0;
    if (/our[- ]?(doctor|vet)|meet[- ]?(the |our )?(team|doctor|vet)|veterinarians?\b/.test(txt)) score = 5;
    else if (/\bdoctors?\b|\bveterinarian/.test(txt) || /doctor|veterinarian|our-?team|meet-the/.test(hl)) score = 4;
    else if (/\b(our )?team\b|\bstaff\b/.test(txt) || /\/(team|staff|doctors|vets)\b/.test(hl)) score = 3;
    else if (/about\s*us?/.test(txt) || /\/about/.test(hl)) score = 1;
    if (score > 0) { try { out.push({ url: new URL(href, baseUrl).href, score }); } catch {} }
  }
  const byU = new Map();
  for (const l of out) if (!byU.has(l.url) || byU.get(l.url).score < l.score) byU.set(l.url, l);
  return [...byU.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

const STOP = new Set(('the our your new pet pets dog cat animal animals veterinary veterinarian veterinarians medicine '
  + 'medical hospital hospitals clinic clinics care center centre emergency wellness family small large north south east west '
  + 'home about contact services service team staff doctor doctors review reviews monday tuesday wednesday thursday friday '
  + 'saturday sunday welcome appointment read more view meet owner owners founder founded associate associates hours location '
  + 'locations surgery surgical dental exotic graduated graduate graduating born after before since joined joining earned '
  + 'received attended completed practice practicing university college school dvm vmd dabvp dacvim ms bs ba phd dr us usa '
  + 'states state texas member members guest column partner partners also both has had was were her his their she he they '
  + 'community are and of in at to with for from this that here when where what who how new york county city area best top '
  + 'cares loves enjoys husband wife children dogs cats horses years year experience board certified american '
  + 'special specialty specialties interests procedures culture dvms primary chief technician technicians assistant assistants '
  + 'manager managers receptionist kennel groomer grooming intern interns resident').split(/\s+/));

// build a clean "First Last" from up to 3 captured words (drop middle initial, credentials, junk)
function cleanName(words) {
  const core = words.filter(w => w && !/^(dvm|vmd|d\.?v\.?m\.?|dabvp|dacvim|ms|bs|ba|phd|dr|doctor)$/i.test(w));
  if (core.length < 2) return null;
  const first = core[0], last = core[core.length - 1];
  for (const w of [first, last]) {
    const lw = w.toLowerCase().replace(/[^a-z'’-]/g, '');
    if (lw.length < 2 || STOP.has(lw) || !/[a-z]/.test(w)) return null;   // reject stopwords / all-caps / junk
  }
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  return cap(first) + ' ' + cap(last);
}

function extractVets(text) {
  const NW = "(?!Dr\\b)[A-Z][A-Za-z'’-]*[a-z][A-Za-z'’-]*";   // a name word — caps start, has a lowercase letter, and is NEVER the title "Dr" (stops teaser merges like "Dr. McCall Dr. Scott McCall" → was producing "Mccall Scott")
  const MI = "(?:[A-Z]\\.?\\s+)?";                            // optional middle initial ("Kelly M. Watson")
  const CRED = "(?:DVM|D\\.?V\\.?M\\.?|VMD)";
  const seen = new Map();                                     // lowercased "first last" -> display name (dedups "Name" vs "Name DVM")
  const lasts = new Set();                                    // surnames already covered by a FULL name (so we don't double-count)
  const add = (a, b) => { const n = cleanName([a, b].filter(Boolean)); if (n) { const k = n.toLowerCase(); if (!seen.has(k)) { seen.set(k, n); lasts.add(n.split(' ')[1].toLowerCase().replace(/[^a-z'’-]/g, '')); } } };
  let m;
  const reA = new RegExp(`\\bDr\\.?\\s+(${NW})\\s+${MI}(${NW})`, 'g');                          // Dr. First [M.] Last
  while ((m = reA.exec(text))) add(m[1], m[2]);
  const reB = new RegExp(`\\b(${NW})\\s+${MI}(${NW}),?\\s+${CRED}\\b`, 'g');                    // First [M.] Last, DVM
  while ((m = reB.exec(text))) add(m[1], m[2]);

  // SURNAME-ONLY doctors — last-name-only headings ("Dr. Howard") + single-name credentials ("Folsom, DVM").
  // Guards: a "Dr. <Surname>" must appear >=2x (a heading + at least one bio mention) so a one-off reference to
  // some other doctor doesn't count; a credentialed "<Surname> DVM" counts on first sight. De-duped against the
  // full-name surnames in `lasts` so the same person isn't counted twice.
  const SUR_STOP = new Set('pepper seuss strange phil drive street road avenue lane court circle trail parkway place highway suite google facebook'.split(' '));
  const okSur = w => { const lw = w.toLowerCase().replace(/[^a-z'’-]/g, ''); return lw.length >= 3 && !STOP.has(lw) && !SUR_STOP.has(lw) && !lasts.has(lw); };
  const surDisp = new Map(), drCount = new Map(), credSur = new Set();
  // NOTE the `(?![A-Za-z'’-])` after each captured name: it forces the name to a FULL-WORD boundary so the NW
  // can't backtrack to a prefix ("Courtney"→"Courtne", "Gary"→"Gar") when the trailing lookahead would otherwise let it.
  const poss = w => w.replace(/['’]s$/, '');                                                     // strip a trailing possessive ("Hutchinson's" → "Hutchinson")
  const reC = new RegExp(`\\bDr\\.?\\s+(${NW})(?![A-Za-z'’-])(?!\\s+${NW})`, 'g');                // "Dr. Surname" (complete word) not followed by another name word
  while ((m = reC.exec(text))) { const w = poss(m[1]), lw = w.toLowerCase().replace(/[^a-z'’-]/g, ''); if (okSur(w)) { drCount.set(lw, (drCount.get(lw) || 0) + 1); if (!surDisp.has(lw)) surDisp.set(lw, w.charAt(0).toUpperCase() + w.slice(1)); } }
  const reD = new RegExp(`(?:^|[^A-Za-z'’])(${NW})(?![A-Za-z'’-]),?\\s+${CRED}\\b`, 'g');          // "<Surname> DVM" — single complete name carrying a DVM credential
  while ((m = reD.exec(text))) { const w = poss(m[1]), lw = w.toLowerCase().replace(/[^a-z'’-]/g, ''); if (okSur(w)) { credSur.add(lw); if (!surDisp.has(lw)) surDisp.set(lw, w.charAt(0).toUpperCase() + w.slice(1)); } }
  const surVets = [];
  for (const [lw, disp] of surDisp) if ((drCount.get(lw) || 0) >= 2 || credSur.has(lw)) surVets.push(disp);

  const years = new Set();
  const ctx = text.toLowerCase();
  const reY = /\b(19[6-9]\d|20[0-2]\d)\b/g;
  while ((m = reY.exec(text))) {
    const y = +m[1], around = ctx.slice(Math.max(0, m.index - 45), m.index + 8);
    if (/graduat|class of|d\.?v\.?m|earned|received|veterinary degree/.test(around) && y >= 1965 && y <= 2025) years.add(y);
  }
  const schools = new Set();
  for (const s of VET_SCHOOLS) if (text.includes(s)) schools.add(s === 'LSU' ? 'Louisiana State' : s);
  return { vets: [...seen.values(), ...surVets], years: [...years].sort(), schools: [...schools] };
}

// Common team-page paths to PROBE when the discovered links come up thin — many sites bury or mislabel the
// doctors page, so guessing the conventional URLs recovers it. Cheap: 404s return fast and we stop early.
const GUESS = ['our-team', 'team', 'veterinarians', 'our-doctors', 'doctors', 'meet-the-team', 'meet-our-team', 'staff', 'our-veterinarians', 'about-us'];

// ---- optional JS rendering (headless browser) for client-rendered team pages (Wix/React/Next) ----
// Opt-in via --render; needs Playwright (`npm i playwright && npx playwright install chromium`). GRACEFUL:
// if Playwright isn't installed it logs a hint once and the crawl proceeds static-only. Used ONLY when the
// static pass found <2 vets (the suspected-JS sites), so it never slows the cases that already work.
const RENDER = !!args.render;
let _browser = null, _renderOff = false;
async function ensureBrowser() {
  if (_browser || _renderOff) return _browser;
  try { const { chromium } = await import('playwright'); _browser = await chromium.launch({ headless: true }); }
  catch { _renderOff = true; console.log('  ⚠ --render needs Playwright — run `npm i playwright && npx playwright install chromium`. Proceeding static-only.'); }
  return _browser;
}
async function renderHtml(url) {
  const b = await ensureBrowser(); if (!b) return null;
  let page = null;
  try {
    page = await b.newPage({ userAgent: UA });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(600);
    return await page.content();
  } catch { return null; } finally { if (page) try { await page.close(); } catch {} }
}

const result = {}; let done = 0, hit = 0;
async function crawl(c) {
  let url = c.web.trim(); if (!/^https?:/i.test(url)) url = 'http://' + url; url = url.split(/[?#]/)[0];
  const home = await get(url); done++;
  // Try the homepage + every plausible team page; KEEP THE PAGE WITH THE MOST VETS (don't stop at the first hit —
  // the first link is often an "about" blurb with one featured vet while the real roster is one URL over).
  let best = { vets: [], years: [], schools: [] }, bestSrc = '';
  const tried = new Set();
  const tryPage = async (u) => {
    if (!u || tried.has(u)) return; tried.add(u);
    const p = await get(u); if (!p) return;
    const ex = extractVets(stripTags(p)); if (ex.vets.length > best.vets.length) { best = ex; bestSrc = u; }
  };
  if (home) {
    tried.add(url);
    const ex = extractVets(stripTags(home)); if (ex.vets.length > best.vets.length) { best = ex; bestSrc = url; }
    for (const l of teamLinks(home, url)) { if (best.vets.length >= 6) break; await tryPage(l.url); }
    if (best.vets.length < 2) for (const g of GUESS) { if (best.vets.length >= 3) break; try { await tryPage(new URL('/' + g, url).href); } catch {} }
  }
  if (RENDER && best.vets.length < 2 && home) {           // static came up thin → the team page is probably JS-rendered
    const cands = [url, ...teamLinks(home, url).map(l => l.url), ...GUESS.map(g => { try { return new URL('/' + g, url).href; } catch { return null; } })].filter(Boolean);
    const rtried = new Set();
    for (const cu of cands) {
      if (best.vets.length >= 3 || rtried.size >= 4) break;
      if (rtried.has(cu)) continue; rtried.add(cu);
      const h = await renderHtml(cu); if (!h) continue;
      const ex = extractVets(stripTags(h)); if (ex.vets.length > best.vets.length) { best = ex; bestSrc = cu + ' (rendered)'; }
    }
  }
  // >40 "vets" on one page is almost always a multi-location group's SHARED directory (e.g. a specialty chain
  // listing every doctor across all locations), not one clinic's roster — drop it as unreliable rather than
  // tag a single location with a bogus count.
  if (best.vets.length && best.vets.length <= 40) {
    hit++;
    result[key(c)] = { n: best.vets.length, vets: best.vets, ...(best.years.length ? { years: best.years } : {}), ...(best.schools.length ? { schools: best.schools } : {}), src: bestSrc };
  }
  if (args.name) console.log(`  ${c.name}  →  n=${best.vets.length}  [${best.vets.join(', ')}]  (${bestSrc || 'no page'})`);  // --name test mode: show what was extracted
  if (done % 25 === 0 || done === clinics.length) console.log(`  ${done}/${clinics.length}  ·  ${hit} with a roster (${Math.round(100 * hit / done)}%)`);
  if (done % 400 === 0) flush(false);   // CHECKPOINT: persist progress so a late hang can't lose the whole crawl
}

// Write the result file (idempotent). Called at checkpoints AND at the very end — guarantees we never lose a
// completed crawl to a hung keep-alive socket (which previously left Node in "unfinished top-level await", exit 13).
function flush(final) {
  fs.writeFileSync(OUT,
    `// Auto-generated by build-vets.mjs — veterinarians on staff per clinic (count + names), heuristic web scrape.\n` +
    `// key = "<round(lat*1000)>_<round(lon*1000)>". value = {n: count, vets:[names], years?:[grad years], schools?:[...], src}\n` +
    `window.VET_STAFF=${JSON.stringify(result)};\n`);
  if (final) console.log(`\nDone. ${hit}/${clinics.length} clinics got a vet roster (${Math.round(100 * hit / (done || 1))}%). Wrote ${OUT} (${Object.keys(result).length} entries).`);
}

let idx = 0;
const worker = async () => { while (idx < clinics.length) await crawl(clinics[idx++]); };
// Race the crawl against a hard time cap so a stuck fetch can never strand the whole run — whatever's gathered
// by then is still written. Then flush + force-exit (lingering keep-alive sockets otherwise hang/abort the process).
let capped = false;
await Promise.race([
  Promise.all(Array.from({ length: CONC }, worker)),
  new Promise(r => setTimeout(() => { capped = true; r(); }, 100 * 60 * 1000)),   // 100-min hard cap
]);
if (capped) console.log(`\n⚠ Hard time cap reached — writing the ${Object.keys(result).length} rosters gathered so far.`);
if (_browser) { try { await _browser.close(); } catch {} }
flush(true);
process.exit(0);
