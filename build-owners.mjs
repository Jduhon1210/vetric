#!/usr/bin/env node
// build-owners.mjs — identify the OWNER of each independent clinic from Texas business filings.
// Source: the Texas Comptroller Franchise Tax Account Status data (public record). For each clinic
// it (1) searches the franchise-tax list by name, (2) picks the best entity by ZIP + name overlap,
// (3) pulls the officer/registered-agent detail → the owner name + title, and (4) reads the SOS
// registration date as a practice-tenure (age) proxy. Local Node 18+ (global fetch), no cost.
//
//   node build-owners.mjs                 # pilot: 30 DFW independents, prints a table + hit rate
//   node build-owners.mjs --limit=60      # bigger pilot
//   node build-owners.mjs --all --out=owners.js   # statewide, write results (USE THE KEYED API)
//   node build-owners.mjs --region=dfw    # DFW bbox only (default for the pilot)
//
// Data source: by default it uses the SAME keyless endpoint the public search page calls
// (comptroller.texas.gov/data-search/franchise-tax). That's fine for a pilot but is the state's
// website backend — for a statewide run, register a FREE API key and set CPA_API_KEY, which
// switches to the official api.comptroller.texas.gov/public-data endpoint (polite + supported).
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m=a.match(/^--([^=]+)=?(.*)$/); return m?[m[1], m[2]===''?true:m[2]]:[a,true]; }));
const LIMIT = args.limit ? +args.limit : (args.all ? Infinity : 30);
const REGION = args.all ? null : (args.region || 'dfw');
const OUT = args.out || null;
const KEY = process.env.CPA_API_KEY || '';
const DFW = { s:32.25, n:33.5, w:-97.95, e:-96.2 };
const GAP = KEY ? 200 : 750;   // ms between requests — gentle on the keyless public proxy

const BASE = KEY ? 'https://api.comptroller.texas.gov/public-data/v1/public/franchise-tax'
                 : 'https://comptroller.texas.gov/data-search/franchise-tax';
const HDRS = KEY ? { 'x-api-key':KEY, 'Accept':'application/json' }
                 : { 'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                     'Referer':'https://comptroller.texas.gov/taxes/franchise/account-status/search',
                     'X-Requested-With':'XMLHttpRequest', 'Accept':'application/json' };

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
// generic words that don't help distinguish an entity — dropped from token-overlap scoring
const GEN = new Set('the of and a an inc incorporated llc pllc pc pa corp corporation company co group ltd lp associates veterinary veterinarian vet animal hospital clinic care center centre pet pets medical services service'.split(' '));
const toks = s => norm(s).split(' ').filter(w=>w.length>2 && !GEN.has(w));
// the ZIP is the 5 digits after the state ("…, Dallas, TX 75218, USA") — NOT the street number
const zipOf = a => { const s=String(a||''); const m=s.match(/\bTX\s+(\d{5})/i)||s.match(/(\d{5})(?:-\d{4})?(?:,?\s*USA\.?)?\s*$/); return m?m[1]:''; };

async function jget(url){
  for(let attempt=0; attempt<3; attempt++){
    try{
      const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),15000);
      const r=await fetch(url,{headers:HDRS,signal:ac.signal}); clearTimeout(t);
      if(r.status===429||r.status===503){ await sleep(1500*(attempt+1)); continue; }
      if(!r.ok) return null;
      return await r.json();
    }catch(e){ await sleep(600); }
  }
  return null;
}
const listUrl = name => KEY ? `${BASE}-list?name=${encodeURIComponent(name)}` : `${BASE}?name=${encodeURIComponent(name)}`;
const detailUrl = id => `${BASE}/${id}`;

// score an entity candidate against the clinic (zip is the strong signal, name overlap the tiebreak)
function scoreCandidate(clinic, ent){
  const czip=zipOf(clinic.addr), ezip=ent.mailingAddressZip||'';
  const ct=new Set(toks(clinic.name)), et=new Set(toks(ent.name));
  let inter=0; for(const w of ct) if(et.has(w)) inter++;
  const overlap = ct.size ? inter/ct.size : 0;         // fraction of clinic's distinctive words present in the entity
  const zipMatch = czip && ezip && czip===ezip;
  return { score: (zipMatch?1.0:0) + overlap*0.8, zipMatch, overlap };
}
const OWNER_TITLES = ['PRESIDENT','OWNER','SOLE','MANAGING MEMBER','MEMBER','MANAGER','PARTNER','DIRECTOR','CEO','PRINCIPAL','VICE PRESIDENT'];
function pickOwner(detail){
  const offs = detail.officerInfo || [];
  for(const want of OWNER_TITLES){
    const hit = offs.find(o=>String(o.AGNT_TITL_TX||'').toUpperCase().includes(want));
    if(hit) return { name:_titleCase(hit.AGNT_NM), title:hit.AGNT_TITL_TX, source:'officer' };
  }
  if(offs[0]) return { name:_titleCase(offs[0].AGNT_NM), title:offs[0].AGNT_TITL_TX||'officer', source:'officer' };
  if(detail.registeredAgentName) return { name:_titleCase(detail.registeredAgentName), title:'registered agent', source:'agent' };
  return null;
}
const _titleCase = s => String(s||'').toLowerCase().replace(/\b([a-z])/g,(m,c)=>c.toUpperCase());
const yearOf = d => { const m=String(d||'').match(/(\d{4})/); return m?+m[1]:null; };

// ---- pick the pilot clinic set (DFW independents with a usable name+address) ----
function loadClinics(){
  const raw=fs.readFileSync('vet-clinics.js','utf8');
  const i=raw.lastIndexOf('window.VET_CLINICS'), j=raw.indexOf('[',i), k=raw.lastIndexOf(']');
  let all=JSON.parse(raw.slice(j,k+1));
  // PE set for the independent filter
  let PE_NAMES={}, PE_COORDS=[];
  try{ const p=fs.readFileSync('pe-data.js','utf8');
    PE_NAMES=JSON.parse(p.slice(p.indexOf('{'),p.indexOf('};')+1));
    const ci=p.indexOf('PE_COORDS=['); PE_COORDS=JSON.parse(p.slice(ci+'PE_COORDS='.length, p.lastIndexOf('];')+1));
  }catch(e){ console.warn('pe-data.js not loaded — PE filter skipped'); }
  const nrm=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const isPE=(nm,la,lo)=>{ if(PE_NAMES[nrm(nm)]) return true;
    for(const c of PE_COORDS){ if(Math.abs(c[0]-la)<0.003 && Math.abs(c[1]-lo)<0.004) return true; } return false; };
  // Only real clinics: name must carry a clinic signal (drops cat breeders/catteries + bare
  // individual-vet listings, which are sole props filed at the county level, not franchise-tax).
  const CLINIC_SIG=/animal|veterinar|\bvet\b|equine|hospital|clinic|\bpet\b|feline|canine|spay|neuter|surg/i;
  let cl=all.filter(c=>c.addr && / TX \d{5}/.test(' '+c.addr) && !c.mobile);
  if(REGION==='dfw') cl=cl.filter(c=>c.lat>=DFW.s&&c.lat<=DFW.n&&c.lon>=DFW.w&&c.lon<=DFW.e);
  cl=cl.filter(c=>!isPE(c.name,c.lat,c.lon));                       // INDEPENDENTS only
  cl=cl.filter(c=>CLINIC_SIG.test(c.name) && toks(c.name).length>0);
  // Pilot: sample the dense metro core (sort by distance to downtown Dallas) rather than array
  // order, which lands in a rural pocket. Statewide (--all) keeps natural order.
  if(!args.all){ const D=[32.78,-96.80]; cl.sort((a,b)=>(Math.hypot(a.lat-D[0],a.lon-D[1]))-(Math.hypot(b.lat-D[0],b.lon-D[1]))); }
  return cl;
}

(async function main(){
  // pe-data parse helper needs `len` in scope before use above; re-declare safely
  const clinics=loadClinics().slice(0, LIMIT);
  console.log(`Owner lookup for ${clinics.length} independent clinics${REGION==='dfw'?' (DFW)':''} via ${KEY?'official API (keyed)':'public data-search proxy (keyless)'}\n`);
  const rows=[]; let matched=0;
  for(let idx=0; idx<clinics.length; idx++){
    const c=clinics[idx];
    let list=await jget(listUrl(c.name.slice(0,50))); await sleep(GAP);
    let cands=(list&&list.data)||[];
    if(!cands.length){                                              // retry with the distinctive tokens only
      const q=toks(c.name).slice(0,3).join(' ');
      if(q && q.toLowerCase()!==norm(c.name)){ list=await jget(listUrl(q)); await sleep(GAP); cands=(list&&list.data)||[]; }
    }
    const JUNK=/storage|realty|propert|holding|capital|investment|management|rental|construction|builders|ranch\b/i;
    let best=null, bestS=null;
    for(const e of cands){ const s=scoreCandidate(c,e); if(!bestS||s.score>bestS.score){ best=e; bestS=s; } }
    // Confident on a ZIP match; a name-only match must be strong AND not an obviously-unrelated
    // business (Brookside Animal Hospital ≠ "Brookside Storage LP").
    const confident = best && (bestS.zipMatch || (bestS.overlap>=0.6 && !JUNK.test(best.name)));
    let owner=null, sosYear=null, entName=null;
    if(confident){
      const d=await jget(detailUrl(best.taxpayerId)); await sleep(GAP);
      if(d&&d.data){ owner=pickOwner(d.data); sosYear=yearOf(d.data.effectiveSosRegistrationDate); entName=d.data.name; }
    }
    if(owner){ matched++; }
    rows.push({ clinic:c.name, zip:zipOf(c.addr), entity:entName||(best&&best.name)||'', owner:owner?owner.name:'', title:owner?owner.title:'', tenure:sosYear?(new Date().getFullYear()-sosYear)+'y':'', match:owner?(bestS.zipMatch?'zip':'name'):'—' });
    process.stdout.write(`  [${idx+1}/${clinics.length}] ${c.name}  →  ${owner?owner.name+' ('+owner.title+')':'(no confident match)'}\n`);
  }
  const pct=Math.round(100*matched/clinics.length);
  console.log(`\n──── RESULT: owner identified for ${matched}/${clinics.length} clinics (${pct}%) ────`);
  console.table(rows.map(r=>({clinic:r.clinic.slice(0,32), zip:r.zip, owner:r.owner.slice(0,26), title:r.title.slice(0,18), tenure:r.tenure, via:r.match})));
  if(OUT){
    const obj={}; rows.forEach((r,i)=>{ const c=clinics[i]; if(r.owner) obj[Math.round(c.lat*1000)+'_'+Math.round(c.lon*1000)]={owner:r.owner,title:r.title,entity:r.entity,tenureFrom:r.tenure}; });
    fs.writeFileSync(OUT, `// Auto-generated by build-owners.mjs — clinic owner (name+title) + practice tenure from TX franchise-tax filings.\nwindow.CLINIC_OWNERS=${JSON.stringify(obj)};\n`);
    console.log(`\nWrote ${Object.keys(obj).length} owners → ${OUT}`);
  }
})();
