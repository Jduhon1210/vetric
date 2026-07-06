// GET /login — the ONLY page reachable without a session (see _middleware.js). Fully
// self-contained (no external JS/CSS) so it can never be blocked by the gate it sits in front of.
export async function onRequestGet() {
  return new Response(HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Vetric</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:'Inter',system-ui,-apple-system,sans-serif;}
  .card{width:380px;max-width:calc(100vw - 32px);background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(15,23,42,.14);padding:32px 30px;}
  .brand{display:flex;align-items:center;gap:9px;margin-bottom:22px;}
  .brand-logo{width:30px;height:30px;border-radius:8px;background:linear-gradient(160deg,#1e3a8a,#1e293b);display:flex;align-items:center;justify-content:center;}
  .brand-word{font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-.01em;}
  .brand-word span{color:#1e3a8a;}
  h1{font-size:19px;font-weight:800;color:#0f172a;margin:0 0 4px;}
  .sub{font-size:13px;color:#64748b;margin:0 0 20px;line-height:1.5;}
  label{font-size:12.5px;font-weight:600;color:#334155;display:block;margin-bottom:5px;}
  input{width:100%;padding:10px 12px;border:1px solid #d7dee8;border-radius:9px;font-size:14px;font-family:inherit;margin-bottom:14px;}
  input:focus{outline:none;border-color:#1e3a8a;box-shadow:0 0 0 3px rgba(30,58,138,.1);}
  button{width:100%;padding:11px;border:0;border-radius:9px;background:#1e3a8a;color:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;}
  button:disabled{opacity:.6;cursor:default;}
  button:hover:not(:disabled){background:#1e3562;}
  .err{font-size:12.5px;color:#dc2626;min-height:16px;margin:-6px 0 10px;}
  .msg{font-size:12.5px;color:#15803d;margin:-6px 0 10px;line-height:1.5;}
  .step{display:none;} .step.on{display:block;}
  .back{font-size:12px;color:#64748b;text-decoration:none;display:inline-block;margin-top:12px;cursor:pointer;}
  .back:hover{color:#1e3a8a;}
  .code-input{letter-spacing:8px;font-size:20px;font-weight:700;text-align:center;font-family:ui-monospace,monospace;}
</style></head>
<body>
  <div class="card">
    <div class="brand"><div class="brand-logo"></div><div class="brand-word">Vet<span>ric</span></div></div>

    <div id="step1" class="step on">
      <h1>Sign in to Vetric</h1>
      <p class="sub">Enter your email and we'll send you a one-time sign-in code.</p>
      <form id="f1" onsubmit="return reqCode(event)">
        <label for="email">Email</label>
        <input id="email" type="email" placeholder="you@company.com" required autofocus>
        <div class="err" id="err1"></div>
        <button id="btn1" type="submit">Send code</button>
      </form>
    </div>

    <div id="step2" class="step">
      <h1>Enter your code</h1>
      <p class="sub">We sent a 6-digit code to <b id="sentTo"></b>. It expires in 10 minutes.</p>
      <form id="f2" onsubmit="return verify(event)">
        <label for="code">Sign-in code</label>
        <input id="code" class="code-input" inputmode="numeric" maxlength="6" placeholder="000000" required>
        <div class="err" id="err2"></div>
        <button id="btn2" type="submit">Verify &amp; sign in</button>
      </form>
      <a class="back" onclick="goBack()">&larr; Use a different email</a>
    </div>
  </div>
<script>
let currentEmail='';
async function reqCode(e){
  e.preventDefault();
  const email=document.getElementById('email').value.trim();
  const err=document.getElementById('err1'), btn=document.getElementById('btn1');
  err.textContent=''; btn.disabled=true; btn.textContent='Sending…';
  try{
    const r=await fetch('/api/auth/request-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const d=await r.json();
    if(!r.ok){ err.textContent=d.error||'Something went wrong.'; btn.disabled=false; btn.textContent='Send code'; return false; }
    currentEmail=email;
    document.getElementById('sentTo').textContent=email;
    document.getElementById('step1').classList.remove('on');
    document.getElementById('step2').classList.add('on');
    document.getElementById('code').focus();
  }catch(ex){ err.textContent='Network error — try again.'; }
  btn.disabled=false; btn.textContent='Send code';
  return false;
}
async function verify(e){
  e.preventDefault();
  const code=document.getElementById('code').value.trim();
  const err=document.getElementById('err2'), btn=document.getElementById('btn2');
  err.textContent=''; btn.disabled=true; btn.textContent='Verifying…';
  try{
    const r=await fetch('/api/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:currentEmail,code})});
    const d=await r.json();
    if(!r.ok){ err.textContent=d.error||'Invalid code.'; btn.disabled=false; btn.textContent='Verify & sign in'; return false; }
    window.location.href='/';
  }catch(ex){ err.textContent='Network error — try again.'; btn.disabled=false; btn.textContent='Verify & sign in'; }
  return false;
}
function goBack(){ document.getElementById('step2').classList.remove('on'); document.getElementById('step1').classList.add('on'); document.getElementById('err2').textContent=''; }
</script>
</body></html>`;
