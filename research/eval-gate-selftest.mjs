#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// eval-gate-selftest.mjs — does research/eval-gate.mjs actually catch anything?
//
//   ~/.nvm/versions/node/v20.20.2/bin/node research/eval-gate-selftest.mjs
//   …/node research/eval-gate-selftest.mjs --only=M1,M5     # a subset
//
// A gate that passes is worthless evidence on its own — a gate that only ever passes
// is indistinguishable from `exit 0`. This re-introduces each of the six bugs that
// actually shipped, one at a time, into a THROWAWAY COPY of the tree (the real repo
// is never written to), runs the gate against it, and asserts that the gate goes red
// AND that the specific check which is supposed to notice is the one that fired.
//
// Every mutation is applied by anchor text, so a mutation that no longer matches is
// reported as a SETUP failure rather than silently passing.
//
// Runtime ~7 min: nine of these each run the full gate. Not part of the gate itself.
// Run it whenever eval-gate.mjs is edited, and after any refactor of the scoring loop.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '..');
const GATE = path.join(HERE, 'eval-gate.mjs');
const ONLY = (process.argv.find(a=>a.startsWith('--only='))||'').slice(7).split(',').filter(Boolean);
const C = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', d:'\x1b[2m', n:'\x1b[0m' };

// ── mutations ────────────────────────────────────────────────────────────────
// `file` is relative to the app root. `expect` names the check id that MUST fail.
// `also` lists further ids that are expected to go red as collateral (not required).
const MUTATIONS = [
  { id:'M1', file:'index.html',
    what:'CATCH_REV_FULL declared under a different name — referenced but undefined',
    from:'const CATCH_REV_FULL=10*REV_PER_DVM;',
    to:  'const CATCH_REV_FULL_RENAMED=10*REV_PER_DVM;',
    expect:'static.identifiers' },

  { id:'M2a', file:'build-catchments.mjs',
    what:'staffW moved below the loop that calls it (TDZ, build chain)',
    move:{ line:'  const staffW=n=>(!n||n<1)?1:Math.min(1.8,Math.max(0.8,Math.sqrt(n/2.5)));\n',
           below:'  const CBANDS=[[0.5,8],[8,10],[10,12],[12,15],[15,20],[20,25]];' },
    expect:'static.tdz.build' },

  { id:'M2b', file:'index.html',
    what:'_capture moved below _hasFut, which reads it (TDZ, scoring loop)',
    move:{ line:"  const _capture=EVAL_MODEL==='capture' && !!_catchData && _catchCovers(bb) && _petsReady;\n",
           below:"  const _hasFut = evalFuture && (evalData.resid.some(r=>r._fut) || (_capture && !!_catchData));" },
    expect:'static.tdz' },

  { id:'M3', file:'index.html',
    what:'_evalStrongOK left on the gravity-scale floors in capture mode',
    from:'  if(evalCaptureOn) return g.score>=EVAL_STRONG && (!evalDataOk.retail || g.ret>=EVAL_RET_MIN);',
    to:  '  if(evalCaptureOn) return g.score>=EVAL_STRONG && g.demandN>=0.45 && g.share>=0.24 && (!evalDataOk.retail || g.ret>=EVAL_RET_MIN);',
    expect:'gate.strong' },

  { id:'M4', file:'index.html',
    what:'capture-mode siting gate blanket-passes every cell — land plays starve',
    from:'        siteable = _dr!=null ? (_dr<SITE_COMM) : true;   // no retail data at all → don\'t starve',
    to:  '        siteable = true;',
    expect:'output.land' },

  { id:'M5', file:'index.html',
    what:'_applyCapture early-returns on some cells — they keep a gravity score and are ranked anyway',
    // A FAITHFUL reproduction of the mixed-scale state: cc is non-null (so the candidate-loop
    // skip does not fire) but cEq/cShare are never set, so the cell falls through to the
    // crow-flies share and is then sorted, tiered and displayed beside revenue-scaled cells.
    // Any future early-return added to _applyCapture — a cell missing a band, a null income —
    // reintroduces exactly this silently. Expect ANY scale.* to fire: which scenarios expose
    // it depends on where artifact coverage is thin, which is a property of the data.
    from:'function _applyCapture(cell, cc, valOf){\n  if(!cc) return;',
    to:  'function _applyCapture(cell, cc, valOf){\n  if(!cc || (Math.round(cc.la*1000)%7)===0) return;',
    expect:'scale.' },

  { id:'M5-skip', file:'index.html',
    what:'the candidate-loop skip for unmeasured cells is removed (KNOWN NOT DETECTABLE)',
    from:'      if(_captureRun && !_cc){ evalCapStat.skipped++; continue; }',
    to:  '      if(false){ evalCapStat.skipped++; continue; }',
    // MEASURED AND ASSERTED AS A MISS, not hidden. On today's code this guard is defensive
    // only: _catchNearest's tolerance is 0.8 mi and catchment cells sit on commercial fabric,
    // so a candidate with no catchment is also >0.8 mi from fabric and fails the 280 m siting
    // gate on its own. Removing the guard changes no cell count in any fixture (verified: all
    // eleven scenarios byte-identical). It becomes load-bearing when evalData.retail carries
    // commercial POIs the artifact build did not see — a LIVE Overpass fetch newer than the
    // baked dfw-retail.json — which this gate cannot reproduce because CTX_LOCAL feeds it the
    // same static file the build used. Keep the guard; do not read this as permission to drop it.
    expectMiss:true },

  // Two more that are not from the incident list but are the failure modes the gate is
  // supposed to be able to see at all. They keep §7/§9 honest.
  { id:'M6', file:'index.html',
    what:'the sized entrant reverts to a fixed 2.5-DVM probe — roster fit collapses',
    from:'    cell.cEq=_catchEquilibrium(cc,bd,cell.cWBar);',
    to:  '    cell.cEq=2.5;',
    expect:'fit.roster' },

  { id:'M7', file:'index.html',
    what:'competitors dropped from the share — every cell reads uncontested',
    from:'function _catchShareBand(',
    to:  'function _catchShareBand(cell,b,aOwn,wBar){ return 1; }\nfunction _catchShareBand_dead(',
    expect:'dist.share' },
];

// ── scratch tree ─────────────────────────────────────────────────────────────
// Symlink every entry so the ~20 MB of data files are not copied nine times; then
// replace the ONE mutated file with a real file. The gate only ever reads.
function makeTree(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'vetric-gate-selftest-'));
  for(const e of fs.readdirSync(APP)){
    if(e==='.git') continue;
    fs.symlinkSync(path.join(APP,e), path.join(dir,e));
  }
  return dir;
}
function applyMutation(dir, m){
  const src = fs.readFileSync(path.join(APP,m.file),'utf8');
  let out;
  if(m.move){
    if(!src.includes(m.move.line))  throw new Error('move anchor (the declaration line) no longer matches');
    if(!src.includes(m.move.below)) throw new Error('move anchor (the destination line) no longer matches');
    out = src.replace(m.move.line,'').replace(m.move.below, m.move.below+'\n'+m.move.line.replace(/\n$/,''));
  } else {
    if(!src.includes(m.from)) throw new Error('anchor no longer matches: '+JSON.stringify(m.from.slice(0,70)));
    out = src.replace(m.from, m.to);
  }
  if(out===src) throw new Error('mutation produced an identical file');
  fs.unlinkSync(path.join(dir,m.file));
  fs.writeFileSync(path.join(dir,m.file), out);
}
function runGate(dir){
  try{
    const stdout = execFileSync(process.execPath,[GATE,'--json'],
      { env:{...process.env, VETRIC_APP:dir, GATE_OFFLINE:'1'}, maxBuffer:1<<28, encoding:'utf8' });
    return { code:0, json:JSON.parse(stdout) };
  }catch(e){
    let json=null; try{ json=JSON.parse(e.stdout||''); }catch(_){}
    return { code: e.status===undefined?-1:e.status, json, raw:String(e.stdout||e.message).slice(0,400) };
  }
}

// ── baseline ─────────────────────────────────────────────────────────────────
console.log(`${C.d}baseline — the unmutated tree must be GREEN, or every result below is noise${C.n}`);
const base = runGate(APP);
if(!base.json){ console.error(`${C.r}baseline gate produced no JSON${C.n}\n${base.raw}`); process.exit(2); }
if(base.code!==0){
  console.error(`${C.r}BASELINE IS RED (${base.json.failed} failed) — fix HEAD before running the self-test${C.n}`);
  for(const r of base.json.results) if(r.status==='FAIL') console.error('  '+r.id+': '+r.msg);
  process.exit(2);
}
console.log(`  ${C.g}PASS${C.n}  baseline  ${base.json.passed} passed · ${base.json.warned} warned · 0 failed\n`);

// ── mutants ──────────────────────────────────────────────────────────────────
const rows=[]; let bad=0;
for(const m of MUTATIONS){
  if(ONLY.length && !ONLY.includes(m.id)) continue;
  const dir=makeTree();
  let row={ id:m.id, what:m.what, expect:m.expect };
  try{
    applyMutation(dir,m);
    const r=runGate(dir);
    const failed = r.json ? r.json.results.filter(x=>x.status==='FAIL').map(x=>x.id) : [];
    row.exit=r.code; row.failed=failed;
    const hit = (id)=> m.expect && (m.expect.endsWith('.') ? id.startsWith(m.expect) : id===m.expect);
    // A mutant that only crashes the gate is a WEAKER result than one the gate diagnoses:
    // exit!=0 with no parsed results means the harness died, not that a check spoke.
    row.diagnosed = failed.length>0;
    if(m.expectMiss){
      // An asserted BLIND SPOT. Documenting a known gap as a passing expectation keeps it
      // visible and makes it fail loudly the day the gate grows enough teeth to see it —
      // at which point delete the expectMiss, not the mutation.
      row.known = true;
      row.caught = (r.code===0);
      if(!row.caught){ bad++; row.note = `now DETECTED by ${failed.join(', ')} — drop expectMiss and promote it`; }
    } else {
      row.caught = r.code!==0 && failed.some(hit);
      if(!row.caught){ bad++; row.note = r.code===0 ? 'GATE STILL PASSED' :
        (failed.length? `red, but '${m.expect}' did not fire` : 'gate crashed without reporting'); }
    }
  }catch(e){ bad++; row.setupError=e.message; }
  finally{ fs.rmSync(dir,{recursive:true,force:true}); }
  rows.push(row);
  const tag = row.setupError ? `${C.y}SETUP${C.n}`
            : row.known     ? (row.caught?`${C.y}KNOWN${C.n} `:`${C.r}MISSED${C.n}`)
            : row.caught    ? `${C.g}CAUGHT${C.n}` : `${C.r}MISSED${C.n}`;
  console.log(`  ${tag}  ${row.id.padEnd(8)} ${m.what}`);
  if(row.setupError) console.log(`           ${C.y}${row.setupError}${C.n}`);
  else console.log(`           ${C.d}exit ${row.exit} · ${m.expectMiss?'asserted blind spot':`expected '${m.expect}'`} · fired: ${row.failed.join(', ')||'(none)'}${row.note?'  <- '+row.note:''}${C.n}`);
}

const n=rows.length, known=rows.filter(r=>r.known).length;
console.log(`\n${bad? C.r+'SELF-TEST FAILED'+C.n : C.g+'SELF-TEST PASSED'+C.n}  —  ${n-bad}/${n} as expected`
  + (known?`  (${known} asserted blind spot${known>1?'s':''})`:''));
process.exit(bad?1:0);
