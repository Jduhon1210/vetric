#!/usr/bin/env node
/* build-services.mjs — read each clinic's website and extract the SERVICES it offers.
 * Sibling of build-species.mjs (same crawl frame: homepage + one services page, checkpointed,
 * free/local). Output: vet-services.js -> window.VET_SERVICES = { cellKey: [codes...] }.
 *
 * Codes: sx surgery · dent dentistry · brd boarding · grm grooming · dc daycare · exo exotics
 *        urg urgent/walk-in · dx in-house lab+imaging · well wellness plans · repro reproduction
 *        rehab rehab/alternative · eol end-of-life · chip microchip · house house calls
 *        tele telemedicine · vax vaccines
 * PE-lens value: brd/grm/dc = ancillary revenue; sx/dx = higher ACT capability; well = recurring
 * revenue (membership); urg = competitive moat; breadth (count) = revenue-mix proxy.
 *
 * Run: node build-services.mjs --all --concurrency=10        (statewide, ~60-90 min)
 *      node build-services.mjs --region=dfw --limit=40       (cheap test)
 * NO --render (the build-vets Playwright pass hung statewide; static-only, accepted coverage).
 */
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true]; }));
const LIMIT = args.limit ? +args.limit : (args.all ? Infinity : 80);
const REGION = args.all ? null : (args.region || 'dfw');
const CONC = args.concurrency ? +args.concurrency : 10;
const OUT = args.out || 'vet-services.js';
const CKPT = '.services-checkpoint.json';
const TIMEOUT = 12000, CLINIC_CAP = 35000;
const UA = 'Mozilla/5.0 (compatible; VetricBot/1.0; +https://vetric.co)';
const DFW = { s: 32.2, n: 33.5, w: -97.95, e: -96.2 };

const raw = fs.readFileSync('vet-clinics.js', 'utf8');
const i0 = raw.lastIndexOf('window.VET_CLINICS'), j0 = raw.indexOf('[', i0), k0 = raw.lastIndexOf(']');
const all = JSON.parse(raw.slice(j0, k0 + 1));
let clinics = all.filter(c => c.web);
if (REGION === 'dfw') clinics = clinics.filter(c => c.lat >= DFW.s && c.lat <= DFW.n && c.lon >= DFW.w && c.lon <= DFW.e);
if (args.name) clinics = clinics.filter(c => (c.name || '').toLowerCase().includes(String(args.name).toLowerCase()));
clinics = clinics.slice(0, LIMIT);
console.log(`Reading services for ${clinics.length} clinics (of ${all.filter(c => c.web).length} with websites)…\n`);

const key = c => `${Math.round(c.lat * 1000)}_${Math.round(c.lon * 1000)}`;
// Not a service: hours, phone numbers, addresses, nav/CTA noise scraped from <li> markup.
const RAW_JUNK = /\(\d{3}\)|\d{3}[\s.\-‑–]\d{3,4}[\s.\-‑–]?\d{0,4}|\d{1,2}:\d{2}\s?(a|p)\.?m|\b(am|pm) to\b|open (today|now)|closed|\b(mon|tues?|wednes|thurs?|fri|satur|sun)(day)?s?\b|hours|directions|suite \d|\bTX\b \d{5}|our (team|staff|location)|new clients?|payment|financing|careers|blog|faq|testimonial|facebook|instagram|twitter|youtube|portal|my account|online store|resources|locations?$|reviews?$|promotions?$|adoptions?$|meet the|chevron|icon|book (an )?appointment|first visit|^(our )?services$|^veterinary care$|^advanced care$|^emergency$|^shop$|english|español|^my\w+$|appointments?$|^en\b/i;
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

// One regex per service. Word-bounded; the deliberately tight ones (urg, well) avoid the
// "in case of emergency call X" / marketing-copy false positives.
const SVC = {
  sx:    /\b(surger(y|ies)|surgical|spays?|neuters?|orthopedic|tplo|cruciate|soft.?tissue)\b/i,
  dent:  /\b(dental|dentistry|teeth cleaning|prophylaxis)\b/i,
  brd:   /\b(boarding|pet hotel|lodging)\b/i,
  grm:   /\b(grooming|groomers?)\b/i,
  dc:    /\b(day\s?care|doggy day)\b/i,
  exo:   /\b(exotics?|avian|reptiles?|pocket pets?|ferrets?)\b/i,
  urg:   /\b(urgent care|walk.?ins? (are )?welcome|same.?day (appointments?|care|sick))\b/i,
  dx:    /\b(in.?house lab(oratory)?|x.?rays?|radiographs?|radiology|ultrasound|diagnostics?)\b/i,
  well:  /\b(wellness plans?|care plans?|preventive plans?|puppy plans?|kitten plans?|memberships?)\b/i,
  repro: /\b(reproducti(on|ve)|breeding services|artificial insemination|semen)\b/i,
  rehab: /\b(rehabilitation|physical therapy|hydrotherapy|acupuncture|laser therapy|chiropractic)\b/i,
  eol:   /\b(euthanasia|end.?of.?life|hospice)\b/i,
  chip:  /\bmicrochip/i,
  house: /\b(house calls?|mobile veterinary|we come to you)\b/i,
  tele:  /\b(telemedicine|telehealth|virtual (visits?|care|consults?))\b/i,
  vax:   /\b(vaccinations?|vaccines?|immunizations?)\b/i,
  pharm: /\b(in.?house pharmacy|online pharmacy|fully.?stocked pharmacy)\b/i,
  behav: /\b(behavior(al)? (consult|counsel|medicine|training)|training classes|obedience)\b/i,
  nutr:  /\b(nutrition(al)? (counsel|consult)|weight management|prescription diets?)\b/i,
  senior:/\b(senior (pet )?care|geriatric)\b/i,
  crem:  /\b(cremation|aftercare|memorial)\b/i,
  allergy:/\b(allerg(y|ies) testing|allergy treatment|dermatolog)\b/i,
  endo:  /\b(endoscop)/i,
  regen: /\b(stem.?cell|platelet.?rich|prp therapy|regenerative)\b/i
};
const extract = text => Object.keys(SVC).filter(c => SVC[c].test(text));

// services links are the primary target here (unlike species, where the homepage usually decides)
function serviceLinks(html, baseUrl) {
  const out = []; const seen = new Set();
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && out.length < 2) {
    const txt = stripTags(m[2]).toLowerCase(), hl = m[1].toLowerCase();
    if (/^(our )?services?$|veterinary services|what we (do|offer)|services & pricing/.test(txt.trim()) || /\/(our-)?services?\b|veterinary-services/.test(hl)) {
      try { const u = new URL(m[1], baseUrl).href; if (!seen.has(u)) { seen.add(u); out.push(u); } } catch {}
    }
  }
  return out;
}

// Verbatim service-list capture: the clinic's own words, from list items and headings on the
// services page. Complete where the taxonomy is selective; display-only, and later a mining
// corpus for growing the taxonomy from evidence.
function rawServiceItems(html) {
  const items = new Set();
  const grab = re => { let m; while ((m = re.exec(html)) && items.size < 30) {
    const t = stripTags(m[1]).replace(/\s+/g, ' ').trim();
    if (t.length >= 4 && t.length <= 60 && !/cookie|privacy|copyright|sign|login|menu|home|contact|about|read more|learn more|click|schedule|request|call us|follow|©/i.test(t) && !RAW_JUNK.test(t)) items.add(t);
  } };
  grab(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  grab(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi);
  return [...items];
}
async function readClinic(c) {
  let url = c.web; if (!/^https?:/i.test(url)) url = 'https://' + url;
  const home = await get(url);
  if (!home) return { svc: null, via: 'unreachable' };
  let text = stripTags(home).slice(0, 60000);
  const links = serviceLinks(home, url);
  let via = 'home', rawItems = [];
  if (!links.length) {
    for (const guess of ['/services', '/our-services']) {
      try { const g = await get(new URL(guess, url).href); if (g) { text += ' ' + stripTags(g).slice(0, 60000); rawItems = rawServiceItems(g); via = 'home+probe'; break; } } catch {}
    }
  } else {
    for (const l of links) { const svc = await get(l); if (svc) { text += ' ' + stripTags(svc).slice(0, 60000); if (!rawItems.length) rawItems = rawServiceItems(svc); via = 'home+services'; } }
  }
  const codes = extract(text);
  if (!codes.length && !rawItems.length) return { svc: null, via };
  const r = { svc: codes.length ? codes : null, via };
  if (rawItems.length) r.raw = rawItems.slice(0, 24);
  return r;
}

// ---- checkpointed run ----
let ck = fs.existsSync(CKPT) ? JSON.parse(fs.readFileSync(CKPT, 'utf8')) : {};
const result = {};
const pack = v => { const o = {}; if (v.svc) o.c = v.svc; if (v.raw) { const r = v.raw.filter(x => !RAW_JUNK.test(x)); if (r.length) o.r = r; } return (o.c || o.r) ? o : null; };
for (const [k, v] of Object.entries(ck)) { const o = v && pack(v); if (o) result[k] = o; }
let done = 0, hit = Object.keys(result).length;
function flush() {
  const body = '// Auto-generated by build-services.mjs — services offered per clinic (website-read).\n' +
    '// key = "<round(lat*1000)>_<round(lon*1000)>". value = array of service codes:\n' +
    '// value = {c:[category codes], r:[the clinic\'s own service-list items, verbatim]}.\n' +
    '// codes: sx dent brd grm dc exo urg dx well repro rehab eol chip house tele vax pharm behav nutr senior crem allergy endo regen\n' +
    'window.VET_SERVICES=' + JSON.stringify(result) + ';\n';
  fs.writeFileSync(OUT + '.tmp', body); fs.renameSync(OUT + '.tmp', OUT);
  fs.writeFileSync(CKPT + '.tmp', JSON.stringify(ck)); fs.renameSync(CKPT + '.tmp', CKPT);
}

const queue = clinics.filter(c => !(key(c) in ck));
console.log(`checkpoint: ${Object.keys(ck).length} already done, ${queue.length} to fetch\n`);
async function worker() {
  for (;;) {
    const c = queue.shift(); if (!c) return;
    const r = await Promise.race([readClinic(c), new Promise(res => setTimeout(() => res({ svc: null, via: 'timeout' }), CLINIC_CAP))]);
    ck[key(c)] = r;
    const packed = pack(r); if (packed) { result[key(c)] = packed; hit++; }
    done++;
    if (done % 25 === 0) { flush(); console.log(`  ${done}/${queue.length + done} · ${hit} with services (${(100 * hit / (Object.keys(ck).length)).toFixed(0)}%)`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
flush();
const dist = {};
for (const v of Object.values(result)) for (const c of (v.c || [])) dist[c] = (dist[c] || 0) + 1;
console.log(`\ndone: ${Object.keys(result).length} clinics with services read`);
console.log('service counts:', JSON.stringify(dist));
process.exit(0);
