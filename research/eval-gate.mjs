#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// eval-gate.mjs — END-TO-END VALIDATION GATE for the drive-time capture model.
//
//   node research/eval-gate.mjs             # full gate; exit 0 = pass, 1 = fail
//   node research/eval-gate.mjs --json      # machine-readable summary on stdout
//   node research/eval-gate.mjs --quick     # skip the roster-fit check
//   GATE_OFFLINE=1 node research/eval-gate.mjs    # forbid the network outright
//
// Needs Node >= 18.  `node` on this Mac is v10 — use  nvm use 20  first, or call
//   ~/.nvm/versions/node/v20.20.2/bin/node research/eval-gate.mjs
//
// WHY THIS EXISTS
// Over 2026-07-27/28 six capture-model bugs shipped. Every one passed `node --check`;
// every one survived unit-testing the helpers. None is a syntax error, and the two
// worst present as the analysis HANGING rather than as an error:
//   1. CATCH_REACH_FULL / CATCH_REV_FULL referenced but never declared — a runtime
//      ReferenceError reachable only from the scoring loop.        -> §2
//   2a. `staffW` read above its own const in build-catchments.mjs. -> §3
//   2b. `_capture` read by `_hasFut` above its own const.          -> §3
//   3. _evalStrongOK still carrying gravity-scale floors — passed 3 of 9,627 cells. -> §8
//   4. The capture-mode siting gate blanket-passing every cell — land plays -> 0.   -> §6
//   5. A MIXED-SCALE grid: cells with no measured catchment silently kept their
//      gravity score and were ranked beside capture-scored ones.   -> §6b
// The one thing that would have caught all of them is running a real evaluation on
// the real artifact and looking at the numbers. That is what this file does, headless.
// §3 is static because the two TDZ bugs live in code paths (build scripts, an
// early-return branch) that no single run is guaranteed to reach.
//
// HARDENED 2026-07-29 after research/algo-audit-2026-07-29.md, which established that
// everything above could stay green while the model was wrong in ways nobody could see:
//   * §9's quantile-ratio statistic is PAIRING-BLIND. Randomly permuting the modelled
//     values across clinics leaves it bit-identical, so it certifies a model with zero
//     per-site skill.                                              -> fit.pairing (b)
//   * That pooled statistic is also a MIXTURE that cancels: it reads 1.09 while the
//     four urbanicity classes span 8.9x (rural 0.25x, urban 2.18x). The class
//     stratification IS the urban-over-suburban bias.              -> fit.byclass (a)
//   * Ordering was reported but never tracked per class.           -> fit.rank    (c)
//   * Demand and capacity are calibrated independently and never reconciled: the
//     metro's modelled visits support half the doctors that physically exist.
//                                                                  -> closure.metro (d)
//   * "Capture share" is an accounting residual (n x CAP / reach), not a competitive
//     measurement, and nothing stopped it being read as one.       -> share.identity (e)
// (a) (c) (d) carry RECORDED KNOWN-BAD BASELINES rather than asserted targets: today's
// tree passes, and the fixes now in flight show up as movement instead of as silence.
//
// HOW
// index.html is a single file whose whole app is inline <script> blocks. They are
// evaluated VERBATIM in a node `vm` context against a stub DOM/Leaflet; the app's own
// loaders then populate real data; and the REAL _evalComputeAndRender() is called
// nine times, once per entry point. Nothing is re-implemented. That is the point: a
// replica of the scoring code cannot catch a bug in the scoring code, which is exactly
// how research/decay-validate.mjs and the scratchpad validators missed all six.
//
// FREE ONLY
// Local files plus Census ACS (the app's own public demo key), cached to
// research/.gate-cache/ on the first run. No other host is ever contacted.
//
// WHAT THIS DOES NOT COVER — read before trusting a green run
//   * Rendering. _evalRenderLayers / _evalRenderSidebar are replaced with no-ops;
//     against a stub DOM they would measure the stub, not the app. Nothing about the
//     sidebar, the cards, the popups, the print reports or the map layers is tested.
//   * The live context fetch. _evalFetchContext (Overpass, TxDOT AADT, ArcGIS zoning,
//     county parcels) is not called — it is network, slow and flaky. The gate
//     substitutes the MEASURED metro condition (see CTX_METRO / CTX_LOCAL). With roads
//     stubbed to an empty segment list, accessMult is pinned at 0.754 for every cell,
//     so ABSOLUTE scores here run ~25% below production. One constant cannot reorder
//     cells, so the tier fractions and the ranking are still meaningful — the absolute
//     score numbers in §7 are not production numbers.
//   * Anything reachable only from a UI event handler.
//   * The build scripts are only READ (§3), never executed — build-catchments.mjs
//     needs Docker + a local OSRM, which is neither free-standing nor fast.
//   * §3 is a lexical scan, not a type checker: it reports a const/let read above its
//     own declaration in the same immediate scope, and deliberately stays silent when
//     a name is declared more than once in a scope (shadowing is ambiguous to a
//     regex walker). Measured on this repo: 0 false positives, both real bugs caught.
//   * Per-site accuracy. §9 checks the roster DISTRIBUTION; the model has no validated
//     firm-level signal (rho ~0 per clinic) and this gate cannot manufacture one. What it
//     CAN now do is refuse to pretend otherwise: fit.rank tracks the ordering per class
//     with an explicit promotion path, and fit.pairing proves the fit statistic responds
//     to the assignment at all. Note the consequence — because the per-clinic signal is
//     already ~0, a scrambled assignment is invisible to any model-vs-roster statistic;
//     fit.pairing therefore tests SPATIAL COHERENCE, which is the one axis that still
//     carries signal today. If a future model earns real per-site skill, add the
//     model-vs-roster permutation z-score there too.
//   * Whether the recorded baselines are RIGHT. fit.byclass, fit.rank and closure.metro
//     record measured defects so they can be tracked. A green run on them means "no
//     movement", not "correct".
//   * ONE MEASURED BLIND SPOT: deleting the candidate-loop guard
//       if(_captureRun && !_cc){ evalCapStat.skipped++; continue; }
//     changes nothing here. _catchNearest's tolerance is 0.8 mi and catchment cells sit on
//     commercial fabric, so a candidate with no catchment is also >0.8 mi from fabric and
//     fails the 280 m siting gate by itself. The guard only bites when evalData.retail
//     carries commercial POIs the artifact build never saw — a LIVE Overpass fetch newer
//     than the baked dfw-retail.json — and CTX_LOCAL feeds the gate that same static file,
//     so the condition is unreachable offline. §6b still catches the mixed-scale STATE by
//     any other route (verified: an _applyCapture early-return lights up all nine capture
//     scenarios). Asserted, not hidden: eval-gate-selftest.mjs carries it as M5-skip with
//     expectMiss:true, so it fails loudly the day the gate can see it.
//
// SELF-TEST
// research/eval-gate-selftest.mjs re-seeds each of these bugs into a throwaway copy of the
// tree and asserts the right check goes red. Run it after editing this file. ~7.5 min.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE  = path.dirname(fileURLToPath(import.meta.url));
const APP   = process.env.VETRIC_APP || path.resolve(HERE, '..');
const CACHE = path.join(HERE, '.gate-cache');
const ARGS  = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const QUICK    = ARGS.has('--quick');

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('eval-gate needs Node >= 18 (global fetch, modern syntax). Found ' + process.version + '.');
  console.error('  nvm use 20   # or:  ~/.nvm/versions/node/v20.20.2/bin/node research/eval-gate.mjs');
  process.exit(2);
}
fs.mkdirSync(CACHE, { recursive: true });

// ── result plumbing ──────────────────────────────────────────────────────────
// Declared up front rather than at first use: finish() can be called from the boot
// check, and reading a `let` before its initialiser is the very failure class this
// gate exists to catch. Practise what check 3 preaches.
const RESULTS = [];
let FAILED = 0, WARNED = 0;
let DATA = null, GATES = null, DIST = null, FIT = null, IDENT = null, CLOSE = null;
const SC = {};
const C = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', d:'\x1b[2m', n:'\x1b[0m' };
function record(status, id, msg, detail){
  RESULTS.push({ id, status, msg, detail: detail === undefined ? null : detail });
  if (status === 'FAIL') FAILED++;
  if (status === 'WARN') WARNED++;
  if (JSON_OUT) return;
  const tag = status==='PASS' ? C.g+'PASS'+C.n : status==='WARN' ? C.y+'WARN'+C.n : C.r+'FAIL'+C.n;
  console.log(`  ${tag}  ${id.padEnd(24)} ${msg}`);
  if (detail && status !== 'PASS') console.log(`        ${C.d}${String(detail).replace(/\n/g,'\n        ')}${C.n}`);
}
const pass=(id,m,d)=>record('PASS',id,m,d);
const warn=(id,m,d)=>record('WARN',id,m,d);
const fail=(id,m,d)=>record('FAIL',id,m,d);
function section(t){ if(!JSON_OUT) console.log(`\n${C.d}── ${t} ${'─'.repeat(Math.max(0,60-t.length))}${C.n}`); }

// ── statistics shared by §7b / §9 / §10 ──────────────────────────────────────
// Deliberately in NODE, not in the vm: §9's permutation test has to be able to reshuffle the
// model's outputs without re-running the model, and a statistic that lives next to the thing
// it measures is a statistic nobody can permute.
const quant=(a,p)=>{ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y);
  return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]; };
const mean =(a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length : null;
const sd   =(a)=>{ if(a.length<2) return 0; const m=mean(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-1)); };
function ranks(v){
  const ix=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]); const r=new Array(v.length);
  let i=0; while(i<ix.length){ let j=i; while(j+1<ix.length && ix[j+1][0]===ix[i][0]) j++;
    const av=(i+j)/2+1; for(let k=i;k<=j;k++) r[ix[k][1]]=av; i=j+1; }
  return r;
}
function pearson(x,y){
  const n=x.length; if(n<3||y.length!==n) return null;
  const mx=mean(x), my=mean(y);
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){ const a=x[i]-mx, b=y[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
  return (dx>0&&dy>0)? num/Math.sqrt(dx*dy) : null;
}
const spearman=(x,y)=> (x.length<3)? null : pearson(ranks(x), ranks(y));
// Deterministic PRNG. A permutation test whose answer moves between runs is not a gate.
function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0;
  let t=Math.imul(a^(a>>>15), 1|a); t=(t+Math.imul(t^(t>>>7), 61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296; }; }
function permute(arr, seed){ const a=arr.slice(), rnd=mulberry32(seed);
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; }
  return a; }
// THE statistic §9 has always used: quantile of one population over quantile of the other. It
// constrains the MARGINAL distribution and nothing else — see fit.pairing.
function qratio(model, roster){
  const o={};
  for(const p of [0.25,0.5,0.75,0.9]){
    const mq=quant(model,p), rq=quant(roster,p);
    o['p'+Math.round(p*100)] = (rq>0)? +(mq/rq).toFixed(3) : null;
  }
  return o;
}

// ── source extraction ────────────────────────────────────────────────────────
const HTML = fs.readFileSync(path.join(APP,'index.html'),'utf8');
function inlineBlocks(html){
  const out=[]; const re=/<script([^>]*)>([\s\S]*?)<\/script>/g; let m;
  while((m=re.exec(html))){
    if(/\ssrc\s*=/.test(m[1])) continue;
    out.push({ line: html.slice(0,m.index).split('\n').length, code: m[2] });
  }
  return out;
}
// The deferred data files, in the order the browser runs them — AFTER the inline
// scripts. index.html declares `var PE_COORDS=[]`; loading pe-data.js first lets
// that declaration clobber it and the gate silently sees 0 PE clinics.
const DATA_FILES = ['pe-data.js','vet-clinics.js','vet-staff.js','vet-species.js','vet-services.js'];

// LENGTH-PRESERVING literal stripper: comments, string bodies and regex literals are
// blanked to spaces, newlines kept. Every index into the result is therefore the same
// index into the original, so reported line numbers are exact and the brace-depth walk
// is not fooled by braces inside strings. Template EXPRESSIONS (${...}) are preserved —
// they hold real code.
function stripLiterals(src){
  const a=src.split('');
  const blank=(i,j)=>{ for(let k=i;k<j&&k<a.length;k++) if(a[k]!=='\n') a[k]=' '; };
  let i=0; const n=src.length;
  const prevSig=(p)=>{ let k=p-1; while(k>=0 && /\s/.test(src[k])) k--; return k>=0?src[k]:'\n'; };
  while(i<n){
    const c=src[i], d=src[i+1];
    if(c==='/' && d==='/'){ const s=i; while(i<n && src[i]!=='\n') i++; blank(s,i); continue; }
    if(c==='/' && d==='*'){ const s=i; i+=2; while(i<n && !(src[i]==='*'&&src[i+1]==='/')) i++; i+=2; blank(s,Math.min(i,n)); continue; }
    if(c==='/' && '(,=:[!&|?{};+-*%~^\n'.includes(prevSig(i))){          // regex literal
      const s=i; i++; let cls=false;
      while(i<n){ const ch=src[i];
        if(ch==='\\'){ i+=2; continue; }
        if(ch==='\n') break;
        if(ch==='[') cls=true;
        else if(ch===']') cls=false;
        else if(ch==='/' && !cls){ i++; break; }
        i++; }
      while(i<n && /[a-z]/.test(src[i])) i++;
      blank(s,i); continue;
    }
    if(c==='"' || c==="'" || c==='`'){
      const q=c; let s=++i;
      while(i<n){
        if(src[i]==='\\'){ i+=2; continue; }
        if(src[i]===q){ blank(s,i); i++; break; }
        if(q==='`' && src[i]==='$' && src[i+1]==='{'){
          // The expression is CODE and must survive — but the strings INSIDE it are not, and
          // leaving them raw leaks their prose into every token scan. A real false positive this
          // caused: `didn\'t` inside a template expression parses as a bare identifier `t`.
          // So: find the expression's extent (skipping over quoted runs so a brace inside a
          // string cannot end it early), then strip it recursively and splice the result back.
          blank(s,i); const es=i+2; let depth=1; i+=2;
          while(i<n && depth>0){
            const ch=src[i];
            if(ch==='\\'){ i+=2; continue; }
            if(ch==='"'||ch==="'"||ch==='`'){ const qq=ch; i++;
              while(i<n){ if(src[i]==='\\'){i+=2;continue;} if(src[i]===qq){i++;break;} if(qq!=='`'&&src[i]==='\n') break; i++; }
              continue; }
            if(ch==='{')depth++; else if(ch==='}')depth--;
            i++;
          }
          const inner=stripLiterals(src.slice(es,Math.max(es,i-1)));
          for(let k=0;k<inner.length;k++) a[es+k]=inner[k];
          s=i; continue;
        }
        if(q!=='`' && src[i]==='\n'){ blank(s,i); break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return a.join('');
}
function endOfFunction(clean, at){
  let i=clean.indexOf('{', at), depth=0;
  for(; i<clean.length; i++){
    if(clean[i]==='{') depth++;
    else if(clean[i]==='}'){ depth--; if(depth===0) return i+1; }
  }
  return clean.length;
}
const lineAt=(clean, idx, blockLine)=> blockLine + clean.slice(0, idx).split('\n').length - 1;

// ── TDZ scanner (§3) ─────────────────────────────────────────────────────────
// Both shipped TDZ bugs were reads of a `const` from code that runs BEFORE the const's
// line, in the same immediate scope. Distinguishing that from a legal forward reference
// is entirely a question of DEFERRED vs IMMEDIATE scope: a `for`/`if`/bare block runs
// now, a function or arrow body runs later. Everything below exists to draw that line.
const CTRL_HEAD=/(?:^|[^\w$])(if|for|while|switch|catch|with)$/;
// Does the `{` at index i open a DEFERRED body (function decl/expr, method, arrow)?
function opensFunction(s,i){
  let k=i-1; while(k>=0 && /\s/.test(s[k])) k--;
  if(k>=1 && s[k]==='>' && s[k-1]==='=') return true;            // =>{
  if(k<0 || s[k]!==')') return false;                            // `else {`, `try {`, `= {`, bare block
  let d=1; k--;                                                  // walk back to the matching (
  while(k>=0 && d>0){ if(s[k]===')') d++; else if(s[k]==='(') d--; k--; }
  while(k>=0 && /\s/.test(s[k])) k--;
  if(CTRL_HEAD.test(s.slice(Math.max(0,k-24),k+1))) return false;
  return true;                                                   // function f(){ · method(){ · (a,b)=>{
}
// 1 where the index sits inside a nested deferred body (so a read there is legal).
function deferredMask(body){
  const m=new Uint8Array(body.length); const stack=[]; let dd=0;
  for(let i=0;i<body.length;i++){
    const c=body[i];
    if(c==='{'){ const fn=opensFunction(body,i); stack.push(fn); if(fn){ dd++; if(dd===1){ m[i]=1; continue; } } }
    m[i]=dd>0?1:0;
    if(c==='}'){ const fn=stack.pop(); if(fn){ dd--; if(dd===0) m[i]=1; } }
  }
  return m;
}
// Arrow PARAMETER lists — `(a,p)=>`, `x=>`. A parameter is a binding, not a read.
function arrowParamMask(body,mask){
  for(let i=0;i<body.length-1;i++){
    if(body[i]!=='='||body[i+1]!=='>') continue;
    let k=i-1; while(k>=0 && /\s/.test(body[k])) k--;
    if(k<0) continue;
    let j;
    if(body[k]===')'){ let d=1; j=k-1; while(j>=0 && d>0){ if(body[j]===')') d++; else if(body[j]==='(') d--; j--; } }
    else { j=k; while(j>=0 && /[\w$]/.test(body[j])) j--; }
    for(let q=j+1;q<=i+1;q++) mask[q]=1;
  }
  return mask;
}
// BRACELESS arrow bodies — `r=>r._fut`. The body runs from `=>` to the first `,` `;` or
// closing bracket at its own nesting level. Masking the whole STATEMENT instead (the first
// attempt here) was too coarse and silently swallowed a real bug: in
//   const _hasFut = evalFuture && (evalData.resid.some(r=>r._fut) || (_capture && …));
// a `=>` appears earlier in the statement, so the TDZ read of `_capture` was skipped.
function bracelessArrowMask(body,mask){
  for(let i=0;i<body.length-1;i++){
    if(body[i]!=='='||body[i+1]!=='>') continue;
    let j=i+2; while(j<body.length && /\s/.test(body[j])) j++;
    if(body[j]==='{') continue;                                  // braced — deferredMask owns it
    let d=0;
    for(let k=j;k<body.length;k++){
      const c=body[k];
      if(c==='('||c==='['||c==='{') d++;
      else if(c===')'||c===']'||c==='}'){ if(d===0) break; d--; }
      else if((c===','||c===';') && d===0) break;
      mask[k]=1;
    }
  }
  return mask;
}
// One scope: report `const`/`let` names read before their own declaration line.
function tdzScanRange(body, label, lineBase){
  const hits=[];
  const mask=bracelessArrowMask(body, arrowParamMask(body, deferredMask(body)));
  const lineOf=(i)=>lineBase + body.slice(0,i).split('\n').length - 1;
  const declCount={};
  for(const m of body.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g))
    declCount[m[1]]=(declCount[m[1]]||0)+1;
  // Destructuring binds names too (`const [a,b]=x`, `const {s,n:w}=y`). Missing them made a
  // destructured name look singly-declared and its own binding site look like a read.
  for(const m of body.matchAll(/\b(?:const|let|var)\s*[\[{]([^\]}]*)[\]}]/g))
    for(const part of m[1].split(',')){
      const nm=part.split(':').pop().trim().replace(/=.*$/,'').replace(/^\.\.\./,'');
      if(/^[A-Za-z_$][\w$]*$/.test(nm)) declCount[nm]=(declCount[nm]||0)+1;
    }
  for(const m of body.matchAll(/\b(const|let)\s+([A-Za-z_$][\w$]*)/g)){
    if(mask[m.index]) continue;
    if(/\bfor\s*\(\s*$/.test(body.slice(Math.max(0,m.index-8), m.index))) continue;  // loop-scoped binding
    const name=m[2];
    if(declCount[name]>1) continue;               // shadowed somewhere → ambiguous, stay silent
    const use=new RegExp('(?<![.\\w$])'+name.replace(/\$/g,'\\$')+'(?![\\w$])','g');
    for(const u of body.matchAll(use)){
      if(u.index>=m.index) break;
      if(mask[u.index]) continue;
      // object-literal KEY (`{n:0}`, `{c,ci,d:hav()}`) — a name, not a read
      { let b=u.index-1; while(b>=0 && /\s/.test(body[b])) b--;
        if(/^\s*:/.test(body.slice(u.index+name.length, u.index+name.length+6)) && b>=0 && (body[b]==='{'||body[b]===',')) continue; }
      if(/\b(const|let|var|function|class)\s*$/.test(body.slice(Math.max(0,u.index-14),u.index))) continue;
      hits.push({ label, name, useLine:lineOf(u.index), declLine:lineOf(m.index),
                  ctx: body.slice(Math.max(0,u.index-70),u.index+30).replace(/\s+/g,' ').trim() });
      break;
    }
  }
  return hits;
}
function bodyLabel(clean,i){
  const head=clean.slice(Math.max(0,i-160),i);
  let m=/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*$/.exec(head); if(m) return m[1]+'()';
  m=/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*[A-Za-z_$\w]*\s*)?\([^)]*\)\s*(?:=>\s*)?$/.exec(head); if(m) return m[1]+'()';
  m=/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>\s*)?$/.exec(head); if(m) return m[1]+'()';
  m=/([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*$/.exec(head); if(m) return m[1]+'()';
  return '<anonymous>';
}
// Module top level PLUS every function body — declarations, expressions, methods, arrows.
// Restricting to `function NAME(` (the first attempt) missed the arrow-assigned helpers this
// codebase is largely written in, which is where half the scoring chain lives.
function tdzScanSource(src, fileLabel, baseLine=1){
  const clean=stripLiterals(src);
  const lineOf=(i)=>baseLine+clean.slice(0,i).split('\n').length-1;
  let hits=tdzScanRange(clean, fileLabel+' <module>', baseLine);
  for(let i=0;i<clean.length;i++){
    if(clean[i]!=='{' || !opensFunction(clean,i)) continue;
    const be=endOfFunction(clean,i)-1;
    if(be<=i+1) continue;
    hits=hits.concat(tdzScanRange(clean.slice(i+1,be), fileLabel+' '+bodyLabel(clean,i), lineOf(i+1)));
  }
  return hits;
}

// ── stub environment ─────────────────────────────────────────────────────────
// Universally chainable, callable, iterable no-op. Everything the app does to the DOM
// or to Leaflet lands here and returns another one, so no top-level UI code can abort
// the boot. Numeric coercion is 0; `then` is undefined so `await stub` resolves.
function makeStub(){
  return new Proxy(function(){}, {
    get(t,k){
      if(k==='then'||k==='catch'||k==='finally') return undefined;
      if(k===Symbol.toPrimitive) return ()=>0;
      if(k===Symbol.iterator) return function*(){};
      if(k===Symbol.asyncIterator) return undefined;
      if(k===Symbol.toStringTag) return 'Stub';
      if(k==='length') return 0;
      if(k==='toString') return ()=>'';
      if(k==='valueOf') return ()=>0;
      if(k==='constructor') return Object;
      return makeStub();
    },
    set(){return true;}, has(){return true;},
    apply(){return makeStub();}, construct(){return makeStub();},
    deleteProperty(){return true;}, ownKeys(){return [];}, getOwnPropertyDescriptor(){return undefined;}
  });
}

const NET = { local:0, cache:0, live:0, blocked:0, urls:[] };
function localPath(u){
  if(/^https?:/i.test(u)) return null;
  const full=path.join(APP, String(u).split('?')[0].replace(/^\.?\//,''));
  return fs.existsSync(full) ? full : null;
}
const RES  =(t)=>({ok:true ,status:200,headers:{get:()=>null},json:async()=>JSON.parse(t),text:async()=>t});
const NORES=(s)=>({ok:false,status:s  ,headers:{get:()=>null},json:async()=>null      ,text:async()=>''});
async function gateFetch(u){
  const url=String(u), lf=localPath(url);
  if(lf){ NET.local++; return RES(fs.readFileSync(lf,'utf8')); }
  if(/^https?:/i.test(url)){
    const allowed=/^https:\/\/api\.census\.gov\//.test(url);            // the ONLY permitted remote
    const cf=path.join(CACHE,'net-'+crypto.createHash('sha1').update(url).digest('hex').slice(0,16)+'.json');
    if(fs.existsSync(cf)){ NET.cache++; return RES(fs.readFileSync(cf,'utf8')); }
    if(!allowed || process.env.GATE_OFFLINE==='1'){ NET.blocked++; NET.urls.push(url.slice(0,90)); return NORES(0); }
    try{
      NET.live++;
      const r=await fetch(url);
      if(!r.ok) return NORES(r.status);
      const txt=await r.text();
      fs.writeFileSync(cf,txt);
      return RES(txt);
    }catch(e){ NET.blocked++; NET.urls.push(url.slice(0,80)+' ('+e.message+')'); return NORES(0); }
  }
  return NORES(404);
}

function makeContext(){
  const ctx={};
  Object.assign(ctx,{
    globalThis:ctx, window:ctx, self:ctx, top:ctx, parent:ctx,
    console:{log(){},warn(){},error(){},info(){},debug(){},table(){},group(){},groupEnd(){},time(){},timeEnd(){}},
    setTimeout:()=>0, clearTimeout:()=>{}, setInterval:()=>0, clearInterval:()=>{},
    requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{},
    requestIdleCallback:()=>0, cancelIdleCallback:()=>{},
    queueMicrotask:(fn)=>{ try{fn();}catch(_){} },
    addEventListener:()=>{}, removeEventListener:()=>{}, dispatchEvent:()=>true,
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}),
    localStorage:{ _d:Object.create(null), length:0,
      getItem(k){ return this._d[k]!==undefined?this._d[k]:null; },
      setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; },
      clear(){ this._d=Object.create(null); }, key(){ return null; } },
    navigator:{ userAgent:'vetric-eval-gate', language:'en-US', languages:['en-US'], onLine:true,
                clipboard:{ writeText:async()=>{} }, geolocation:{ getCurrentPosition(){} } },
    location:{ href:'https://vetric.co/', hostname:'vetric.co', host:'vetric.co',
               origin:'https://vetric.co', protocol:'https:', pathname:'/', search:'', hash:'',
               assign(){}, replace(){}, reload(){} },
    history:{ pushState(){}, replaceState(){}, back(){}, forward(){} },
    document: makeStub(), L: makeStub(), fetch: gateFetch,
    XMLHttpRequest: class{ open(){} send(){} setRequestHeader(){} addEventListener(){} },
    AbortController: class{ constructor(){ this.signal={aborted:false,addEventListener(){}}; } abort(){} },
    Blob: class{}, File: class{}, FileReader: class{ readAsText(){} addEventListener(){} },
    URL:{ createObjectURL:()=>'blob:', revokeObjectURL:()=>{} },
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
    alert:()=>{}, confirm:()=>false, prompt:()=>null,
    performance:{ now:()=>Date.now(), mark(){}, measure(){} },
    crypto:{ getRandomValues:(a)=>{ for(let i=0;i<a.length;i++) a[i]=(i*2654435761)>>>0; return a; },
             randomUUID:()=>'00000000-0000-4000-8000-000000000000' },
    Image: class{ set src(_v){} addEventListener(){} }, Audio: class{ play(){} },
    print:()=>{}, open:()=>makeStub(), close:()=>{}, focus:()=>{}, scrollTo:()=>{},
    innerWidth:1440, innerHeight:900, devicePixelRatio:1,
    CustomEvent: class{ constructor(t,o){ this.type=t; Object.assign(this,o||{}); } },
    Event: class{ constructor(t){ this.type=t; } }, MouseEvent: class{ constructor(t){ this.type=t; } },
    getComputedStyle:()=>makeStub(), getSelection:()=>({toString:()=>''}),
    IntersectionObserver: class{ observe(){} disconnect(){} },
    ResizeObserver: class{ observe(){} disconnect(){} },
    MutationObserver: class{ observe(){} disconnect(){} }
  });
  ctx.sessionStorage=ctx.localStorage;
  return vm.createContext(ctx);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. BOOT — the app evaluates end to end.
// ═════════════════════════════════════════════════════════════════════════════
section('1. boot — the app evaluates end to end');
const blocks = inlineBlocks(HTML);
const ctx = makeContext();
let booted = true;
if (blocks.length < 2){ fail('boot.blocks','no inline <script> blocks found — the extractor is out of date'); booted=false; }
for (const b of blocks){
  try { vm.runInContext(b.code, ctx, {filename:'index.html:'+b.line}); }
  catch(e){ booted=false;
    fail('boot.script', `inline <script> at index.html:${b.line} threw`,
         e.constructor.name+': '+e.message+'\n'+String(e.stack||'').split('\n').slice(0,3).join('\n')); }
}
for (const f of DATA_FILES){
  const p=path.join(APP,f);
  if(!fs.existsSync(p)){ warn('boot.data', f+' missing — app degrades gracefully, gate coverage reduced'); continue; }
  try { vm.runInContext(fs.readFileSync(p,'utf8'), ctx, {filename:f}); }
  catch(e){ booted=false; fail('boot.data', f+' threw', e.constructor.name+': '+e.message); }
}
if(!booted) finish();
try { vm.runInContext('peLoaded=true;', ctx); } catch(_){}
const run      = (src)=>vm.runInContext(src, ctx, {filename:'gate'});
// trailing newline: src ends in a // comment, which would otherwise swallow the closing `})()`
const runAsync = (src)=>vm.runInContext('(async()=>{'+src+'\n})()', ctx, {filename:'gate'});
{
  const pe=run('typeof PE_COORDS!=="undefined"?PE_COORDS.length:0');
  const vc=run('typeof VET_CLINICS!=="undefined"?VET_CLINICS.length:0');
  const vs=run('typeof VET_STAFF!=="undefined"?Object.keys(VET_STAFF).length:0');
  if(pe>500 && vc>2000 && vs>1000) pass('boot.datasets', `PE ${pe} · clinics ${vc} · rosters ${vs}`);
  else fail('boot.datasets', `datasets look wrong — PE ${pe} · clinics ${vc} · rosters ${vs}`,
            'PE 0 means the data files ran BEFORE the inline scripts (index.html re-declares var PE_COORDS=[])');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. STATIC — every identifier the capture path references is DEFINED.
//    The CATCH_REACH_FULL class. Checked statically as well as by the run below,
//    because a constant referenced on a branch the gate does not exercise would
//    otherwise sail through.
// ═════════════════════════════════════════════════════════════════════════════
section('2. static — capture-path identifiers resolve');
const MAIN = blocks.reduce((a,b)=> b.code.length>a.code.length ? b : a, blocks[0]);
const CLEAN = stripLiterals(MAIN.code);
const CAP_START = CLEAN.indexOf("let EVAL_MODEL=");
const FN_AT     = CLEAN.indexOf('function _evalComputeAndRender(');
if (CAP_START<0 || FN_AT<0){
  fail('static.anchors','could not locate the capture block / _evalComputeAndRender',
       'the anchors in eval-gate.mjs need updating — this is the gate failing safe, not the app being broken');
} else {
  const region = CLEAN.slice(CAP_START, endOfFunction(CLEAN, FN_AT));
  // Names the capture path owns. Everything else (Math, Object, app-wide helpers) is
  // out of scope for this scan and is covered by actually running the thing.
  const TOK=/\b(?:CATCH_[A-Z0-9_]+|EVAL_[A-Z0-9_]+|OPP_[A-Z0-9_]+|DVM_[A-Z0-9_]+|REV_[A-Z0-9_]+|TX_[A-Z0-9_]+|A_OWN|GAMMA|PE_NEAR_HARD|SITE_[A-Z0-9_]+|_catch[A-Za-z0-9_]*|_eval[A-Za-z0-9_]*|_grav[A-Za-z0-9_]*|_staffW|_revW|_barrierDist|_capNearRetailM|_mpc[A-Za-z0-9_]*|_zoneClassAt|_cellAffl|_cellAgeF|_tractPetW)\b/g;
  const referenced=new Set(region.match(TOK)||[]);
  // Declared anywhere in the region counts, including function-locals, the 2nd..nth
  // declarator of a multi-name statement (`const A_OWN=…, GAMMA=1.0, PE_NEAR_HARD=700`)
  // and destructured bindings.
  const declared=new Set();
  for(const m of region.matchAll(/(?:\b(?:const|let|var|function|class)\s+|,\s*)([A-Za-z_$][\w$]*)\s*(?==[^=]|\(|,|;|\s)/g)) declared.add(m[1]);
  for(const m of region.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g))
    for(const part of m[1].split(',')){ const nm=part.split(':').pop().trim().replace(/=.*/,''); if(nm) declared.add(nm); }
  const missing=[];
  for(const name of referenced){
    if(declared.has(name)) continue;
    let t; try{ t=run(`(function(){ try{ return typeof ${name}; }catch(e){ return 'TDZ'; } })()`); }catch(_){ t='ERR'; }
    if(t==='undefined'||t==='TDZ'||t==='ERR') missing.push(`${name} (${t})`);
  }
  if(!missing.length) pass('static.identifiers', `${referenced.size} capture-path identifiers, all resolvable`);
  else fail('static.identifiers', `${missing.length} referenced but NOT DEFINED`, missing.join(', '));
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. STATIC — no const/let read above its own declaration in the scoring path.
//    Short-circuit evaluation hides this on the happy path and throws
//    ReferenceError everywhere else, which is exactly how it ships unnoticed.
// ═════════════════════════════════════════════════════════════════════════════
section('3. static — no use-before-declaration (index.html + build scripts)');
{
  // index.html: EVERY inline block, module level and every function body — not a hand-listed
  // set of capture functions. A TDZ read presents as the analysis hanging, so relying on a
  // scenario to reach it is exactly the mistake that let `_capture` ship.
  let hits=[];
  for(const b of blocks) hits=hits.concat(tdzScanSource(b.code, 'index.html', b.line));
  if(!hits.length) pass('static.tdz', `index.html — ${blocks.length} inline blocks scanned, no const/let read above its declaration`);
  else fail('static.tdz', `${hits.length} use-before-declaration — ReferenceError on every path that reaches it`,
       hits.map(h=>`${h.label}: '${h.name}' read at index.html:${h.useLine}, declared at index.html:${h.declLine}\n    ${h.ctx}`).join('\n'));

  // The build scripts produce the capture artifact and every data file the app reads. They
  // are never executed here (build-catchments.mjs needs Docker + local OSRM), so the static
  // scan is the ONLY coverage they get — and it is where `staffW` shipped read-before-declared,
  // which silently flattened every competitor to one weight while still writing a plausible file.
  const BUILDS=fs.readdirSync(APP).filter(f=>/^build-.*\.mjs$/.test(f)).sort();
  let bhits=[];
  for(const f of BUILDS){
    try { bhits=bhits.concat(tdzScanSource(fs.readFileSync(path.join(APP,f),'utf8'), f)); }
    catch(e){ warn('static.tdz.build', f+' unreadable — skipped', e.message); }
  }
  if(!BUILDS.length) warn('static.tdz.build','no build-*.mjs found next to index.html');
  else if(!bhits.length) pass('static.tdz.build', `${BUILDS.length} build scripts scanned, none reads a const/let above its declaration`);
  else fail('static.tdz.build', `${bhits.length} use-before-declaration in the build chain`,
       bhits.map(h=>`${h.label}: '${h.name}' read at line ${h.useLine}, declared at ${h.declLine}\n    ${h.ctx}`).join('\n'));
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. DATA — the app loads its own inputs (no replica of the pet model, no replica
//    of the Census parse; if those drift, the gate drifts with them, on purpose).
// ═════════════════════════════════════════════════════════════════════════════
section('4. data — the app loads its own inputs');
{
  const t0=Date.now();
  try {
    await runAsync(`await _ensureEvalDemographics();   // tracts, MPC, income, age, pet model, catchments
                    await _loadOppRetail();            // static commercial fabric = the capture siting gate`);
  } catch(e){ fail('data.load','_ensureEvalDemographics threw', e.constructor.name+': '+e.message); }
  DATA={
    dogZips:  run('Object.keys(dogData).length'),
    income:   run('Object.keys(modelIncome).length'),
    cells:    run('_catchData? Object.keys(_catchData.cells).length : 0'),
    clinics:  run('_catchData? _catchData.clinics.length : 0'),
    artifact: run('_catchData? (_catchData.v||null) : null'),
    retail:   run('_oppRetailPts? _oppRetailPts.length : 0'),
    tracts:   run('_tractsGeo? _tractsGeo.features.length : 0'),
    mpc:      run('_mpcData? _mpcData.list.length : 0'),
    zips:     run('_zipGeoCache? _zipGeoCache.features.length : 0'),
    seconds:  +((Date.now()-t0)/1000).toFixed(1)
  };
  if(DATA.dogZips>1000 && DATA.income>1000) pass('data.census', `pet model ${DATA.dogZips} ZIPs · income ${DATA.income} ZIPs`);
  else fail('data.census', `Census inputs thin — pet ${DATA.dogZips} ZIPs, income ${DATA.income}`,
            NET.blocked? 'blocked: '+NET.urls.slice(0,3).join(' ; ') : 'inspect research/.gate-cache/');
  if(DATA.cells>1000) pass('data.artifact', `dfw-catchments v${DATA.artifact} · ${DATA.cells} cells · ${DATA.clinics} clinics`);
  else fail('data.artifact','dfw-catchments.json missing or unreadable — the capture model cannot run','cells='+DATA.cells);
  if(DATA.retail>1000) pass('data.retail', `${DATA.retail} commercial-fabric points`);
  else fail('data.retail', `dfw-retail.json thin (${DATA.retail}) — capture mode would pass every cell as siteable`);
  if(!JSON_OUT) console.log(`        ${C.d}tracts ${DATA.tracts} · MPC ${DATA.mpc} · ZIP polys ${DATA.zips} · `+
    `net ${NET.local} local / ${NET.cache} cached / ${NET.live} live / ${NET.blocked} blocked · ${DATA.seconds}s${C.n}`);
}

// Silence the render layer: pure DOM/Leaflet, so against a stub it would measure the stub.
run(`for(const k of ['_evalRenderLayers','_evalRenderSidebar','_evalRingSettle','_lpHaloSettle',
                     '_evalLockMap','_evalClearDrive','_evalHideLegend','_evalClearLayers',
                     '_evalRenderUnavailable','_metroSnapSites','vfToast','_evalStage'])
       globalThis[k]=function(){};
     globalThis.__savedMpc=_mpcData;
     globalThis.__zipFeat=z=>((_zipGeoCache&&_zipGeoCache.features)||[]).find(f=>f.properties.zip===z)||null;
     globalThis.__box=(la,lo,mi)=>{ const dLa=mi/69, dLo=mi/(69*Math.cos(la*Math.PI/180));
       return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[
         [lo-dLo,la-dLa],[lo+dLo,la-dLa],[lo+dLo,la+dLa],[lo-dLo,la+dLa],[lo-dLo,la-dLa]]]}}; };
     // Commercial fabric as an eval-context layer, straight from the static dfw-retail set.
     // Small-bbox runs DO get OSM retail in production; this stands in for it without a
     // network call. Metro deliberately does NOT use it — see CTX_METRO.
     globalThis.__retailIn=(f)=>{ const bb=_evalBBox(f), out=[];
       for(const p of (_oppRetailPts||[]))
         if(p[0]>=bb.minLa-0.05&&p[0]<=bb.maxLa+0.05&&p[1]>=bb.minLo-0.05&&p[1]<=bb.maxLo+0.05) out.push({lat:p[0],lon:p[1]});
       return out; };`);

// ═════════════════════════════════════════════════════════════════════════════
// 5. SCENARIOS — every entry point into the scoring function must complete.
// ═════════════════════════════════════════════════════════════════════════════
section('5. scenarios — every evaluation entry point completes');
// CONTEXT. _evalFetchContext is not called (network). Two stand-ins:
//  * CTX_METRO reproduces the MEASURED metro condition — at region bbox Overpass
//    returns nothing (resid 0, retail 0, osmLU 0) and the zoning/parcel services cap
//    out, so capture runs on the artifact + static dfw-retail alone. `roads` is flagged
//    present with an EMPTY segment list: that holds road access at one constant
//    (_clsVis(2)=0.26 -> accessMult 0.754) for every cell, so it cannot reorder
//    anything, and it keeps the function past its "no roads AND no retail" refusal.
//  * CTX_LOCAL adds the static commercial fabric as evalData.retail, which is what a
//    small-bbox run really gets from OSM. It switches on g.ret, the retailBonus and the
//    EVAL_RET_MIN half of _evalStrongOK — paths CTX_METRO cannot reach.
const CTX_METRO = `evalData={vets:[],retail:[],resid:[],roads:[],aadt:[],zoning:[],osmLU:[],parcels:[]};
                   evalDataOk={retail:false,roads:true,resid:false,aadt:false,zoning:false,parcels:false};`;
const CTX_LOCAL = `evalData={vets:[],retail:__retailIn(evalFeat),resid:[],roads:[],aadt:[],zoning:[],osmLU:[],parcels:[]};
                   evalDataOk={retail:evalData.retail.length>0,roads:true,resid:false,aadt:false,zoning:false,parcels:false};`;

function scenario(id, setup, { local=false, collect=false }={}){
  const t0=Date.now();
  try{
    // One IIFE: `const` at the top level of a vm Script lands in the context's GLOBAL
    // lexical scope and survives, so a second scenario declaring the same name is a
    // SyntaxError. Scoping the whole preamble keeps each run independent.
    run(`(function(){
      evalActive=true; evalZip=null; evalAreaZips=null; evalZipAffluence=0.5;
      evalNoLand=false; evalFuture=true; evalRadiusMi=3; evalZoning=true;
      evalSitePt=null; evalSiteCell=null; _evalSubject=null;
      evalCells=[]; evalTop=[]; evalLandPlays=[]; evalLandStat=null; evalCaptureOn=false;
      evalTopMode=null; evalSat=null; EVAL_MODEL='capture'; _mpcData=globalThis.__savedMpc;
      ${setup}
      ${local?CTX_LOCAL:CTX_METRO}
    })();`);
    // A missing ZIP polygon is a DATA change, not a code bug — say so rather than
    // letting a null feature surface as a TypeError deep inside the scoring function.
    if(!run('!!evalFeat')) return { id, ok:false, skip:true, err:'evalFeat is null — the fixture ZIP is not in tx-zips.json' };
    run('_evalComputeAndRender()');
  }catch(e){
    return { id, ok:false, err:e.constructor.name+': '+e.message,
             at:String(e.stack||'').split('\n').slice(1,3).map(s=>s.trim()).join(' | ') };
  }
  const r=Object.assign({ id, ok:true, ms:Date.now()-t0 }, JSON.parse(run(`JSON.stringify({
    capture:evalCaptureOn, cells:evalCells.length, top:evalTop.length, land:evalLandPlays.length,
    landStat:evalLandStat, mode:evalTopMode, forced:!!evalSiteCell,
    ceil:evalSat? +evalSat.capCeil.toFixed(4):null,
    bestDisp: evalTop.length? _evalDisp(evalTop[0].score):null,
    // ── ENGINE-SCALE CENSUS (bug class 5) ──────────────────────────────────────────────
    // _applyCapture sets cEq and cShare TOGETHER and early-returns before either when there
    // is no catchment cell, so (cEq!=null && cShare!=null) is exactly "this cell carries
    // MEASURED capture numbers". Any cell without them was scored by the crow-flies product,
    // whose units are not the same thing — and it is still sorted, tiered and displayed
    // beside the measured ones. Count both populations rather than trusting evalCaptureOn.
    capCells: evalCells.filter(g=>g.cEq!=null&&g.cShare!=null).length,
    gravCells:evalCells.filter(g=>!(g.cEq!=null&&g.cShare!=null)).length,
    capLand:  evalLandPlays.filter(g=>g.cEqFut!=null&&g.cFutTot>0).length,
    capStat:  evalCapStat? {cov:+evalCapStat.cov.toFixed(4),on:evalCapStat.on,pin:evalCapStat.pin,skipped:evalCapStat.skipped} : null,
    sepMi:    (typeof evalSepMi==='number')? +evalSepMi.toFixed(3) : null,
    // closest pair among the returned picks, in miles — must clear sepMi by construction
    minPairMi: (function(){ let m=null;
      for(let i=0;i<evalTop.length;i++) for(let j=i+1;j<evalTop.length;j++){
        const d=Math.hypot((evalTop[i].la-evalTop[j].la)*69.0,
                           (evalTop[i].lo-evalTop[j].lo)*69.0*Math.cos(evalTop[i].la*Math.PI/180));
        if(m===null||d<m) m=d; }
      return m===null?null:+m.toFixed(3); })() })`)));
  if(collect) collectMetro();
  return r;
}
const METRO_FEAT = `evalAreaMode=true; const rg=oppRegion;
  evalFeat={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[
    [rg.w,rg.s],[rg.e,rg.s],[rg.e,rg.n],[rg.w,rg.n],[rg.w,rg.s]]]}};`;

function collectMetro(){
  DIST=JSON.parse(run(`(function(){
    const q=(a,p)=>{ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y);
      return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]; };
    const stat=k=>{ const a=evalCells.map(g=>g[k]).filter(v=>typeof v==='number'&&isFinite(v));
      return a.length? {n:a.length,min:+q(a,0).toFixed(4),p10:+q(a,.10).toFixed(4),p50:+q(a,.50).toFixed(4),
                        p90:+q(a,.90).toFixed(4),max:+q(a,1).toFixed(4)} : null; };
    return JSON.stringify({score:stat('score'),share:stat('share'),cEq:stat('cEq'),winRev:stat('winRev'),
                           demandN:stat('demandN'),cReach:stat('cReach'),cFutTot:stat('cFutTot')});
  })()`));
  // The reported capture share is the equilibrium RESIDUAL, not a competitive measurement:
  // _catchEquilibrium solves reach*share(n) = n*CAP and the caller then reports win/reach, so
  // share == n*CAP/reach identically. Pinned here so the day somebody changes one half without
  // the other, the gate says which number stopped meaning what it says on the card.
  IDENT=JSON.parse(run(`(function(){
    let n=0, clamped=0, worst=0, sum=0; const errs=[];
    for(const g of evalCells){
      if(g.cEq==null || g.cShare==null || !(g.cReach>0)) continue;
      if(g.cEq<=0.0501 || g.cEq>=39.99){ clamped++; continue; }   // bisection bracket bounds
      const pred=g.cEq*DVM_VISIT_CAPACITY/g.cReach;
      const e=Math.abs(g.cShare-pred)/Math.max(g.cShare,1e-12);
      errs.push(e); if(e>worst) worst=e; sum+=e; n++;
    }
    errs.sort((a,b)=>a-b);
    return JSON.stringify({ n, clamped, cap:DVM_VISIT_CAPACITY,
      worst, mean:n?sum/n:null, p99:n? errs[Math.min(n-1,Math.floor(0.99*(n-1)))] : null });
  })()`));
  GATES=JSON.parse(run(`(function(){
    const n=evalCells.length, pool=(evalLandStat&&evalLandStat.pool)||0;
    return JSON.stringify({ candidates:n+pool, siteable:n, landPool:pool,
      strong:evalCells.filter(g=>_evalStrongOK(g)).length,
      scoreBar:evalCells.filter(g=>g.score>=EVAL_STRONG).length,
      floor:evalCells.filter(g=>g.score>=EVAL_FLOOR).length,
      EVAL_STRONG, EVAL_FLOOR, EVAL_RET_MIN, retailOn:evalDataOk.retail });
  })()`));
}

const SCENARIOS=[
  // Evaluate Metroplex: the catchment cells ARE the candidates.
  ['metro',          METRO_FEAT, {collect:true}],
  // A ZIP with announced development nearby — the gravity MPC injection fires.
  ['zip-mpc',        `evalAreaMode=false; evalZip='75009'; evalFeat=__zipFeat('75009');`, {local:true}],
  // A ZIP with NO announced development — the injection produces nothing. This is the
  // MAJORITY case (206 of 291 DFW ZIPs; 1,854 of 1,939 statewide) and the one that
  // exposes anything reading a capture variable through a short-circuited ||.
  ['zip-no-mpc',     `evalAreaMode=false; evalZip='75024'; evalFeat=__zipFeat('75024');`, {local:true}],
  // Outside the artifact bbox: _catchCovers false, so it must fall back to gravity.
  ['zip-off-region', `evalAreaMode=false; evalZip='77006'; evalFeat=__zipFeat('77006');`, {local:true}],
  // THE FRINGE. _catchCovers(bb) is true so capture engages, but only ~58% of the candidate grid
  // has a measured catchment — the exact band (50-95%) where the mixed-scale bug lives. Every
  // other fixture sits deep inside DFW at ~100% coverage, where an unmeasured candidate does not
  // exist and §6b cannot see the defect at all. Found by scanning all 1,939 ZIP polygons for
  // 0.5 < coverage < 0.95; 75032 (Rockwall) sits mid-band with ~550 unmeasured candidates.
  ['zip-fringe',     `evalAreaMode=false; evalZip='75032'; evalFeat=__zipFeat('75032');`, {local:true}],
  // Drop-a-site: the fine 36x36 grid plus a forced cell borrowing the nearest catchment.
  ['drop-site',      `evalAreaMode=true; evalSitePt={lat:33.3245,lon:-96.7847}; evalFeat=__box(33.3245,-96.7847,2);`, {local:true}],
  // Clinic evaluation: the incumbent branch — real roster, subject removed from its own
  // competitor distribution, no equilibrium solve.
  ['clinic',         `evalAreaMode=true; evalSitePt={lat:33.0125,lon:-97.1069};
                      _evalSubject={la:33.0125,lo:-97.1069,name:'gate subject',dvm:4};
                      evalFeat=__box(33.0125,-97.1069,2);`, {local:true}],
  // Land-play refine handoff: evalNoLand must suppress land plays and still return sites.
  ['no-land-refine', `evalAreaMode=true; evalNoLand=true; evalSitePt={lat:33.3245,lon:-96.7847};
                      evalFeat=__box(33.3245,-96.7847,2);`, {local:true}],
  // The documented revert switch must still produce a working evaluation. Pointed at a ZIP with
  // NO MPCs on purpose: on an MPC-bearing ZIP the `evalData.resid.some(r=>r._fut)` half of _hasFut
  // short-circuits before anything capture-related is read, so the scenario passes without ever
  // exercising gravity mode. That is precisely how the `_capture` TDZ survived a green run — and
  // EVAL_MODEL='gravity' does NOT rescue a TDZ, because it fires on the binding, not the value.
  ['gravity-revert', `evalAreaMode=false; evalZip='75024'; evalFeat=__zipFeat('75024'); EVAL_MODEL='gravity';`, {local:true}],
  // The MPC file failing to load must not take every evaluation down with it. Same blast radius
  // as the TDZ (`_mpcData=null` -> no _fut points anywhere -> the short-circuit stops protecting
  // you), but reachable in production by a 404 on dfw-mpc.json.
  ['zip-no-mpc-data', `evalAreaMode=false; evalZip='75024'; evalFeat=__zipFeat('75024'); _mpcData=null;`, {local:true}],
  // Regression test for the land-play fix: capture-mode land plays must come from the
  // artifact's own fu[band], NOT from the gravity MPC injection. Nulling _mpcData is the
  // only way to tell them apart — on the metro bbox both are normally present.
  ['metro-no-mpc',   METRO_FEAT+' _mpcData=null;']
];
for(const [id,setup,opt] of SCENARIOS){
  const r=scenario(id,setup,opt||{});
  SC[id]=r;
  if(r.ok) pass('scenario.'+id, `cells ${String(r.cells).padStart(5)} · sites ${r.top} · land ${r.land} · capture ${r.capture} · ${(r.ms/1000).toFixed(1)}s`);
  else if(r.skip) warn('scenario.'+id, 'fixture unavailable — scenario skipped', r.err);
  else fail('scenario.'+id, 'threw — this evaluation is dead for every user who reaches it', r.err+'\n'+r.at);
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. OUTPUT — sites and land plays are non-empty on a representative area.
// ═════════════════════════════════════════════════════════════════════════════
section('6. output — sites and land plays are non-empty');
{
  const m=SC['metro'];
  if(!m||!m.ok) fail('output.sites','metro run did not complete — nothing to assert');
  else{
    if(m.top>=1) pass('output.sites', `${m.top} sites (metro expects 5) · best displays ${m.bestDisp}/100 · mode '${m.mode}'`);
    else fail('output.sites','metro run produced ZERO sites');
    if(m.land>=1) pass('output.land', `${m.land} land plays`);
    else fail('output.land','metro run produced ZERO land plays',
      'funnel: '+JSON.stringify(m.landStat)+(m.landStat===null?'  (null = landGrid empty: every candidate passed the siting gate)':''));
    if(m.landStat){
      const s=m.landStat, stages=[['pool',s.pool],['afterDemand',s.afterDemand],['afterResid',s.afterResid],['afterBuilt',s.afterBuilt]];
      const z=stages.find(([,v])=>v===0);
      if(z) warn('output.landfunnel',`land funnel collapses at '${z[0]}'`, JSON.stringify(s));
      else pass('output.landfunnel',`pool ${s.pool} → demand ${s.afterDemand} → resid ${s.afterResid} → built ${s.afterBuilt}`);
    }
  }
  const n=SC['metro-no-mpc'];
  if(n&&n.ok){
    if(n.land>=1) pass('output.land-no-mpc', `${n.land} land plays with the gravity MPC injection disabled (they come from fu[band], as designed)`);
    else fail('output.land-no-mpc','capture-mode land plays VANISH without the gravity MPC injection',
      'capture is supposed to carry its own future demand in fu[band]; it is leaning on the crow-flies injector');
  }
  const nl=SC['no-land-refine'];
  if(nl&&nl.ok){
    if(nl.land===0 && nl.top>=1) pass('output.no-land','evalNoLand suppresses land plays and still returns sites');
    else warn('output.no-land',`evalNoLand handoff looks wrong — land ${nl.land}, sites ${nl.top}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6b. ENGINE SCALE — one run, one engine. A capture score is winnable revenue over
//     CATCH_REV_FULL (median cell ~0.05); the gravity product pins near its 0.85 share
//     cap in open country. Ranking the two together is meaningless and lets an
//     UNMEASURED cell outrank every measured one — it shipped exactly once, and the
//     symptom was a recommended site in the middle of nowhere, not an error.
// ═════════════════════════════════════════════════════════════════════════════
section('6b. engine scale — capture and gravity are never mixed in one ranking');
{
  let mixed=0, checked=0;
  for(const id of Object.keys(SC)){
    const r=SC[id]; if(!r||!r.ok) continue;
    checked++;
    if(r.capture){
      // Capture run: every scored cell must carry measured numbers. Unmeasured candidates are
      // supposed to be DROPPED (evalCapStat.skipped), not silently gravity-scored and ranked.
      if(r.gravCells>0){ mixed++;
        fail('scale.'+id, `capture run ranks ${r.gravCells} crow-flies cells beside ${r.capCells} measured ones`,
             'a cell with no catchment kept its gravity score and is being sorted/tiered against revenue-scaled cells; '+
             'capStat '+JSON.stringify(r.capStat)); }
      else if(r.land>0 && r.capLand!==r.land){ mixed++;
        fail('scale.'+id, `capture run returns ${r.land-r.capLand} of ${r.land} land plays on the gravity scale`,
             'land plays must be scored on fu[band] through the same rings as the sites beside them'); }
      else pass('scale.'+id, `${r.capCells} cells measured · 0 gravity-scored · ${r.capStat?r.capStat.skipped:0} unmeasured candidates dropped · land ${r.capLand}/${r.land}`);
    } else {
      // Gravity run (outside the artifact, coverage <50%, or EVAL_MODEL='gravity'): the inverse
      // invariant. A stray measured cell here is the same defect with the signs reversed.
      if(r.capCells>0){ mixed++;
        fail('scale.'+id, `gravity run contains ${r.capCells} capture-scored cells`,
             'capStat '+JSON.stringify(r.capStat)); }
      else pass('scale.'+id, `${r.cells} cells, all crow-flies · capture off`);
    }
  }
  // evalCapStat is what the sidebar's honesty banner reads. If it disagrees with the cells, the
  // user is told one thing and shown another.
  for(const id of Object.keys(SC)){
    const r=SC[id]; if(!r||!r.ok||!r.capStat) continue;
    if(r.capStat.on!==r.capture) fail('scale.stat.'+id,'evalCapStat.on disagrees with evalCaptureOn',JSON.stringify(r.capStat));
    else if(r.capStat.on && r.capStat.cov<0.5) fail('scale.stat.'+id,`capture ran at ${(r.capStat.cov*100).toFixed(1)}% coverage — below the documented 50% floor`);
  }
  if(!checked) fail('scale.collect','no scenario completed — nothing to check');

  // Metro pick separation is now derived from EVAL_CANNIBAL_MAX (the same 25% trade-area overlap
  // the cannibalisation advisory uses), not from the bbox. A silent revert to the proportional
  // rule reads as ~19 mi at DFW scale and hides whole corridors; a broken solve reads as ~0.
  const m=SC['metro'];
  if(m&&m.ok){
    if(m.sepMi==null) fail('sep.metro','evalSepMi was never set on the metro run');
    else if(m.sepMi<2||m.sepMi>6) fail('sep.metro',`metro separation ${m.sepMi} mi is outside the 2-6 mi band the EVAL_CANNIBAL_MAX solve produces`,
      'derived value at DFW scale is ~3.5 mi; ~19 mi means the bbox-proportional rule came back, ~0 means the overlap solve failed');
    else if(m.minPairMi!=null && m.minPairMi<m.sepMi) fail('sep.metro',`two picks sit ${m.minPairMi} mi apart, inside the ${m.sepMi} mi minimum`);
    else pass('sep.metro', `picks held ${m.sepMi} mi apart (EVAL_CANNIBAL_MAX solve) · closest pair ${m.minPairMi==null?'n/a':m.minPairMi+' mi'}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. DISTRIBUTIONS — the scored field is not degenerate.
// ═════════════════════════════════════════════════════════════════════════════
section('7. distributions — the scored field is not degenerate');
if(!DIST) fail('dist.collect','no metro distribution was collected');
else{
  const s=DIST.score;
  if(!s) fail('dist.score','no scored cells');
  else if(s.p50<=0) fail('dist.score','median score is ZERO — the scoring loop produces nothing', JSON.stringify(s));
  else if(s.p10>=0.999) fail('dist.score','the field is saturated at the cap — the anchor is wrong', JSON.stringify(s));
  else pass('dist.score', `min ${s.min} · p10 ${s.p10} · p50 ${s.p50} · p90 ${s.p90} · max ${s.max}`);
  const e=DIST.cEq;
  if(!e) fail('dist.cEq','no equilibrium sizes — _catchEquilibrium never ran');
  else if(e.p50<=0.06 || e.max>=39) fail('dist.cEq','the equilibrium solver is pinned at a bracket bound', JSON.stringify(e));
  else pass('dist.cEq', `supportable DVMs  p10 ${e.p10} · p50 ${e.p50} · p90 ${e.p90} · max ${e.max}`);
  const sh=DIST.share;
  if(!sh) fail('dist.share','no capture shares');
  else if(sh.p50<=0) fail('dist.share','median capture share is ZERO', JSON.stringify(sh));
  else if(sh.p10>0.85) fail('dist.share','every cell reads uncontested — competitors are not being counted', JSON.stringify(sh));
  else pass('dist.share', `capture share  p10 ${sh.p10} · p50 ${sh.p50} · p90 ${sh.p90} · max ${sh.max}`);
  const r=DIST.winRev;
  if(r&&r.p50>0) pass('dist.winRev', `winnable revenue  p50 $${Math.round(r.p50).toLocaleString()} · p90 $${Math.round(r.p90).toLocaleString()} · max $${Math.round(r.max).toLocaleString()}`);
  else fail('dist.winRev','winnable revenue is zero across the field', JSON.stringify(r));
}

// ═════════════════════════════════════════════════════════════════════════════
// 7b. IDENTITY — the number the cards call "capture share" is an ACCOUNTING
//     RESIDUAL. _catchEquilibrium solves reach*share(n) = n*DVM_VISIT_CAPACITY by
//     bisection; the caller then reports win/reach. Substituting the solved
//     condition gives share == n*CAP/reach, exactly. So "share 20%" is not a
//     competitive finding — it is a request for a 0.20*reach/3200-doctor practice,
//     which in a median suburban catchment is ~18 doctors. Asserted here, at 1e-6,
//     so nobody can quietly reinterpret it: if this check ever fails, either the
//     solve or the reported share moved and the card copy is now wrong.
//     (Incumbent/clinic mode does NOT satisfy this — cEq is the real roster there,
//     not a solve — which is why the sample is the entrant-mode metro run only.)
// ═════════════════════════════════════════════════════════════════════════════
section('7b. identity — reported capture share is the equilibrium residual');
{
  const ID_TOL=1e-6;
  if(!IDENT) fail('share.identity','no metro identity sample was collected');
  else if(!IDENT.n) fail('share.identity','no cell carried an interior equilibrium solution',
    `${IDENT.clamped} cells clamped at the bisection bounds — the solver is not converging anywhere`);
  else if(!(IDENT.worst<=ID_TOL)) fail('share.identity',
    `share !== cEq x ${IDENT.cap} / cReach — worst relative error ${IDENT.worst.toExponential(2)} over ${IDENT.n} interior cells`,
    'Either _catchEquilibrium or the reported share changed and the two no longer describe the same\n'+
    'quantity. If that is deliberate this check must be updated together with every card, popup and\n'+
    'report that prints the number as "capture share" — it would now be a different claim.');
  else pass('share.identity',
    `share === cEq x ${IDENT.cap} / cReach on ${IDENT.n} interior cells (worst ${IDENT.worst.toExponential(2)}, ${IDENT.clamped} clamped) — it is a residual, not a measurement`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. GATES — a tier gate that passes <1% or >90% of candidates is not a gate, it
//    is a constant. Both directions have shipped.
// ═════════════════════════════════════════════════════════════════════════════
section('8. gates — every gate still discriminates');
if(!GATES) fail('gate.collect','no metro gate counts were collected');
else{
  const chk=(id,label,num,den,lo=1,hi=90)=>{
    if(!den){ fail(id,label+': no candidates'); return; }
    const p=100*num/den, msg=`${label}: ${num}/${den} = ${p.toFixed(2)}%`;
    if(p<lo)      fail(id, msg+` — below ${lo}%: rejects essentially everything`);
    else if(p>hi) fail(id, msg+` — above ${hi}%: accepts essentially everything`);
    else          pass(id, msg);
  };
  chk('gate.siting','siting gate (commercial fabric)', GATES.siteable, GATES.candidates);
  chk('gate.strong','_evalStrongOK (recommended)',     GATES.strong,   GATES.siteable);
  chk('gate.floor','EVAL_FLOOR (above weak)',          GATES.floor,    GATES.siteable);
  if(GATES.scoreBar>0 && GATES.strong/GATES.scoreBar < 0.02)
    warn('gate.strong.extra','the non-score half of _evalStrongOK rejects >98% of score-qualified cells',
         `score>=EVAL_STRONG ${GATES.scoreBar}, all conditions ${GATES.strong}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. FIT — modelled practice size vs SCRAPED DVM rosters at real GP clinic
//    locations. Quantile-of-model / quantile-of-roster, the statistic
//    research/site-capture-model.md is calibrated on. Entrant mode, GP only.
// ═════════════════════════════════════════════════════════════════════════════
section('9. fit — modelled practice size vs scraped rosters');
// Baselines are MEASURED through the shipped code by this harness — not copied from a
// standalone replica, whose simplified demand chain lands in a slightly different place.
// Re-measure and update deliberately whenever the model is retuned; do not widen the
// tolerance to make a failing run pass.
const FIT_BASELINE={ p25:1.25, p50:1.09, p75:0.95, p90:0.76 };
const FIT_TOL=0.20;
const RHO_FLOOR=0.10;
// ── KNOWN-BAD BASELINES (measured 2026-07-29 on this tree by this harness) ───────────────────
// research/algo-audit-2026-07-29.md established that the pooled quantile ratio above is a
// MIXTURE that cancels: it reads ~1.0 while the per-class fit spans 9x. These baselines record
// the defect rather than assert a number nobody has earned, so today's tree passes and the
// fixes now in flight (un-clipping K, re-deriving CATCH_MAX_BAND, the _catchAttract exponent)
// are visible as movement instead of as silence. RE-RECORD DELIBERATELY when they land.
// MEASURED 2026-07-29, n=569 (rural 44 / exurban 128 / suburban 210 / urban 187). Same statistic
// as FIT_BASELINE, run inside each bucket: rural 0.25x and urban 2.18x, spread 8.87x, while the
// pooled mixture sits on 1.09. Independently reproduced by the audit at mean-ratio grain
// (0.19 / 0.31 / 0.91 / 1.76, spread 9.1x) from a separate replica.
// RE-RECORDED 2026-07-29 after the v8 un-clip + joint recalibration, exactly as the WARN this
// check emits asks for. The v7 figures it replaces — rural 0.246 / exurban 0.481 / suburban 1.116
// / urban 2.182, an 8.9x spread — WERE the class stratification the audit identified: the K=8.0
// bucket ceiling censored competition in proportion to density, so the model over-predicted urban
// by 2.2x while under-predicting rural by 4x. Un-clipping to a log ladder (ceiling 65) collapsed
// the spread to 1.53x. Keep the OLD numbers in this comment: they are the regression signature to
// recognise if anyone ever re-clips the buckets.
const FIT_CLASS_BASELINE={ rural:0.723, exurban:0.957, suburban:1.103, urban:1.065 };  // p50 ratios, v8
const FIT_CLASS_TOL=0.20;      // further from 1.0 than baseline by this much = regression = FAIL
const FIT_CLASS_MIN_N=25;      // below this a class ratio is noise; reported, not gated
// fit.pairing thresholds. COH = spatial coherence of modelled size between a clinic's cell and a
// cell ~0.7 mi away; GAP = how far that sits above the same statistic on a seeded permutation.
// Measured on this tree: coherence 0.887, permuted max 0.050 over 25 seeds, gap 0.837.
const PAIR_SEED=20260729, PAIR_PERMS=25;
const PAIR_COH_MIN=0.75;       // 0.14 below measured — a real collapse, not run-to-run wobble
const PAIR_GAP_MIN=0.35;
// fit.rank: Spearman(modelled, roster). Measured pooled -0.026 (rural -0.008 / exurban 0.014 /
// suburban -0.059 / urban -0.045) — the model has NO validated per-site signal, which is the
// documented state, not a regression. FAIL only on a drop BELOW the recorded baseline; PROMOTE to
// a hard floor the day a per-site claim is made (research/site-capture-model.md).
const RANK_BASELINE=-0.03;
const RANK_TOL=0.15;
const RANK_PROMOTE=0.25;
if(QUICK) warn('fit.skipped','--quick: roster-fit check skipped');
else{
  const t0=Date.now();
  try{
  FIT=JSON.parse(run(`(function(){
    _evalSubject=null;                                   // entrant mode
    const visits=z=>{ const dd=dogData[z]; return dd? ((dd.est||0)*OPP_VISITS_PER_DOGHH+(dd.catEst||0)*OPP_VISITS_PER_CATHH) : 0; };
    const model=[], roster=[], cls=[], nb=[]; let skipSpec=0, skipNoRoster=0, skipNoCell=0;
    for(const cl of ((_catchData&&_catchData.clinics)||[])){
      const nm=cl.name||'';
      if(_isSpecialtyER(nm)){ skipSpec++; continue; }     // ER/specialty draw regionally
      if(_isLargeAnimalAt(nm,cl.la,cl.lo)){ skipSpec++; continue; }
      const st=_vetStaffAt(cl.la,cl.lo); if(!st||!(st.n>0)){ skipNoRoster++; continue; }
      const cc=_catchNearest(cl.la,cl.lo); if(!cc){ skipNoCell++; continue; }
      const cell={}; _applyCapture(cell,cc,visits);
      if(!(cell.cEq>0)) continue;
      model.push(cell.cEq); roster.push(st.n); cls.push(cell.cUrb||'?');
      // NEIGHBOUR CELL, ~0.7 mi off (the artifact grid is 0.61 mi). Modelled capture is a
      // function of geography, so it has to be spatially COHERENT — a household 0.7 mi away
      // is reached by nearly the same catchment. fit.pairing turns that into the one
      // assignment test available here: a scrambled site->value mapping destroys it while
      // leaving every marginal distribution, and therefore fit.roster, untouched.
      let nbv=null;
      for(const d of [[0.010,0],[-0.010,0],[0,0.012],[0,-0.012]]){
        const c2=_catchNearest(cl.la+d[0], cl.lo+d[1]);
        if(!c2 || c2===cc) continue;
        const cell2={}; _applyCapture(cell2,c2,visits);
        if(cell2.cEq>0){ nbv=cell2.cEq; break; }
      }
      nb.push(nbv);
    }
    if(!model.length) return JSON.stringify({n:0,rho:null,skipped:{specialty:skipSpec,noRoster:skipNoRoster,noCell:skipNoCell},ratio:{},model:{},roster:{},_raw:{m:[],r:[],c:[],nb:[]}});
    const q=(a,p)=>{ const s=a.slice().sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]; };
    const rank=v=>{ const ix=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]); const r=new Array(v.length);
      let i=0; while(i<ix.length){ let j=i; while(j+1<ix.length&&ix[j+1][0]===ix[i][0]) j++;
        const av=(i+j)/2+1; for(let k=i;k<=j;k++) r[ix[k][1]]=av; i=j+1; } return r; };
    let rho=null;
    if(model.length>2){ const rx=rank(model), ry=rank(roster), n=rx.length;
      const mx=rx.reduce((a,b)=>a+b,0)/n, my=ry.reduce((a,b)=>a+b,0)/n;
      let num=0,dx=0,dy=0; for(let i=0;i<n;i++){ const a=rx[i]-mx,b=ry[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
      rho = (dx>0&&dy>0)? num/Math.sqrt(dx*dy) : null; }
    const out={ n:model.length, rho: rho==null?null:+rho.toFixed(3),
                skipped:{specialty:skipSpec,noRoster:skipNoRoster,noCell:skipNoCell},
                ratio:{}, model:{}, roster:{},
                _raw:{ m:model, r:roster, c:cls, nb } };
    for(const p of [0.25,0.5,0.75,0.9]){
      const mq=q(model,p), rq=q(roster,p), k='p'+Math.round(p*100);
      out.model[k]=+mq.toFixed(2); out.roster[k]=+rq.toFixed(2);
      out.ratio[k]= rq>0? +(mq/rq).toFixed(3) : null;
    }
    return JSON.stringify(out);
  })()`));
  if(!FIT || FIT.n<100) fail('fit.sample', `only ${FIT?FIT.n:0} GP clinics with a roster matched a catchment cell — expected several hundred`);
  else{
    const line=['p25','p50','p75','p90'].map(k=>`${k} ${FIT.ratio[k]}`).join(' · ');
    const off=[];
    for(const k of ['p25','p50','p75','p90']){
      const v=FIT.ratio[k], b=FIT_BASELINE[k];
      if(v==null||Math.abs(v-b)>FIT_TOL) off.push(`${k} ${v} vs baseline ${b} (tol ±${FIT_TOL})`);
    }
    if(!off.length) pass('fit.roster', `n=${FIT.n} · ${line}`);
    else fail('fit.roster', `roster fit drifted — ${line}`,
              off.join('; ')+`\nmodel ${JSON.stringify(FIT.model)} vs roster ${JSON.stringify(FIT.roster)}`);
    // ORDERING is a separate question from distribution matching, and a much harder one.
    // The quantile ratios can sit on 1.0 while the per-clinic ordering carries no signal —
    // matching a distribution says nothing about matching it clinic by clinic. Reported as
    // a WARN, not a FAIL, because no target for it has ever been established: the rho 0.64
    // in CLAUDE.md is model-vs-PREVIOUS-MODEL, not model-vs-roster.
    if(FIT.rho==null) warn('fit.rho','Spearman rho could not be computed');
    else if(FIT.rho<RHO_FLOOR) warn('fit.rho', `Spearman rho ${FIT.rho} vs rosters — the model matches the roster DISTRIBUTION but barely orders individual clinics`,
      'not a regression signal on its own; watch it move, and do not quote the fit as per-clinic accuracy');
    else pass('fit.rho', `Spearman rho ${FIT.rho} vs rosters`);

    // ─────────────────────────────────────────────────────────────────────────
    // (a) fit.byclass — the SAME quantile statistic, run inside each urbanicity
    //     bucket. The pooled form is a mixture and it cancels: measured, the
    //     mixture reads ~1.0 while the classes span 9x. A gate that cannot see
    //     that is a gate that certifies the urban-over-suburban bias.
    // ─────────────────────────────────────────────────────────────────────────
    const RAW=FIT._raw||{m:[],r:[],c:[],nb:[]};
    delete FIT._raw;                       // keep it out of the --json summary
    {
      const KS=['rural','exurban','suburban','urban'];
      const by={};
      for(const k of KS){
        const m=[], r=[];
        for(let i=0;i<RAW.m.length;i++) if(RAW.c[i]===k){ m.push(RAW.m[i]); r.push(RAW.r[i]); }
        by[k]= m.length? { n:m.length, ratio:qratio(m,r),
                           meanRatio:+(mean(m)/mean(r)).toFixed(3),
                           rho: m.length>2? (spearman(m,r)==null?null:+spearman(m,r).toFixed(3)) : null }
                       : { n:0, ratio:{}, meanRatio:null, rho:null };
      }
      FIT.byclass=by;
      const line=KS.map(k=>`${k} ${by[k].n?by[k].ratio.p50:'-'}${by[k].n?'':''} (n=${by[k].n})`).join(' · ');
      const regress=[], improved=[], thin=[];
      for(const k of KS){
        const b=FIT_CLASS_BASELINE[k], v=by[k].n? by[k].ratio.p50 : null;
        if(by[k].n<FIT_CLASS_MIN_N){ thin.push(`${k} n=${by[k].n}`); continue; }
        if(b==null){ improved.push(`${k} ${v} (NO BASELINE RECORDED)`); continue; }
        const dNow=Math.abs(v-1), dBase=Math.abs(b-1);
        if(dNow-dBase >  FIT_CLASS_TOL) regress.push(`${k} ${v} vs baseline ${b} — ${(dNow-dBase).toFixed(2)} further from 1.0`);
        else if(dBase-dNow > FIT_CLASS_TOL) improved.push(`${k} ${v} vs baseline ${b} — ${(dBase-dNow).toFixed(2)} closer to 1.0`);
      }
      const spread=(()=>{ const v=KS.filter(k=>by[k].n>=FIT_CLASS_MIN_N).map(k=>by[k].ratio.p50).filter(x=>x>0);
        return v.length>1? +(Math.max(...v)/Math.min(...v)).toFixed(2) : null; })();
      const head=`per-class p50 ratio — ${line}${spread?` · spread ${spread}x`:''}`;
      if(regress.length) fail('fit.byclass', `a class moved AWAY from 1.0 — ${head}`,
        regress.join('; ')+'\nThe pooled fit.roster ratio is a mixture and cancels this; that is why this check exists.');
      else if(improved.length) warn('fit.byclass', `${head} — a class moved materially TOWARD 1.0`,
        improved.join('; ')+'\nIf this is the intended fix, re-record FIT_CLASS_BASELINE in eval-gate.mjs deliberately.');
      else pass('fit.byclass', head+' (tracking the recorded known-bad baseline)');
      if(thin.length) warn('fit.byclass.thin', 'a class is too thin to gate on', thin.join('; '));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (b) fit.pairing — is the fit statistic even CAPABLE of seeing a wrong
    //     assignment? The audit's finding: randomly permuting the modelled
    //     values across clinics leaves the quantile ratios BIT-IDENTICAL, so
    //     fit.roster certifies a model with zero per-site skill. A quantile
    //     ratio constrains a marginal and nothing else.
    //     A per-pair statistic against rosters cannot rescue that here — the
    //     model's Spearman vs rosters is already ~0, so a permutation is
    //     genuinely invisible on that axis. What IS pairing-sensitive today is
    //     spatial coherence: modelled capture must be a smooth function of
    //     location (a cell 0.7 mi away sees nearly the same catchment). That is
    //     high on the shipped assignment and collapses under permutation, so it
    //     is both alive and discriminating — which is exactly what this check
    //     has to demonstrate before any other fit number can be believed.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const qqReal=qratio(RAW.m, RAW.r), qqPerm=qratio(permute(RAW.m,PAIR_SEED), RAW.r);
      const qqInvariant=JSON.stringify(qqReal)===JSON.stringify(qqPerm);
      const mm=[], nn=[];
      for(let i=0;i<RAW.m.length;i++) if(RAW.nb[i]!=null){ mm.push(RAW.m[i]); nn.push(RAW.nb[i]); }
      const cohReal = mm.length>2? spearman(mm,nn) : null;
      const nulls=[];
      for(let s=0;s<PAIR_PERMS;s++){ const v=spearman(permute(mm,PAIR_SEED+s), nn); if(v!=null) nulls.push(v); }
      const nullMax = nulls.length? Math.max(...nulls.map(Math.abs)) : null;
      const gap = (cohReal!=null && nullMax!=null)? cohReal-nullMax : null;
      FIT.pairing={ n:mm.length, qqInvariant, qqReal, qqPerm,
                    coherence: cohReal==null?null:+cohReal.toFixed(3),
                    nullMean: nulls.length? +mean(nulls).toFixed(3):null,
                    nullSd:   nulls.length? +sd(nulls).toFixed(4):null,
                    nullMax:  nullMax==null?null:+nullMax.toFixed(3),
                    gap:      gap==null?null:+gap.toFixed(3), perms:nulls.length, seed:PAIR_SEED };
      const qqNote = qqInvariant
        ? `the quantile-ratio statistic is UNCHANGED by the same permutation (p50 ${qqReal.p50} both ways) — it cannot see an assignment at all`
        : `NOTE: the quantile-ratio statistic moved under permutation (${qqReal.p50} -> ${qqPerm.p50}), which it should not — investigate before trusting fit.roster`;
      if(mm.length<50) warn('fit.pairing', `only ${mm.length} clinics had a neighbouring catchment cell — too thin to test the assignment`, qqNote);
      else if(cohReal==null || nulls.length<PAIR_PERMS) fail('fit.pairing','the coherence statistic could not be computed', qqNote);
      else if(!(FIT.pairing.nullSd>0)) fail('fit.pairing',
        'the pairing statistic is PERMUTATION-INVARIANT — this check is worthless as written',
        `${nulls.length} seeded permutations all returned ${FIT.pairing.nullMean}. A statistic that cannot\n`+
        `move when the assignment is scrambled certifies nothing. Fix the statistic, not the model.\n`+qqNote);
      else if(!(gap>=PAIR_GAP_MIN)) fail('fit.pairing',
        `modelled size is no more spatially coherent than a random assignment — rho ${FIT.pairing.coherence} vs permuted ${FIT.pairing.nullMax}, gap ${FIT.pairing.gap} (need ${PAIR_GAP_MIN})`,
        'Either the site->value mapping is scrambled (a cell is being scored from the wrong catchment)\n'+
        'or capture output has stopped depending on location. '+qqNote);
      else if(PAIR_COH_MIN!=null && cohReal<PAIR_COH_MIN) fail('fit.pairing',
        `spatial coherence ${FIT.pairing.coherence} fell below the recorded baseline floor ${PAIR_COH_MIN}`,
        'modelled capture no longer varies smoothly with location — the assignment has partly come apart. '+qqNote);
      else pass('fit.pairing',
        `assignment is coherent — neighbour-cell rho ${FIT.pairing.coherence} vs ${FIT.pairing.nullMax} for ${nulls.length} seeded permutations (gap ${FIT.pairing.gap}); ${qqNote}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (c) fit.rank — Spearman(modelled, actual) pooled and per class. The gate
    //     has never had a per-site accuracy target and must not pretend to: the
    //     documented state is corr 0.002 per clinic vs 0.697 at market level.
    //     WARN today, with the promotion path stated in the message so it is a
    //     decision somebody makes rather than a line nobody reads.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const KS=['rural','exurban','suburban','urban'];
      const pooled=FIT.rho;
      const per=KS.map(k=>`${k} ${FIT.byclass[k].rho==null?'-':FIT.byclass[k].rho}`).join(' · ');
      FIT.rank={ pooled, byclass:Object.fromEntries(KS.map(k=>[k,FIT.byclass[k].rho])) };
      const head=`Spearman vs rosters — pooled ${pooled} · ${per}`;
      if(pooled==null) warn('fit.rank','Spearman could not be computed');
      else if(RANK_BASELINE!=null && pooled < RANK_BASELINE-RANK_TOL) fail('fit.rank',
        `${head} — pooled dropped ${(RANK_BASELINE-pooled).toFixed(3)} below the recorded baseline ${RANK_BASELINE}`,
        'the model orders clinics WORSE than it did; that is a regression even while the absolute level is ~0');
      else if(pooled < RANK_PROMOTE) warn('fit.rank', `${head} — no per-site ordering signal (baseline ${RANK_BASELINE})`,
        `PROMOTION PATH: this is a WARN only because the model makes no per-site claim. The day a site\n`+
        `card, report or ranking is presented as per-address accuracy, change this to FAIL below ${RANK_PROMOTE}.\n`+
        `Until then the honest statement is market-level, not firm-level (see research/site-capture-model.md).`);
      else pass('fit.rank', head);
    }
  }
  }catch(e){ fail('fit.error','the roster-fit probe threw', e.constructor.name+': '+e.message); }
  if(!JSON_OUT) console.log(`        ${C.d}n=${FIT?FIT.n:0} · skipped ${FIT?JSON.stringify(FIT.skipped):'-'} · ${((Date.now()-t0)/1000).toFixed(1)}s${C.n}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. CLOSURE — the demand half and the supply half must describe ONE metro.
//     They are calibrated independently and never reconciled: demand is
//     households x dog rate x visits (the app's pet model), capacity is
//     DVM_VISIT_CAPACITY per doctor (AVMA throughput). Divide total modelled
//     visits inside the artifact bbox by the doctors that physically exist
//     there and the answer must land near DVM_VISIT_CAPACITY. It does not —
//     measured 1,598 vs 3,200 — which means one half is wrong by ~2x and no
//     other check in this file can see it. Recorded and tracked, not asserted.
// ═════════════════════════════════════════════════════════════════════════════
section('10. closure — modelled metro demand vs the doctors actually there');
{
  // RE-RECORDED 2026-07-30 with the corrected denominator (GP-only, rosters de-duplicated).
  // The 0.50 it replaces was never a property of the model — roughly two thirds of that gap was
  // this check counting ER/specialty and large-animal doctors, and counting shared rosters more
  // than once. What remains is a real question about DVM_VISIT_CAPACITY=3200, which is a capacity
  // CEILING being used in an equilibrium condition as if it were a realised mean: the national
  // identity (175.5M companion visits / 68,400 companion-animal vets) puts realised throughput at
  // ~2,566/yr, i.e. 0.80x the constant. Closing that is a recalibration of every practice-size and
  // revenue number in the app, so it stays a WARN and its own decision.
  const CLOSE_BASELINE = 0.637;     // MEASURED on this tree, not the predicted 0.656
  const CLOSE_TOL      = 0.08;      // movement beyond this is a real recalibration, not noise
  const CLOSE_BAND     = [0.85,1.18];   // "closed" — the two halves agree
  try{
    CLOSE=JSON.parse(run(`(function(){
      const B=(_catchData&&_catchData.bbox)||null;
      if(!B) return JSON.stringify({err:'no artifact bbox'});
      // Bbox centre of each ZIP polygon; rawBBox is function-scoped in the app so it is redone here.
      const cen=(f)=>{ const g=f.geometry; if(!g) return null;
        const rings=g.type==='Polygon'? g.coordinates : g.type==='MultiPolygon'? g.coordinates.flat() : [];
        let a=90,b=-90,c=180,d=-180;
        for(const r of rings) for(const p of r){ if(p[1]<a)a=p[1]; if(p[1]>b)b=p[1]; if(p[0]<c)c=p[0]; if(p[0]>d)d=p[0]; }
        return a>b? null : [(a+b)/2,(c+d)/2]; };
      let zips=0, hh=0, visits=0;
      for(const f of ((_zipGeoCache&&_zipGeoCache.features)||[])){
        const z=f.properties&&f.properties.zip, dd=z? dogData[z] : null; if(!dd) continue;
        const p=cen(f); if(!p) continue;
        if(p[0]<B.s||p[0]>B.n||p[1]<B.w||p[1]>B.e) continue;
        zips++; hh+=dd.households||0;
        visits += (dd.est||0)*OPP_VISITS_PER_DOGHH + (dd.catEst||0)*OPP_VISITS_PER_CATHH;
      }
      // SUPPLY. The denominator must contain the doctors who actually serve the demand in the
      // numerator, which is dog-and-cat GENERAL PRACTICE. Two corrections, both measured
      // 2026-07-30 — before them this check read 0.501 and looked like a model error when most of
      // it was a counting error in the check itself.
      //
      // (a) EXCLUDE what the engine already excludes. _isSpecialtyERAt and _isLargeAnimalAt keep
      //     ER/specialty and equine/livestock practices out of every competition model in the app;
      //     counting their doctors here credits the GP pool with 293 + 85 DVMs that never see a
      //     routine dog visit. Using the engine's own predicates keeps this consistent with what
      //     it scores, rather than inventing a second rule.
      // (b) DE-DUPLICATE shared rosters. _vetStaffAt matches within ~330m, and multi-location
      //     groups publish one "our doctors" page across every site, so the same named roster is
      //     credited repeatedly — 150 GP clinics carry a roster fingerprint identical to another's.
      //     Each distinct roster counts ONCE; the duplicates fall back to the app's default of 2.
      //
      // Unknown rosters still default to 2, which understates the true count, so the residual gap
      // remains a FLOOR rather than a point estimate.
      const _nm=(la,lo)=>{ const v=_vetEnrichAt(la,lo); return (v&&v.name)||''; };
      let dvm=0, known=0, unk=0, exSpec=0, exLarge=0, dupes=0, dupDvm=0;
      const seenRoster=new Set();
      for(const cl of ((_catchData&&_catchData.clinics)||[])){
        const nm=_nm(cl.la,cl.lo);
        if(_isSpecialtyERAt(nm,cl.la,cl.lo)){ exSpec++; continue; }
        if(_isLargeAnimalAt(nm,cl.la,cl.lo)){ exLarge++; continue; }
        const st=_vetStaffAt(cl.la,cl.lo);
        if(st&&st.n>0){
          // Fingerprint on the NAMES when we have them — two clinics with the same five doctors are
          // one roster published twice, not ten doctors.
          const fp=(st.vets&&st.vets.length)? st.vets.slice().sort().join('|') : null;
          if(fp && seenRoster.has(fp)){ dupes++; dupDvm+=st.n-2; dvm+=2; unk++; }
          else { if(fp) seenRoster.add(fp); dvm+=st.n; known++; }
        } else { dvm+=2; unk++; }
      }
      return JSON.stringify({ zips, hh:Math.round(hh), visits:Math.round(visits),
        clinics:((_catchData&&_catchData.clinics)||[]).length, dvm:+dvm.toFixed(1), known, unk,
        exSpec, exLarge, dupes, dupDvm:+dupDvm.toFixed(0),
        perDVM: dvm? +(visits/dvm).toFixed(1) : null, cap:DVM_VISIT_CAPACITY });
    })()`));
  }catch(e){ CLOSE={ err:e.constructor.name+': '+e.message }; }

  if(!CLOSE || CLOSE.err || CLOSE.perDVM==null) fail('closure.metro','could not measure metro closure', CLOSE?CLOSE.err:'no result');
  else{
    const ratio=+(CLOSE.perDVM/CLOSE.cap).toFixed(3);
    CLOSE.ratio=ratio;
    const head=`${CLOSE.zips} ZIPs · ${CLOSE.hh.toLocaleString()} HH -> ${CLOSE.visits.toLocaleString()} modelled visits/yr `
             + `vs ${CLOSE.dvm} DVMs at ${CLOSE.clinics} clinics (${CLOSE.known} scraped / ${CLOSE.unk} assumed 2) `
             + `= ${CLOSE.perDVM.toLocaleString()} visits/DVM, ${ratio}x DVM_VISIT_CAPACITY ${CLOSE.cap}`;
    const dNow=Math.abs(ratio-1), dBase=Math.abs(CLOSE_BASELINE-1);
    if(ratio>=CLOSE_BAND[0] && ratio<=CLOSE_BAND[1]) pass('closure.metro', 'the metro CLOSES — '+head);
    else if(dNow-dBase > CLOSE_TOL) fail('closure.metro', `closure gap WIDENED — ${head}`,
      `baseline ${CLOSE_BASELINE}x; now ${ratio}x. One half of the model was recalibrated without the other.\n`+
      `Either demand (pet rate x visits/HH) or capacity (DVM_VISIT_CAPACITY) moved and they no longer\n`+
      `describe the same metro. This is the check that exists because that has already happened once.`);
    else if(dBase-dNow > CLOSE_TOL) warn('closure.metro', `closure gap NARROWED — ${head}`,
      `baseline ${CLOSE_BASELINE}x; now ${ratio}x. If that is the intended fix, re-record CLOSE_BASELINE.`);
    else warn('closure.metro', `KNOWN OPEN (baseline ${CLOSE_BASELINE}x) — ${head}`,
      `The demand model supports ~${Math.round(CLOSE.visits/CLOSE.cap).toLocaleString()} full-time DVMs; ${CLOSE.dvm} exist.\n`+
      `Both halves cannot be right. Tracked as a WARN because closing it is a recalibration, not a bug fix —\n`+
      `it moves every practice-size, revenue and saturation number in the app at once.`);
  }
}

finish();

function finish(){
  const summary={ ok:FAILED===0, failed:FAILED, warned:WARNED,
    passed:RESULTS.filter(r=>r.status==='PASS').length,
    node:process.version, generated:new Date().toISOString(),
    net:{local:NET.local,cache:NET.cache,live:NET.live,blocked:NET.blocked},
    data:DATA, scenarios:SC, gates:GATES, dist:DIST, fit:FIT,
    identity:IDENT, closure:CLOSE, results:RESULTS };
  // fs.writeSync, not console.log: process.exit() does not flush an async piped stdout,
  // which silently truncates the --json blob when the gate is driven by another script.
  if(JSON_OUT) fs.writeSync(1, JSON.stringify(summary,null,2)+'\n');
  else{
    const head = FAILED ? `${C.r}GATE FAILED${C.n}` : WARNED ? `${C.y}GATE PASSED (warnings)${C.n}` : `${C.g}GATE PASSED${C.n}`;
    fs.writeSync(1, `\n${head}  —  ${summary.passed} passed · ${WARNED} warned · ${FAILED} failed\n`
      + (FAILED? `${C.d}  Do not ship the capture model until these are green.${C.n}\n` : ''));
  }
  process.exit(FAILED?1:0);
}
