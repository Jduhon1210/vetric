#!/usr/bin/env node
// build-tracts.mjs — one-time builder for dfw-tracts.json: DFW-region census TRACT boundaries
// (Census TIGERweb, server-generalized) with 2024 ACS 5-yr demographics embedded per tract.
// Tracts are the "community" grain (~4k people — a neighborhood / subdivision / master-planned
// community), fixing the ZIP-grain blind spot where a 7,200-home 55+ community (Robson Ranch)
// disappears into a college town's median age. Free: TIGERweb + api.census.gov, no keys beyond
// the app's existing public Census key. Local Node 18+. Usage: node build-tracts.mjs
import fs from 'node:fs';

const DFW = { w:-97.95, s:32.25, e:-96.20, n:33.50 };          // same region box as DFW_BOUNDS
const KEY = '3429f2401376a586a8f6ffc02bb5678ee32fbf44';
const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query';
const OUT = 'dfw-tracts.json';

async function jget(url){
  for(let a=0;a<3;a++){
    try{ const r=await fetch(url,{headers:{'Accept':'application/json'}}); if(r.ok) return await r.json(); }
    catch(e){}
    await new Promise(r=>setTimeout(r,1200));
  }
  throw new Error('fetch failed: '+url.slice(0,120));
}

// ---- 1) tract boundaries for the DFW envelope (paged; server-side generalization) ----
async function fetchGeom(){
  const feats=[]; let offset=0;
  for(;;){
    const u=`${TIGER}?where=1%3D1&geometry=${DFW.w},${DFW.s},${DFW.e},${DFW.n}`+
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`+
      `&outFields=GEOID&returnGeometry=true&maxAllowableOffset=0.0004&outSR=4326&f=geojson`+
      `&resultOffset=${offset}&resultRecordCount=500`;
    const d=await jget(u);
    const f=(d&&d.features)||[];
    feats.push(...f);
    process.stdout.write(`  boundaries: ${feats.length}\r`);
    if(f.length<500) break;
    offset+=500;
  }
  console.log(`\n  total tract boundaries: ${feats.length}`);
  return feats;
}

// ---- 2) ACS 2024 5-yr demographics for every TX tract (one call, filter later) ----
// income, households, owner-occupancy, single-family share, built-2010+, median age, population
async function fetchACS(){
  const vars='B19013_001E,B11001_001E,B25003_001E,B25003_002E,B25024_001E,B25024_002E,B25034_001E,B25034_002E,B25034_003E,B01002_001E,B01003_001E';
  const u=`https://api.census.gov/data/2024/acs/acs5?get=${vars}&for=tract:*&in=state:48&in=county:*&key=${KEY}`;
  const rows=await jget(u);
  const hdr=rows[0], out=new Map();
  for(const r of rows.slice(1)){
    const o=Object.fromEntries(hdr.map((h,i)=>[h,r[i]]));
    const g='48'+o.county+o.tract;
    const num=v=>{ const x=parseFloat(v); return (isFinite(x)&&x>-1e6)?x:null; };  // ACS sentinels are large negatives
    const inc=num(o.B19013_001E), hh=num(o.B11001_001E), occT=num(o.B25003_001E), own=num(o.B25003_002E);
    const unT=num(o.B25024_001E), sf=num(o.B25024_002E);
    const cT=num(o.B25034_001E), c1=num(o.B25034_002E), c2=num(o.B25034_003E);
    const age=num(o.B01002_001E), pop=num(o.B01003_001E);
    out.set(g,{
      inc: inc!=null&&inc>0?Math.round(inc):null,
      hh: hh!=null?Math.round(hh):null,
      own: (occT>0&&own!=null)?+(own/occT).toFixed(3):null,
      sf: (unT>0&&sf!=null)?+(sf/unT).toFixed(3):null,
      cons: (cT>0&&c1!=null&&c2!=null)?+((c1+c2)/cT).toFixed(3):null,
      age: (age!=null&&age>10&&age<95)?age:null,
      pop: pop!=null?Math.round(pop):null,
    });
  }
  console.log(`  ACS tract rows (TX): ${out.size}`);
  return out;
}

const rnd=x=>Math.round(x*1e5)/1e5;
function roundGeom(geom){
  const doRing=ring=>ring.map(p=>[rnd(p[0]),rnd(p[1])]);
  if(geom.type==='Polygon') return {type:'Polygon',coordinates:geom.coordinates.map(doRing)};
  if(geom.type==='MultiPolygon') return {type:'MultiPolygon',coordinates:geom.coordinates.map(poly=>poly.map(doRing))};
  return geom;
}

(async function main(){
  console.log('Fetching DFW tract boundaries (TIGERweb)…');
  const feats=await fetchGeom();
  console.log('Fetching ACS 2024 tract demographics…');
  const acs=await fetchACS();
  let joined=0, skipped=0;
  const out=[];
  for(const f of feats){
    const g=f.properties&&f.properties.GEOID;
    if(!g){ skipped++; continue; }
    const d=acs.get(g);
    if(!d){ skipped++; continue; }                        // no ACS row (rare: water-only tracts)
    joined++;
    out.push({type:'Feature',properties:{g,...d},geometry:roundGeom(f.geometry)});
  }
  const fc={type:'FeatureCollection',vintage:'ACS 2024 5yr · TIGERweb 2020 tracts · DFW box',features:out};
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const kb=Math.round(fs.statSync(OUT).size/1024);
  console.log(`\nWrote ${OUT}: ${joined} tracts joined (${skipped} skipped), ${kb} KB`);
  // sanity anchors
  const near=(la,lo)=>{ // crude: centroid distance
    let best=null,bd=1e9;
    for(const f of out){ const c=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];
      let sx=0,sy=0; for(const p of c){sx+=p[0];sy+=p[1];} const cx=sx/c.length, cy=sy/c.length;
      const d=Math.hypot(cx-lo,cy-la); if(d<bd){bd=d;best=f;} }
    return best;
  };
  for(const [name,la,lo] of [['Robson Ranch (Denton 55+)',33.1706,-97.2016],['Lantana',33.0946,-97.1214],['Sun City-ish? (out of box)',30.7,-97.75],['Uptown Dallas',32.8020,-96.8010]]){
    const f=near(la,lo);
    if(f) console.log(`  ${name}: tract ${f.properties.g} · age ${f.properties.age} · inc $${f.properties.inc} · own ${f.properties.own} · cons ${f.properties.cons}`);
  }
})();
