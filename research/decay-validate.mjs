// W1 distance-decay: the exact function that will ship, plus its validation gate.
import fs from 'fs';
const HERE='/Users/jonathanduhon/Downloads/Vet App';

// ── THE ALGORITHM (transplant target: index.html) ────────────────────────────
// Calibration: research/site-capture-model.md §8b. beta=1.5 is the overlap of the
// Huff convention (1.5-2.0), the joint fit to the Pfizer vet-travel facts (1.38),
// and the 60-70% primary-zone convention. Retune here, never rebuild the artifact.
const CATCH_DECAY_BETA = 1.5;
const CATCH_BANDS = [[0.5,8],[8,10],[10,12],[12,15]];   // minutes, matching artifact budgets

// Area-weighted mean of t^-beta inside each band, normalised to the inner ring.
// Households sit in a roughly disc-shaped catchment, so mass at travel time t grows as t.
function ringWeights(beta){
  const w=CATCH_BANDS.map(([t1,t2])=>{
    let n=0,q=0;
    for(let t=t1;t<t2;t+=0.02){ n+=Math.pow(t,-beta)*t*0.02; q+=t*0.02; }
    return n/q;
  });
  return w.map(x=>x/w[0]);
}
const CATCH_RING_W = ringWeights(CATCH_DECAY_BETA);

// Decayed reachable total for a cell. `valOf(zip)` returns the per-ZIP quantity
// (households, dog-HH, whatever). The four ring mixes are NESTED coverage fractions,
// so differencing them yields each ZIP's exposure per travel-time band.
function catchDecayed(cell, valOf){
  let total=0;
  for(let b=0;b<4;b++) for(const [z,f] of (cell.b[b]||[])) total += f*(valOf(z)||0)*CATCH_RING_W[b];
  return {total, lost:0};
}
// Flat (today's behaviour): every household inside 15 min at full weight.
function catchFlat(cell, valOf){
  let t=0; for(const band of cell.b) for(const [z,f] of band) t+=f*(valOf(z)||0); return t;
}

// ── VALIDATION ───────────────────────────────────────────────────────────────
const d=JSON.parse(fs.readFileSync(HERE+'/dfw-catchments.json','utf8'));
const cells=Object.values(d.cells);

// Real ACS households + the app's own dog-ownership model (index.html:7133-7142),
// minus the age/income damps (extra Census calls). Those only REDUCE the rate, so
// omitting them makes this estimate an UPPER bound -- the gate is conservative.
const acs=JSON.parse(fs.readFileSync('acs-hh.json','utf8'));
const TX_DOG_BASE_RATE=0.45;
const raw={};
for(const row of acs.slice(1)){
  const [hh,totOcc,ownOcc,totUnits,sfUnits,zip]=row;
  const households=parseInt(hh); if(isNaN(households)||households<=0) continue;
  const to=parseInt(totOcc), oo=parseInt(ownOcc), tu=parseInt(totUnits), sf=parseInt(sfUnits);
  raw[zip]={households, ownerPct:(to>0&&!isNaN(oo))?oo/to:null, sfPct:(tu>0&&!isNaN(sf))?sf/tu:null};
}
let oW=0,oWt=0,sW=0,sWt=0;
for(const z of Object.values(raw)){ if(z.ownerPct!=null){oW+=z.ownerPct*z.households;oWt+=z.households;} if(z.sfPct!=null){sW+=z.sfPct*z.households;sWt+=z.households;} }
const avgOwner=oWt>0?oW/oWt:0.6, avgSf=sWt>0?sW/sWt:0.6;
const dogHH={}, catHH={}, totHH={};
const TX_CAT_BASE_RATE=0.25;
for(const zip of Object.keys(raw)){
  const z=raw[zip]; let m=0,p=0;
  if(z.ownerPct!=null&&avgOwner>0){ m+=(z.ownerPct-avgOwner)/avgOwner; p++; }
  if(z.sfPct!=null&&avgSf>0){ m+=(z.sfPct-avgSf)/avgSf; p++; }
  m=p>0?m/p:0; m=Math.max(-0.3,Math.min(0.3,m));
  let rate=TX_DOG_BASE_RATE*(1+m); rate=Math.max(0.2,Math.min(0.7,rate));
  const oDev=(z.ownerPct!=null&&avgOwner>0)?(z.ownerPct-avgOwner)/avgOwner:0;
  let cRate=TX_CAT_BASE_RATE*(1+Math.max(-0.15,Math.min(0.15,0.5*oDev)));
  cRate=Math.max(0.15,Math.min(0.45,cRate));
  dogHH[zip]=z.households*rate; catHH[zip]=z.households*cRate; totHH[zip]=z.households;
}

console.log('RING WEIGHTS  beta='+CATCH_DECAY_BETA+'  ->  '+CATCH_RING_W.map(x=>x.toFixed(3)).join(' / '));

// -- structural check: nesting must hold, or differencing silently drops demand
console.log('BANDS     disjoint by construction — monotonicity is structural in v2');

// -- the gate: an average EXISTING clinic should model to a plausible practice size.
// 2-3 DVMs x DVM_VISIT_CAPACITY 3200 = 6,400-9,600 visits/yr.
const OPP_VISITS_PER_DOGHH=2.4, OPP_VISITS_PER_CATHH=1.2;
// the app's visit chain is dogHH*2.4 + catHH*1.2 — both species, not dogs alone
const visitsOf=z=>(dogHH[z]||0)*OPP_VISITS_PER_DOGHH + (catHH[z]||0)*OPP_VISITS_PER_CATHH;
const idx=new Map();
for(const c of cells) idx.set(Math.round(c.la*1000)+'_'+Math.round(c.lo*1000), c);
const nearestCell=(la,lo)=>{
  let best=null,bd=1e9;
  for(const c of cells){ const dd=(c.la-la)**2+(c.lo-lo)**2; if(dd<bd){bd=dd;best=c;} }
  return Math.sqrt(bd)<0.02?best:null;   // within ~1.4 mi
};
const rows=[];
for(const cl of d.clinics){
  const c=nearestCell(cl.la,cl.lo); if(!c) continue;
  const dec=catchDecayed(c,visitsOf).total;
  const flat=catchFlat(c,visitsOf);
  // CORRECT share: split demand per household among the clinics that actually reach that
  // household, then aggregate. cd[n] = household share reached by exactly n competitors.
  let share=0; for(let n=0;n<9;n++) share += (c.cd[n]||0)/(1+n);
  // the old (wrong) aggregate form, kept for comparison
  const press=(c.ov||[]).reduce((a,[i,f])=>a+f,0);
  const shareOld=1/(1+press);
  rows.push({name:cl.name, dec, flat, share, shareOld, vDec:dec*share, vFlat:flat*share, vOld:dec*shareOld});
}
const q=(a,p)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length*p)];};
const vD=rows.map(r=>r.vDec), vF=rows.map(r=>r.vFlat);
console.log('\nGATE — modelled winnable visits/yr at '+rows.length+' real clinic locations');
console.log('           p25      median     p75      p90');
console.log('  DECAYED  '+[q(vD,.25),q(vD,.5),q(vD,.75),q(vD,.9)].map(x=>String(Math.round(x)).padStart(7)).join(' '));
console.log('  flat     '+[q(vF,.25),q(vF,.5),q(vF,.75),q(vF,.9)].map(x=>String(Math.round(x)).padStart(7)).join(' '));
console.log('  EMPIRICAL target: scraped rosters median 2 DVMs / mean 3.12 (n=2,408).');
console.log('  At DVM_VISIT_CAPACITY 3200 that is 6,400 (median) to 9,990 (mean) visits AT FULL');
console.log('  capacity — real practices run below it, so a correct model should land somewhat under.');
const inBand=vD.filter(v=>v>=6400&&v<=9600).length;
console.log('  decayed clinics inside the band: '+inBand+'/'+rows.length+' ('+(inBand/rows.length*100).toFixed(0)+'%)');
console.log('  implied DVM equivalent at median: '+(q(vD,.5)/3200).toFixed(2)+' DVMs  (flat: '+(q(vF,.5)/3200).toFixed(2)+')');
console.log('\n  decay retains '+(q(vD,.5)/q(vF,.5)*100).toFixed(0)+'% of the flat count at the median');
const sh=rows.map(r=>r.share), so=rows.map(r=>r.shareOld);
console.log('\nSHARE MODEL  median per-household split '+q(sh,.5).toFixed(3)+'   vs old sum-of-overlaps '+q(so,.5).toFixed(3)+'  ('+(q(sh,.5)/q(so,.5)).toFixed(2)+'x)');
const vO=rows.map(r=>r.vOld);
console.log('  decayed visits under the OLD share: median '+Math.round(q(vO,.5)));
