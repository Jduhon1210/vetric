#!/usr/bin/env node
// build-catchments.mjs — drive-time trade areas for the DFW capture model (2026-07-26).
//
// Computes 10- and 15-minute DRIVE catchments for (a) every DFW clinic — the competition — and
// (b) a fabric-pruned candidate grid — potential sites — then intersects them so a metro run can
// answer "how many households can this corner reach, and who else already reaches them?"
//
// Routing is a LOCAL OSRM server (Docker), so there is no API cost, no request cap and no
// redistribution restriction on the output. See research/site-capture-model.md for the model.
//
//   docker run -d -p 5000:5000 --name vetric-osrm ghcr.io/project-osrm/osrm-backend \
//     osrm-routed --algorithm mld /data/dfw.osrm
//   node build-catchments.mjs                 # full build (resumes from checkpoint)
//   node build-catchments.mjs --clinics       # clinics only
//   node build-catchments.mjs --grid          # candidate grid only
//   node build-catchments.mjs --fresh         # ignore checkpoint
//
// INCREMENTAL BY DESIGN (user ask): every location's rays are checkpointed by cell key, so adding
// clinics later only costs the new ones plus the candidates whose catchment they touch — not a
// full rebuild.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m=a.match(/^--([^=]+)=?(.*)$/); return m?[m[1], m[2]===''?true:m[2]]:[a,true]; }));
const OSRM = process.env.OSRM_URL || 'http://127.0.0.1:5000';
const OUT  = path.join(HERE, 'dfw-catchments.json');
const CKPT = path.join(HERE, '.catchments-checkpoint.json');

// DFW bbox — matches VF_METRO_BOUNDS.dfw in index.html (keep in sync).
const DFW = { s:32.10, n:33.62, w:-98.15, e:-96.00 };
// 8/10/12/15 minutes. Extra thresholds are FREE — every budget is read off the SAME ray sample,
// so computing four costs exactly what computing one does. That makes calibration a runtime
// setting instead of a rebuild: OSRM uses free-flow OSM speeds (no traffic model), and if we later
// decide real conditions make 10-min behave like free-flow 8-min, the app switches which field it
// reads. Headline is 10; 15 is the full-trade-area upside. Measured equivalent radius at 10 min is
// ~3.6 mi, conservative against the 5.3-mi mean client travel distance in the industry survey.
const BUDGETS = [480, 600, 720, 900];
const RAYS = 36;                       // rays per polygon — free locally, so 2x the app's Google version
const FRACS = [0.25, 0.5, 0.75, 1.0];  // sample fractions along each ray
const GRID_MI = 1.5;                   // candidate grid spacing
const FABRIC_MI = 1.2;                 // prune: candidate must be within this of commercial fabric

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const key = (la,lo) => Math.round(la*1000)+'_'+Math.round(lo*1000);

// ── checkpoint ────────────────────────────────────────────────────────────────────────────────
let ck = { clinics:{}, grid:{} };
if(!args.fresh && fs.existsSync(CKPT)){
  try{ ck = JSON.parse(fs.readFileSync(CKPT,'utf8')) || ck; ck.clinics=ck.clinics||{}; ck.grid=ck.grid||{}; }
  catch(e){ console.warn('checkpoint unreadable — starting fresh'); }
}
function writeAtomic(p,txt){ const t=p+'.tmp'; fs.writeFileSync(t,txt); fs.renameSync(t,p); }
function saveCk(){ try{ writeAtomic(CKPT, JSON.stringify(ck)); }catch(e){} }
let _exiting=false;
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{ if(_exiting) return; _exiting=true; console.log('\n[signal] flushing checkpoint…'); saveCk(); process.exit(0); });
process.on('uncaughtException',e=>{ console.error('\n[crash]',e&&e.message); saveCk(); process.exit(1); });

// ── OSRM ──────────────────────────────────────────────────────────────────────────────────────
// One /table call per location: origin against RAYS*FRACS probe points, durations in seconds.
async function osrmTable(origin, dests){
  const coords = [[origin.lo,origin.la], ...dests.map(d=>[d.lo,d.la])].map(c=>c[0].toFixed(6)+','+c[1].toFixed(6)).join(';');
  const url = `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration`;
  for(let attempt=0; attempt<3; attempt++){
    try{
      const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),30000);
      const r=await fetch(url,{signal:ac.signal}); clearTimeout(t);
      if(!r.ok) throw new Error('osrm '+r.status);
      const j=await r.json();
      if(j.code!=='Ok') throw new Error('osrm '+j.code);
      return (j.durations && j.durations[0]) ? j.durations[0].slice(1) : null;   // drop self
    }catch(e){ if(attempt===2) throw e; await sleep(400*(attempt+1)); }
  }
  return null;
}

// Ray-sample a drive polygon for each budget in ONE table call (all budgets share the probes).
async function isochrones(la, lo){
  const maxMi = (Math.max(...BUDGETS)/60) * 0.95;    // generous upper bound on reach
  const mpdLat = 69.0, mpdLon = 69.0*Math.cos(la*Math.PI/180);
  const dests=[], meta=[];
  for(let d=0; d<RAYS; d++){
    const th = 2*Math.PI*d/RAYS;
    for(const f of FRACS){
      const dist=f*maxMi;
      dests.push({ la: la + (dist*Math.sin(th))/mpdLat, lo: lo + (dist*Math.cos(th))/mpdLon });
      meta.push({ dir:d, dist });
    }
  }
  const secs = await osrmTable({la,lo}, dests);
  if(!secs) return null;
  const out={};
  for(const budget of BUDGETS){
    const ring=[];
    for(let d=0; d<RAYS; d++){
      const idx=[]; for(let k=0;k<meta.length;k++) if(meta[k].dir===d) idx.push(k);
      idx.sort((a,b)=>meta[a].dist-meta[b].dist);
      let reach=0, lastGood=null;
      for(const k of idx){
        const s=secs[k];
        if(s==null) continue;
        if(s<=budget){ lastGood={dist:meta[k].dist,s}; reach=meta[k].dist; }
        else { // interpolate where the budget runs out between the last good probe and this one
          if(lastGood){ const fr=(budget-lastGood.s)/(s-lastGood.s); reach=lastGood.dist+fr*(meta[k].dist-lastGood.dist); }
          else reach=meta[k].dist*(budget/s);
          break;
        }
      }
      if(!(reach>0)) reach=0.2;
      const th=2*Math.PI*d/RAYS;
      ring.push([ +(la+(reach*Math.sin(th))/mpdLat).toFixed(5), +(lo+(reach*Math.cos(th))/mpdLon).toFixed(5) ]);
    }
    out[budget]=ring;
  }
  return out;
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────
function pointInRing(la, lo, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const yi=ring[i][0], xi=ring[i][1], yj=ring[j][0], xj=ring[j][1];
    if(((yi>la)!==(yj>la)) && (lo < (xj-xi)*(la-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
  }
  return inside;
}
function ringAreaMi(ring){
  const latc=ring.reduce((a,p)=>a+p[0],0)/ring.length;
  const kx=69.0*Math.cos(latc*Math.PI/180), ky=69.0;
  let a=0; for(let i=0,j=ring.length-1;i<ring.length;j=i++) a+=(ring[j][1]*kx)*(ring[i][0]*ky)-(ring[i][1]*kx)*(ring[j][0]*ky);
  return Math.abs(a/2);
}
function ringBBox(ring){
  let minLa=90,maxLa=-90,minLo=180,maxLo=-180;
  for(const [la,lo] of ring){ if(la<minLa)minLa=la; if(la>maxLa)maxLa=la; if(lo<minLo)minLo=lo; if(lo>maxLo)maxLo=lo; }
  return {minLa,maxLa,minLo,maxLo};
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────
function loadJS(file, globalName){
  const raw=fs.readFileSync(path.join(HERE,file),'utf8');
  const i=raw.lastIndexOf(globalName), j=raw.indexOf(raw[i+globalName.length]==='='?'=':'=',i);
  const start=raw.indexOf(raw.slice(j).match(/[\[{]/)[0], j);
  const end=raw.lastIndexOf(raw[start]==='['?']':'}');
  return JSON.parse(raw.slice(start,end+1));
}
function loadClinics(){
  const V=loadJS('vet-clinics.js','window.VET_CLINICS');
  let PE=[];
  try{ const p=fs.readFileSync(path.join(HERE,'pe-data.js'),'utf8'); PE=JSON.parse(p.match(/PE_COORDS\s*=\s*(\[[\s\S]*?\]);/)[1]); }catch(e){}
  const inD=(la,lo)=>la>=DFW.s&&la<=DFW.n&&lo>=DFW.w&&lo<=DFW.e;
  const out=[], seen=new Set();
  for(const c of V){ if(c.mobile||!inD(c.lat,c.lon)) continue; const k=key(c.lat,c.lon); if(seen.has(k)) continue; seen.add(k); out.push({k, la:c.lat, lo:c.lon, n:c.name, pe:0}); }
  for(const c of PE){ if(!inD(c[0],c[1])) continue; const k=key(c[0],c[1]); if(seen.has(k)) continue; seen.add(k); out.push({k, la:c[0], lo:c[1], n:c[4]||'', pe:1}); }
  return out;
}
// Candidate grid, pruned to points near commercial fabric — a candidate with no commercial
// context can never pass the siting gate, so its catchment would be wasted work.
function loadGrid(){
  const retail=JSON.parse(fs.readFileSync(path.join(HERE,'dfw-retail.json'),'utf8'));
  const bin=new Map(); const B=0.02;   // ~1.4 mi bins
  for(const [la,lo] of retail){ const k=Math.round(la/B)+'_'+Math.round(lo/B); (bin.get(k)||bin.set(k,[]).get(k)).push([la,lo]); }
  const near=(la,lo)=>{
    const a=Math.round(la/B), o=Math.round(lo/B);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){
      const arr=bin.get((a+i)+'_'+(o+j)); if(!arr) continue;
      for(const [pa,po] of arr){
        const dx=(po-lo)*69*Math.cos(la*Math.PI/180), dy=(pa-la)*69;
        if(Math.hypot(dx,dy)<=FABRIC_MI) return true;
      }
    }
    return false;
  };
  const out=[], dLa=GRID_MI/69;
  for(let la=DFW.s; la<=DFW.n; la+=dLa){
    const dLo=GRID_MI/(69*Math.cos(la*Math.PI/180));
    for(let lo=DFW.w; lo<=DFW.e; lo+=dLo){
      if(near(la,lo)) out.push({ k:key(la,lo), la:+la.toFixed(5), lo:+lo.toFixed(5) });
    }
  }
  return out;
}

// ── demand: the ZIP MIX of each ring, not the households ──────────────────────────────────────
// Deliberately we ship *which ZIPs a catchment covers and by what area fraction* rather than a
// household count. The app already owns the household + pet-ownership model (ACS households, the
// dog/cat rates, the senior-age and low-income damps, tract weighting) and it changes with user
// toggles — so recomputing it here would duplicate it and let the two drift. With the ZIP mix the
// app multiplies by its OWN figures at runtime and the model stays in one place. It also means
// this build needs no Census calls at all: it is pure geometry.
let ZIPS=null;
function loadZips(){
  if(ZIPS) return ZIPS;
  const geo=JSON.parse(fs.readFileSync(path.join(HERE,'tx-zips.json'),'utf8'));
  ZIPS=geo.features.map(f=>{
    const c=f.geometry.coordinates, rings=[];
    if(f.geometry.type==='Polygon') rings.push(c[0]); else for(const p of c) rings.push(p[0]);
    let minLa=90,maxLa=-90,minLo=180,maxLo=-180;
    for(const r of rings) for(const [lo,la] of r){ if(la<minLa)minLa=la; if(la>maxLa)maxLa=la; if(lo<minLo)minLo=lo; if(lo>maxLo)maxLo=lo; }
    // tx-zips.json carries a plain `zip` property (NOT the Census ZCTA5CE20/10 field names —
    // assuming those silently produced an empty ZIP mix on the first run).
    return { zip:f.properties.zip||f.properties.ZCTA5CE20||f.properties.ZCTA5CE10, rings, bb:{minLa,maxLa,minLo,maxLo} };
  }).filter(z=>z.zip && z.bb.maxLa>=DFW.s && z.bb.minLa<=DFW.n && z.bb.maxLo>=DFW.w && z.bb.minLo<=DFW.e);
  return ZIPS;
}
function zipAt(la,lo){
  for(const z of loadZips()){
    if(la<z.bb.minLa||la>z.bb.maxLa||lo<z.bb.minLo||lo>z.bb.maxLo) continue;
    for(const r of z.rings){
      let inside=false;
      for(let i=0,j=r.length-1;i<r.length;j=i++){
        const yi=r[i][1], xi=r[i][0], yj=r[j][1], xj=r[j][0];
        if(((yi>la)!==(yj>la)) && (lo < (xj-xi)*(la-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
      }
      if(inside) return z.zip;
    }
  }
  return null;
}
// ZIP areas (sq mi) so the app can turn "this ring covers 0.31 of 75078" into households.
const ZIPAREA={};
function zipArea(z){
  if(ZIPAREA[z]!=null) return ZIPAREA[z];
  const rec=loadZips().find(x=>x.zip===z);
  let a=0; if(rec) for(const r of rec.rings) a+=ringAreaMi(r.map(([lo,la])=>[la,lo]));
  return (ZIPAREA[z]=a);
}
// Returns [[zip, fractionOfThatZipInsideTheRing], …] — the app multiplies each by its own
// household/pet figures for that ZIP and sums.
function ringZipMix(ring){
  const bb=ringBBox(ring);
  const N=26, byZip=new Map(); let inside=0;
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){
    const la=bb.minLa+(bb.maxLa-bb.minLa)*(i+0.5)/N, lo=bb.minLo+(bb.maxLo-bb.minLo)*(j+0.5)/N;
    if(!pointInRing(la,lo,ring)) continue;
    inside++;
    const z=zipAt(la,lo); if(!z) continue;
    byZip.set(z,(byZip.get(z)||0)+1);
  }
  if(!inside) return [];
  const perSample=ringAreaMi(ring)/inside;
  const out=[];
  for(const [z,n] of byZip){
    const za=zipArea(z); if(!za) continue;
    const frac=Math.min(1,(n*perSample)/za);
    if(frac>0.005) out.push([z, +frac.toFixed(3)]);
  }
  return out.sort((a,b)=>b[1]-a[1]);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
async function computeSet(list, store, label){
  let done=0, fetched=0, t0=Date.now();
  for(const item of list){
    if(store[item.k]){ done++; continue; }
    let iso=null;
    try{ iso=await isochrones(item.la,item.lo); }
    catch(e){ console.warn(`  ! ${label} ${item.k}: ${e.message}`); }
    if(iso){
      const rec={ la:item.la, lo:item.lo };
      for(const b of BUDGETS){ rec['r'+(b/60)]=iso[b]; rec['a'+(b/60)]=+ringAreaMi(iso[b]).toFixed(1); }
      if(item.n!=null){ rec.n=item.n; rec.pe=item.pe; }
      store[item.k]=rec; fetched++;
    } else store[item.k]={ la:item.la, lo:item.lo, fail:1 };
    done++;
    if(done%25===0){
      saveCk();
      const rate=fetched/Math.max(1,(Date.now()-t0)/1000);
      const eta=Math.round((list.length-done)/Math.max(0.1,rate)/60);
      process.stdout.write(`  ${label}: ${done}/${list.length}  (${rate.toFixed(1)}/s, ~${eta}m left)\n`);
    }
  }
  saveCk();
  return done;
}

(async function main(){
  // sanity: is OSRM up?
  try{
    const r=await fetch(`${OSRM}/route/v1/driving/-96.80,32.78;-96.79,32.79?overview=false`);
    const j=await r.json();
    if(j.code!=='Ok') throw new Error(j.code);
  }catch(e){
    console.error(`OSRM not reachable at ${OSRM} — start it with:\n  docker run -d -p 5000:5000 --name vetric-osrm \\\n    -v "${path.join(HERE,'.osrm-cache')}:/data" ghcr.io/project-osrm/osrm-backend \\\n    osrm-routed --algorithm mld /data/dfw.osrm\n(${e.message})`);
    process.exit(1);
  }
  console.log(`OSRM up at ${OSRM} · ${RAYS} rays × ${FRACS.length} probes · budgets ${BUDGETS.map(b=>b/60+'m').join(', ')}\n`);

  const doClinics = !args.grid, doGrid = !args.clinics;
  if(doClinics){
    const cl=loadClinics();
    console.log(`Clinics in DFW: ${cl.length} (${Object.keys(ck.clinics).length} already checkpointed)`);
    await computeSet(cl, ck.clinics, 'clinics');
  }
  if(doGrid){
    const gr=loadGrid();
    console.log(`Candidate grid (${GRID_MI}mi, fabric-pruned): ${gr.length} (${Object.keys(ck.grid).length} already checkpointed)`);
    await computeSet(gr, ck.grid, 'grid');
  }

  // ── derive + intersect: what ships is NUMBERS, not geometry ─────────────────────────────────
  // Shipping derived counts rather than polygons keeps the artifact small AND keeps us clearly on
  // the "produced work" side of OSM's ODbL rather than redistributing a derived road database.
  console.log('\nDeriving demand + clinic overlap…');
  const clinicRecs=Object.entries(ck.clinics).filter(([,r])=>!r.fail);
  const clinicIdx=clinicRecs.map(([k,r])=>({ k, la:r.la, lo:r.lo, pe:r.pe, ring:r.r10, bb:ringBBox(r.r10) }));
  const cells={};
  let n=0;
  for(const [k,r] of Object.entries(ck.grid)){
    if(r.fail) continue;
    const cell={ la:r.la, lo:r.lo };
    for(const b of BUDGETS){
      const m=b/60;
      cell['z'+m]=ringZipMix(r['r'+m]);   // ZIP mix — app converts to households/pets/visits
      cell['a'+m]=r['a'+m];               // area mi² (display + sanity)
    }
    // which clinic catchments leach into this candidate's 10-min market, and how much
    const ov=[];
    for(const c of clinicIdx){
      if(c.bb.maxLa<ringBBox(r.r10).minLa||c.bb.minLa>ringBBox(r.r10).maxLa) continue;
      const frac=overlapFrac(r.r10, c.ring);
      if(frac>0.03) ov.push([c.k, +frac.toFixed(3)]);   // 3% floor drops trivial fringe overlap
    }
    ov.sort((a,b)=>b[1]-a[1]);
    // Cap at 120 (effectively uncapped): a 20-cap was truncating a MEANINGFUL (>0.10) competitor on 615 of 1,146
    // cells — understating competition exactly in the dense markets where it decides the ranking.
    cell.ov=ov.slice(0,120);
    cells[k]=cell;
    if(++n%200===0) process.stdout.write(`  derived ${n}…\n`);
  }
  const doc={ v:1, built:new Date().toISOString().slice(0,10), engine:'osrm', rays:RAYS,
    budgets:BUDGETS, grid:GRID_MI, bbox:DFW,
    credit:'Drive-time catchments computed locally with OSRM over OpenStreetMap data (ODbL). Derived household/visit figures only — no road geometry redistributed.',
    clinics:Object.fromEntries(clinicRecs.map(([k,r])=>[k,{la:r.la,lo:r.lo,pe:r.pe,a10:r.a10,a15:r.a15}])),
    cells };
  writeAtomic(OUT, JSON.stringify(doc));
  console.log(`\nWrote ${OUT}\n  ${Object.keys(cells).length} candidate cells · ${clinicRecs.length} clinic catchments · ${(fs.statSync(OUT).size/1048576).toFixed(1)} MB`);
})();

// Household-weighted overlap is approximated by AREA overlap here; the app applies staff weights
// and analyst exclusions at runtime against the shipped clinic list, so overrides keep working.
function overlapFrac(ringA, ringB){
  const bb=ringBBox(ringA); const N=18; let inA=0, both=0;
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){
    const la=bb.minLa+(bb.maxLa-bb.minLa)*(i+0.5)/N, lo=bb.minLo+(bb.maxLo-bb.minLo)*(j+0.5)/N;
    if(!pointInRing(la,lo,ringA)) continue;
    inA++;
    if(pointInRing(la,lo,ringB)) both++;
  }
  return inA? both/inA : 0;
}
