#!/usr/bin/env node
// build-airports.mjs — one-time builder for tx-airports.json: Texas airport GROUNDS polygons
// (OSM aeroway=aerodrome), the drop-a-site "you're on a runway" check. Same recipe as
// dfw-water.json: one Overpass pull, area-filtered, decimated, baked static — no runtime
// Overpass dependency. Local Node 18+, free. Usage: node build-airports.mjs
import fs from 'node:fs';

const BBOX = '25.6,-107.0,36.7,-93.3';                 // all of Texas
const MIN_KM2 = 0.35;                                   // keep real airports; skip grass strips
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',            // fine from Node (can send a real UA; only browser fetch is blocked)
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];
const QUERY = `[out:json][timeout:120];(way["aeroway"="aerodrome"](${BBOX});relation["aeroway"="aerodrome"](${BBOX}););out geom;`;

const ringArea = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  const la = (r.reduce((t, p) => t + p[1], 0) / r.length) * Math.PI / 180; return Math.abs(a) / 2 * 111.32 * 111.32 * Math.cos(la); };
const rnd = x => Math.round(x * 1e4) / 1e4;
function decimate(r, keep = 44) {
  if (r.length <= keep) return r.map(p => [rnd(p[0]), rnd(p[1])]);
  const step = (r.length - 1) / (keep - 1), out = [];
  for (let i = 0; i < keep; i++) out.push(r[Math.round(i * step)]);
  out[out.length - 1] = r[r.length - 1];
  return out.map(p => [rnd(p[0]), rnd(p[1])]);
}

async function fetchOSM() {
  for (let round = 0; round < 3; round++) {
    if (round) { console.log(`  backoff ${round * 45}s…`); await new Promise(r => setTimeout(r, round * 45000)); }
    for (const m of MIRRORS) {
      try {
        console.log('  trying', m);
        const r = await fetch(m, { method: 'POST', body: 'data=' + encodeURIComponent(QUERY),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'VetricBuild/1.0 (one-time airport-polygon pull; contact: vetric.co)' } });
        if (!r.ok) { console.log('   ', r.status); continue; }
        const d = await r.json();
        if (d && d.elements && d.elements.length) return d.elements;
        console.log('    empty/timeout body');
      } catch (e) { console.log('   ', e.message); }
    }
  }
  throw new Error('all mirrors failed');
}

const els = await fetchOSM();
console.log('elements:', els.length);
const rings = [];
let names = 0;
for (const el of els) {
  const name = (el.tags && (el.tags.name || el.tags.icao || el.tags.faa)) || '';
  if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
    const ring = el.geometry.map(g => [g.lon, g.lat]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
    const a = ringArea(ring);
    if (a >= MIN_KM2) { rings.push({ n: name, ring: decimate(ring) }); if (name) names++; }
  } else if (el.type === 'relation' && el.members) {
    // Outer members: keep each closed outer way as its own ring; if none are closed
    // (split outer ways), fall back to the relation's overall bounds as one rectangle —
    // for "don't site a clinic on airport grounds", the bbox is an acceptable superset.
    let kept = false;
    for (const mm of el.members) {
      if (mm.role !== 'outer' || !mm.geometry || mm.geometry.length < 4) continue;
      const ring = mm.geometry.map(g => [g.lon, g.lat]);
      if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
        const a = ringArea(ring);
        if (a >= MIN_KM2) { rings.push({ n: name, ring: decimate(ring) }); kept = true; }
      }
    }
    if (!kept && el.bounds) {
      const { minlat, minlon, maxlat, maxlon } = el.bounds;
      const rect = [[minlon, minlat], [maxlon, minlat], [maxlon, maxlat], [minlon, maxlat], [minlon, minlat]];
      if (ringArea(rect) >= MIN_KM2) rings.push({ n: name, ring: rect.map(p => [rnd(p[0]), rnd(p[1])]) });
    }
    if (name) names++;
  }
}
console.log('kept rings:', rings.length);
const out = { note: 'TX airport grounds (OSM aeroway=aerodrome, >=0.35 km2), rings as [lon,lat]. Built by build-airports.mjs.', list: rings };
fs.writeFileSync('tx-airports.json', JSON.stringify(out));
console.log(`Wrote tx-airports.json (${(fs.statSync('tx-airports.json').size / 1024).toFixed(0)} KB)`);
// sanity: DFW + Love Field + Alliance must be present
for (const [label, la, lo] of [['DFW Intl', 32.8990, -97.0403], ['Love Field', 32.8471, -96.8518], ['Alliance', 32.9880, -97.3188]]) {
  const hit = rings.some(({ ring }) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > la) !== (ring[j][1] > la) && lo < (ring[j][0] - ring[i][0]) * (la - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
    }
    return inside;
  });
  console.log(` ${hit ? '✓' : '✗'} ${label}`);
}
