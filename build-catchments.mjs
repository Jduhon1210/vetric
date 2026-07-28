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
// 20- and 25-minute bands added 2026-07-27. Measured: our 15-min ring is a 5.33-mi equivalent
// radius, and the industry survey's MEAN client travel is 5.3 mi — the average client was sitting
// exactly on the old boundary, so 15 min captured ~62% of a clientele and we treated it as the
// whole market. 62% is the textbook PRIMARY trade area (60-70%); the SECONDARY tier (another
// 20-25% of customers) is precisely what was being discarded. 25 min reaches 8.9 mi / ~82%, still
// short of the ~13-mi effective range the survey joint-fit implies — deliberately conservative.
const BUDGETS = [480, 600, 720, 900, 1200, 1500];
const RAYS = 72;                       // rays per polygon — 5° angular resolution. Free locally and costs
                                       // NOTHING in file size (we ship derived numbers, not geometry), so
                                       // fidelity is the cheap axis to buy accuracy on — unlike grid density.
// Probes per ray, NON-UNIFORM and front-loaded. maxMi scales with the largest budget, so a flat
// 0.2/0.4/... spacing over a 23.75-mi span would put the FIRST probe at 4.75 mi — beyond the entire
// 8-minute ring (2.4 mi), which then falls back to crude linear extrapolation. These cluster where
// the rings actually live (2-9 mi) and thin out past them.
const FRACS = [0.05, 0.10, 0.16, 0.23, 0.32, 0.45, 0.62, 0.80, 1.0];
const GRID_MI = 0.61;                  // candidate grid spacing — 6x the cells of the 1.5mi first pass (user ask)
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
// Candidate grid, pruned to points with COMMERCIAL CONTEXT — a candidate that can never pass the
// siting gate would be wasted routing.
//
// The gate is deliberately TWO-SOURCE (2026-07-27, user spotted empty areas around Westlake and
// Southlake). Using OSM retail alone had a systematic bias: dfw-retail.json maps EXISTING retail,
// so a commercially-zoned tract that has been platted but not yet built carries no retail to map —
// and that is exactly where a de novo clinic goes. Half the points pruned in the Flower Mound
// window sat within a mile of a county-recorded vacant COMMERCIAL parcel. Adding dfw-land.json
// (appraisal-district vacant commercial) recovers 2,720 cells, 39% more than retail alone.
// Each source catches what the other misses: OSM sees built strip centres the appraisal roll marks
// improved; the county sees platted dirt OSM has not noticed.
function loadGrid(){
  const pts=[];
  try{ for(const [la,lo] of JSON.parse(fs.readFileSync(path.join(HERE,'dfw-retail.json'),'utf8'))) pts.push([la,lo]); }
  catch(e){ console.warn('dfw-retail.json missing — gate falls back to county land only'); }
  try{ for(const p of JSON.parse(fs.readFileSync(path.join(HERE,'dfw-land.json'),'utf8')).list) pts.push([p.la,p.lo]); }
  catch(e){ console.warn('dfw-land.json missing — gate falls back to OSM retail only'); }
  const bin=new Map(); const B=0.02;   // ~1.4 mi bins
  for(const [la,lo] of pts){ const k=Math.round(la/B)+'_'+Math.round(lo/B); if(!bin.has(k)) bin.set(k,[]); bin.get(k).push([la,lo]); }
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
// ── ZIP RASTER ────────────────────────────────────────────────────────────────────────────────
// Point-in-polygon against ~250 ZIP rings, run per sample per cell, was the cost that forced the
// old FIXED 26x26 grid — and that fixed grid is what produced the coverage bug: as a ring grew
// 24 -> 129 sq mi the same 676 samples got coarser, so a small downtown ZIP was quantised in ~0.2
// steps at 15 min while being accurate at 8 min (75226 read 100% covered at 8 min, 31% at 15).
// Rasterising the ZIP map ONCE at the sampling resolution makes every later lookup O(1), which
// buys a fine FIXED-RESOLUTION sample grid — accurate at every budget.
const SAMPLE_MI = 0.25;                  // sample spacing; ~0.0625 sq mi per sample
let ZRAST=null, ZLIST=null, ZIDX=null, RNL=0, RNO=0, RmpdLon=1;
function buildRaster(){
  if(ZRAST) return;
  const zs=loadZips();
  ZLIST=zs.map(z=>z.zip); ZIDX=new Map(ZLIST.map((z,i)=>[z,i]));
  RmpdLon = 69.0*Math.cos(((DFW.s+DFW.n)/2)*Math.PI/180);
  RNL = Math.ceil((DFW.n-DFW.s)*69.0/SAMPLE_MI);
  RNO = Math.ceil((DFW.e-DFW.w)*RmpdLon/SAMPLE_MI);
  ZRAST = new Int16Array(RNL*RNO).fill(-1);
  // bucket ZIPs by 0.05 deg so each raster cell tests only a handful of rings
  const B=0.05, buck=new Map();
  zs.forEach((z,i)=>{
    for(let la=Math.floor(z.bb.minLa/B);la<=Math.floor(z.bb.maxLa/B);la++)
      for(let lo=Math.floor(z.bb.minLo/B);lo<=Math.floor(z.bb.maxLo/B);lo++){
        const k=la+'_'+lo; if(!buck.has(k)) buck.set(k,[]); buck.get(k).push(i);
      }
  });
  for(let i=0;i<RNL;i++){
    const la=DFW.s+(i+0.5)*SAMPLE_MI/69.0;
    for(let j=0;j<RNO;j++){
      const lo=DFW.w+(j+0.5)*SAMPLE_MI/RmpdLon;
      const cand=buck.get(Math.floor(la/B)+'_'+Math.floor(lo/B)); if(!cand) continue;
      for(const ci of cand){
        const z=zs[ci];
        if(la<z.bb.minLa||la>z.bb.maxLa||lo<z.bb.minLo||lo>z.bb.maxLo) continue;
        let hit=false;
        for(const r of z.rings){
          let inside=false;
          for(let a=0,b=r.length-1;a<r.length;b=a++){
            const yi=r[a][1], xi=r[a][0], yj=r[b][1], xj=r[b][0];
            if(((yi>la)!==(yj>la)) && (lo < (xj-xi)*(la-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
          }
          if(inside){hit=true;break;}
        }
        if(hit){ ZRAST[i*RNO+j]=ci; break; }
      }
    }
  }
  console.log(`  ZIP raster ${RNL}x${RNO} at ${SAMPLE_MI} mi`);
}
function rastAt(la,lo){
  const i=Math.floor((la-DFW.s)*69.0/SAMPLE_MI), j=Math.floor((lo-DFW.w)*RmpdLon/SAMPLE_MI);
  if(i<0||i>=RNL||j<0||j>=RNO) return -1;
  return ZRAST[i*RNO+j];
}

// ── HOUSEHOLD DENSITY (W2) ────────────────────────────────────────────────────────────────────
// The build was pure geometry until W2. Household-weighting the competitor overlap needs ACS
// household counts at BUILD time — an area-weighted overlap prices a competitor covering the empty
// half of your market the same as one covering the dense half. This is the ONLY Census call here,
// it is cached locally, and it is used purely to WEIGHT the overlap: the app still owns the pet
// model and still converts the ZIP mix to households/pets/visits with its own figures.
const ACS_CACHE=path.join(HERE,'.acs-hh-cache.json');
let HHDENS=null;
async function loadHouseholds(){
  if(HHDENS) return HHDENS;
  let rows=null;
  try{ rows=JSON.parse(fs.readFileSync(ACS_CACHE,'utf8')); }catch(e){}
  if(!rows){
    const url='https://api.census.gov/data/2024/acs/acs5?get=B11001_001E&for=zip%20code%20tabulation%20area:*&key=3429f2401376a586a8f6ffc02bb5678ee32fbf44';
    const r=await fetch(url); rows=await r.json();
    try{ fs.writeFileSync(ACS_CACHE, JSON.stringify(rows)); }catch(e){}
  }
  const hh={};
  for(const row of rows.slice(1)){ const n=parseInt(row[0]); if(n>0) hh[row[1]]=n; }
  HHDENS={};
  for(const z of loadZips()){ const a=zipArea(z.zip); if(a>0 && hh[z.zip]) HHDENS[z.zip]=hh[z.zip]/a; }
  console.log(`  household density for ${Object.keys(HHDENS).length} ZIPs`);
  return HHDENS;
}

// ── STAR-RING CONTAINMENT, O(1) ───────────────────────────────────────────────────────────────
// Rings are built from RAYS evenly-spaced rays out of one origin, so they are star-shaped: vertex d
// sits at bearing 2*pi*d/RAYS. Containment is therefore "is the sample nearer than the boundary at
// its own bearing" — one interpolation instead of a 72-edge crossing test. That is what makes the
// fine sample grid affordable. Radial interpolation vs the true chord is <0.1% at 5 deg steps.
function reachOf(ring, ola, olo){
  const mLat=69.0, mLon=69.0*Math.cos(ola*Math.PI/180);
  return ring.map(([la,lo])=>Math.hypot((la-ola)*mLat,(lo-olo)*mLon));
}
function inStar(dLat, dLon, reach){        // offsets in MILES from the ring origin
  const dist=Math.hypot(dLat,dLon); if(dist<=0) return true;
  let th=Math.atan2(dLat,dLon); if(th<0) th+=2*Math.PI;
  const f=th/(2*Math.PI)*reach.length, i0=Math.floor(f);
  const i=i0%reach.length, j=(i+1)%reach.length;
  return dist <= reach[i]+(reach[j]-reach[i])*(f-i0);
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
  // Competitor references are the clinic's INDEX in the shipped clinics array, not its cell key —
  // at ~30 competitors per cell across thousands of cells the 12-char keys dominated the file.
  // SYMMETRY (2026-07-28, user: "competitors represented by the same rings a demand site would
  // have with the same distance decay algorithms"). Previously a competitor was a single 10-minute
  // ring — a binary in/out test — while a candidate's demand spanned 25 minutes. A household 20 min
  // from the site sat outside nearly every competitor ring and read as UNCONTESTED when it was not.
  // Measured cost: the model read 1.4-1.8x actual rosters instead of the ~0.7x incumbency-consistent
  // level, worst where competitors are sparse. Each competitor now carries ALL SIX of its own rings
  // and is weighted by the SAME decay curve a site uses, so two equally distant clinics split 50/50
  // instead of both reading uncontested.
  const clinicIdx=clinicRecs.map(([k,r],i)=>({ i, k, la:r.la, lo:r.lo, pe:r.pe,
    ring:r['r'+(BUDGETS[BUDGETS.length-1]/60)], bb:ringBBox(r['r'+(BUDGETS[BUDGETS.length-1]/60)]),
    rings:BUDGETS.map(b=>r['r'+(b/60)]) }));
  buildRaster();
  const HD = await loadHouseholds();
  // Precompute each clinic's ray reaches once — reused against every candidate cell.
  for(const c of clinicIdx){
    c.reach=reachOf(c.ring, c.la, c.lo);                       // outermost, for the bbox/skip test
    c.reaches=c.rings.map(rg=>reachOf(rg, c.la, c.lo));        // all six, for the decay weight
    c.mLon=69.0*Math.cos(c.la*Math.PI/180);
  }
  // The decay curve applied to a competitor is the SAME one applied to the site. Urbanicity is a
  // runtime classification (it needs the app's household model), so the build uses the SUBURBAN
  // reference curve — the median class, 33% of DFW cells. Documented approximation: the dominant
  // correction is that competitors are decay-weighted AT ALL rather than a binary 10-min test.
  const CBANDS=[[0.5,8],[8,10],[10,12],[12,15],[15,20],[20,25]];
  const CW=(function(beta,theta){
    const w=CBANDS.map(([t1,t2])=>{ let n=0,q=0;
      for(let t=t1;t<t2;t+=0.02){ n+=(1/(1+Math.pow(t/theta,beta)))*t*0.02; q+=t*0.02; }
      return n/q; });
    return w.map(x=>x/w[0]);
  })(2.22, 4.0);
  const KBUCKETS=17, KSTEP=0.5;   // effective competitor weight, 0 to 8 in 0.5 steps

  // ── FUTURE DEMAND, MEASURED ON THE SAME GEOMETRY (2026-07-28, user: "transition it to the new
  // engine, remove gravity scale") ─────────────────────────────────────────────────────────────
  // Land plays qualified on a crow-flies gravity sum while sites were scored on the road network,
  // so a site and the land play beside it were not comparable. Announced units are counted PER
  // BAND here, using the identical drive polygons, so future demand runs through the same decay
  // and share machinery as today's rooftops.
  // dfw-pipeline ONLY, never also dfw-mpc: NCTCOG already contains every MPC at phase grain and
  // mixing them double-counts (the same rule the catchment card follows).
  // Trade-off: a pipeline refresh now needs a derive rerun (~25 min, no OSRM). Cadence is 30 days.
  let PIPE=[];
  try{
    const pj=JSON.parse(fs.readFileSync(path.join(HERE,'dfw-pipeline.json'),'utf8'));
    PIPE=(pj.list||[]).filter(r=>r.cl==='R' && r.u>0 && !r.stale && r.la && r.lo)
                      .map(r=>({la:r.la, lo:r.lo, u:r.u}));
    console.log(`  future demand: ${PIPE.length} residential projects, ${PIPE.reduce((a,r)=>a+r.u,0).toLocaleString()} units`);
  }catch(e){ console.warn('  dfw-pipeline.json missing — future demand will be absent'); }

  const cells={};
  let n=0;
  for(const [k,r] of Object.entries(ck.grid)){
    if(r.fail) continue;
    const cell={ la:r.la, lo:r.lo };
    for(const b of BUDGETS) cell['a'+(b/60)]=r['a'+(b/60)];   // area mi² (display + sanity)

    const ola=r.la, olo=r.lo, mLon=69.0*Math.cos(ola*Math.PI/180);
    const reaches=BUDGETS.map(b=>reachOf(r['r'+(b/60)], ola, olo));
    const rMax=Math.max(...reaches[reaches.length-1]);
    const rb=ringBBox(r['r'+(BUDGETS[BUDGETS.length-1]/60)]);
    // Prefilter against the OUTERMOST ring: competition is now measured across the whole catchment,
    // so a clinic that only meets the 20-25 min band still competes for those households.
    const comps=clinicIdx.filter(c=> !(c.bb.maxLa<rb.minLa||c.bb.minLa>rb.maxLa||c.bb.maxLo<rb.minLo||c.bb.minLo>rb.maxLo));

    const SA=SAMPLE_MI*SAMPLE_MI;                  // sq mi represented by one sample
    const NB=BUDGETS.length;
    const bandArea=Array.from({length:NB},()=>new Map());
    const ovHH=new Map(); let mktHH=0;
    // PER BAND. Measuring competition on the 10-minute ring while summing demand out to 25 minutes
    // credited far households as winnable at the INNER ring's share — households 20 min away have
    // many closer clinics. Measured effect of that mismatch: the model read 1.4-1.5x actual rosters
    // instead of the ~0.7x incumbency-consistent level, and rural cells (largest outer rings
    // relative to inner) inflated 9.4x. Each band now splits against the clinics that reach IT.
    const covHH=Array.from({length:NB},()=>new Array(17).fill(0));
    const mktB=new Array(NB).fill(0);
    for(let dy=-rMax; dy<=rMax; dy+=SAMPLE_MI){
      for(let dx=-rMax; dx<=rMax; dx+=SAMPLE_MI){
        // largest ring first so a sample outside everything costs exactly one test
        if(!inStar(dy,dx,reaches[NB-1])) continue;
        let band=NB-1;
        for(let b=0;b<NB-1;b++) if(inStar(dy,dx,reaches[b])){ band=b; break; }
        const la=ola+dy/69.0, lo=olo+dx/mLon;
        const zi=rastAt(la,lo); if(zi<0) continue;
        const zip=ZLIST[zi];
        bandArea[band].set(zip,(bandArea[band].get(zip)||0)+SA);
        {
          const w=(HD[zip]||0)*SA;                  // W2: weight by households, not area
          if(w>0){
            mktHH+=w; mktB[band]+=w;
            // Effective competitor weight at THIS household: each rival contributes the decay
            // weight of whichever of ITS OWN rings reaches here — the same curve the site uses.
            let K=0;
            for(const c of comps){
              const dy2=(la-c.la)*69.0, dx2=(lo-c.lo)*c.mLon;
              if(!inStar(dy2,dx2,c.reaches[c.reaches.length-1])) continue;   // outside even 25 min
              let cb=c.reaches.length-1;
              for(let q2=0;q2<c.reaches.length-1;q2++) if(inStar(dy2,dx2,c.reaches[q2])){ cb=q2; break; }
              K+=CW[cb];
              ovHH.set(c.i,(ovHH.get(c.i)||0)+w*CW[cb]);
            }
            // Household-weighted distribution of HOW MANY competitors reach each household.
            // Summing per-competitor overlaps and taking 1/(1+sum) is NOT the same as averaging
            // the per-household split — by Jensen's inequality it systematically over-penalises.
            // The split has to happen per household and then be aggregated, which is build-time
            // information. Shipping the distribution lets the app do the correct average while
            // still applying its own runtime roster weights.
            covHH[band][Math.min(KBUCKETS-1, Math.round(K/KSTEP))] += w;
          }
        }
      }
    }
    // BAND mixes, disjoint by construction — a sample lands in exactly one band, so these can never
    // be non-monotonic the way differencing four independently-sampled cumulative rings could be.
    // Raster sampling quantises a SMALL ZIP badly — a 0.4 sq mi ZIP gets ~6 samples, so one sample
    // either way is ~17%, and the four bands can sum past 100% of the ZIP. Normalise per ZIP so
    // cumulative coverage cannot exceed 1: it preserves the band DISTRIBUTION (what decay reads)
    // while enforcing the physical ceiling. Measured before the fix: median overflow 1.04, max 1.42,
    // and every worst case was a ZIP far below the 53.7 sq mi median.
    const zTot={};
    for(const m of bandArea) for(const [z,a] of m) zTot[z]=(zTot[z]||0)+a;
    const zScale={};
    for(const z in zTot){ const za=zipArea(z); zScale[z]=(za>0 && zTot[z]>za) ? za/zTot[z] : 1; }
    cell.b=bandArea.map(m=>{
      const out=[];
      for(const [z,a] of m){ const za=zipArea(z); if(!za) continue;
        const f=Math.min(1,a*(zScale[z]||1)/za); if(f>0.005) out.push([z,+f.toFixed(3)]); }
      return out.sort((x,y)=>y[1]-x[1]);
    });
    // household-weighted share of this candidate's 10-min market that each competitor also reaches
    // cd[band][n] = household-weighted share of THAT BAND's households reached by exactly n
    // competitors. Per band, because a 20-minute household faces a different competitive set than
    // a 5-minute one and must not inherit the inner ring's share.
    // Announced units per band, on the SAME rings — the app converts to pet households and visits
    // with its own model, exactly as it does for the ZIP mix.
    const futB=new Array(NB).fill(0);
    for(const pr of PIPE){
      const dy2=(pr.la-ola)*69.0, dx2=(pr.lo-olo)*mLon;
      if(!inStar(dy2,dx2,reaches[NB-1])) continue;
      let fb=NB-1;
      for(let q3=0;q3<NB-1;q3++) if(inStar(dy2,dx2,reaches[q3])){ fb=q3; break; }
      futB[fb]+=pr.u;
    }
    if(futB.some(v=>v>0)) cell.fu=futB;

    // cd[band][i] = household-weighted share of that band's households facing an EFFECTIVE
    // competitor weight of i*0.5 (decay-weighted, not a raw count). Runtime reads bucket i as
    // K = i*0.5 and computes A*W[band] / (A*W[band] + wBar*K).
    cell.cd = covHH.map((arr,b)=> mktB[b]>0 ? arr.map(w=>+(w/mktB[b]).toFixed(3)) : new Array(17).fill(0));
    const ov=[];
    if(mktHH>0) for(const [i,w] of ovHH){ const f=w/mktHH; if(f>0.03) ov.push([i,+f.toFixed(2)]); }
    ov.sort((a,b)=>b[1]-a[1]);
    // Cap at 120 (effectively uncapped): a 20-cap was truncating a MEANINGFUL (>0.10) competitor on 615 of 1,146
    // cells — understating competition exactly in the dense markets where it decides the ranking.
    cell.ov=ov.slice(0,120);
    cells[k]=cell;
    if(++n%400===0) process.stdout.write(`  derived ${n}…\n`);
  }
  const doc={ v:6, built:new Date().toISOString().slice(0,10), engine:'osrm', rays:RAYS,
    budgets:BUDGETS, grid:GRID_MI, bbox:DFW, sampleMi:SAMPLE_MI, kStep:0.5,
    // v6: `fu[band]` = announced residential units (NCTCOG) per band, on the same rings, so future
    //     demand runs through the same decay/share machinery instead of a parallel gravity sum.
    // v5: competitors carry all six of their OWN rings and are decay-weighted with the same curve a
    //     site uses; cd[band][i] buckets EFFECTIVE competitor weight (i*0.5), not a raw count.
    // v4: `cd` is PER BAND (cd[band][n]); competition spans the whole catchment, not the 10-min ring.
    // v3: cells carry `b` = SIX DISJOINT band ZIP mixes (0-8, 8-10, 10-12, 12-15, 15-20, 20-25 min) instead of
    // four nested cumulative mixes; `ov` is HOUSEHOLD-weighted not area-weighted; and `cd` is the
    // household-weighted distribution of competitor COUNT per household, which is what lets the
    // app compute a correct average capture share instead of 1/(1+sum-of-overlaps).
    credit:'Drive-time catchments computed locally with OSRM over OpenStreetMap data (ODbL). Derived household/visit figures only — no road geometry redistributed.',
    // ARRAY, so `ov` entries can reference clinics by index. Order is load-bearing — do not sort.
    clinics:clinicRecs.map(([k,r])=>({k, la:r.la, lo:r.lo, pe:r.pe, a10:r.a10, a15:r.a15})),
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
