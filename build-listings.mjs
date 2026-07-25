#!/usr/bin/env node
// build-listings.mjs — Vetric listed-properties engine (Option B, 2026-07-25)
//
// Pulls the State of Texas Industrial & Commercial Sites and Buildings database
// (texassitesearch.com — the state's free public site-selection service, powered by GIS Planning /
// ZoomProspector) into tx-listings.json for the "Listed properties" map layer. These ARE listings
// (sale/lease; broker- and EDC-submitted), unlike dfw-land.json's off-market owner-of-record parcels.
//
// Same data any visitor's browser downloads on page load; we keep minimal fields + a deep link back
// to the listing (?p={SiteID}) with attribution — the click-through is the value exchange.
// Detail endpoints were probed and are consistently sparse for imported listings (broker/price live
// in the source systems), so the list call is the whole pull: 3 pages of 500, ~5s total.
//
// Run: node build-listings.mjs      Then bump the ?v= on the tx-listings.json fetch in index.html.

import { writeFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VetricListings/1.0 (contact: jondduhon@gmail.com)';
const API = 'https://www.texassitesearch.com/api/properties';
const PAGE = 500;

function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const SESSION = guid();

// Mirror of the site's own search POST (captured 2026-07-25) — the server returns 0 rows if the
// body is trimmed, so keep the full field set and GUID-shaped SessionID/RequestID.
function body(start, end) {
  return JSON.stringify({
    includeAllMarkerInfo: true, SortDirection: true, MaxSize: null, ExternalID: null,
    Keywords: '', RequestID: guid(), ZipCode: '', lang: 'en', page: 1, PropertyType: '',
    PolyPoints: '', PropertyID: null, SessionID: SESSION, GeoEntityList: '', DateAdded: null,
    MinSize: null, StartRowID: start, InputParameters: null, BrokerID: null, Address: null,
    SortBy: 'featured', SubsetToken: 'texas', Attributes: null, IsFeatured: null,
    EndRowID: end, RegionsList: '', subsetid: '9F92566B-D3D6-4AE7-B345-AA5B0BF069EE',
    IsBuilding: null, pUnits: PAGE, attributes: '',
  });
}

async function fetchPage(start, end, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: 'https://www.texassitesearch.com/' },
        body: body(start, end),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, 1200 * (i + 1)));
    }
  }
}

const rows = [];
let total = null;
for (let start = 1; total === null || start <= total; start += PAGE) {
  const d = await fetchPage(start, start + PAGE - 1);
  total = d.Count ?? total ?? 0;
  const rs = d.results || [];
  console.log(`rows ${start}-${start + rs.length - 1} of ${total}`);
  for (const r of rs) {
    if (!r.Active || !r.Approved || r.Lat == null || r.Lng == null) continue;
    rows.push({
      id: r.SiteID,
      n: (r.Name || r.Street1 || '').trim().slice(0, 80),
      st: (r.Street1 || '').trim().slice(0, 70),
      ct: r.CityName || '', co: (r.CountyName || '').replace(/ County$/i, ''), zip: r.ZIPCode || '',
      la: Math.round(r.Lat * 1e5) / 1e5, lo: Math.round(r.Lng * 1e5) / 1e5,
      bldg: r.IsBuilding ? 1 : 0,
      smin: r.MinSize || null, smax: r.MaxSize || null,
      t: r.SiteTypes || '', sub: r.SubTypes || '',
      ph: r.Photo || null,
      mod: (r.DateModified || '').slice(0, 10) || null,
    });
  }
  if (!rs.length) break;
  await new Promise(res => setTimeout(res, 400));
}

// dedupe by SiteID (paging-overlap safety)
const seen = new Set();
const list = rows.filter(r => !seen.has(r.id) && seen.add(r.id));
const doc = {
  v: 1, built: new Date().toISOString().slice(0, 10), n: list.length,
  credit: 'State of Texas Industrial & Commercial Sites and Buildings database (texassitesearch.com, GIS Planning) — broker/EDC-submitted listings. Deep links open the original listing.',
  list,
};
writeFileSync(new URL('./tx-listings.json', import.meta.url), JSON.stringify(doc));
const dfw = list.filter(r => ['Collin', 'Dallas', 'Denton', 'Ellis', 'Johnson', 'Kaufman', 'Parker', 'Rockwall', 'Tarrant'].includes(r.co)).length;
console.log(`wrote tx-listings.json: ${list.length} listings statewide (${dfw} in the 9-county DFW metro)`);
