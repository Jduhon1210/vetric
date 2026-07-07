// GET /login — the ONLY page reachable without a session (see _middleware.js). Self-contained
// aside from Google Fonts (fine pre-auth; the app itself already uses Google Fonts).
// Aesthetic: Resend-inspired composition in Vetric's navy brand palette — deep blue gradient,
// large serif display type, light-blue accents, white pill CTA.
export async function onRequestGet() {
  return new Response(HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Vetric</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;}
  body{background:linear-gradient(160deg,#1a2c66 0%,#14204f 45%,#0d1535 100%);color:#eef2ff;font-family:'Inter',system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden;}
  /* quiet depth — a soft light-blue glow low in the frame */
  body::before{content:"";position:fixed;left:50%;bottom:-40vh;width:130vw;height:80vh;transform:translateX(-50%);background:radial-gradient(ellipse at center,rgba(147,197,253,.14) 0%,rgba(147,197,253,.045) 40%,transparent 70%);pointer-events:none;}
  body::after{content:"";position:fixed;inset:0;background-image:radial-gradient(circle at 1px 1px,rgba(255,255,255,.05) 1px,transparent 0);background-size:28px 28px;pointer-events:none;mask-image:radial-gradient(ellipse at 50% 40%,black 0%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse at 50% 40%,black 0%,transparent 75%);}

  .wrap{width:100%;max-width:392px;position:relative;z-index:1;}
  .brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:42px;}
  .brand-logo{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(10,18,48,.5);}
  .brand-logo svg{width:19px;height:19px;}
  .brand-word{font-size:17px;font-weight:700;letter-spacing:-.01em;color:#fff;}
  .brand-word span{color:#93c5fd;}

  h1{font-family:'Newsreader',Georgia,serif;font-weight:300;font-size:40px;line-height:1.12;letter-spacing:-.01em;color:#fff;text-align:center;margin-bottom:12px;}
  h1 em{font-style:italic;color:#bfdbfe;}
  .sub{font-size:14.5px;line-height:1.65;color:#b7c4ee;text-align:center;margin-bottom:36px;}
  .sub b{color:#e0e7ff;font-weight:600;}

  label{display:block;font-size:12.5px;font-weight:600;color:#dbe4ff;margin-bottom:8px;letter-spacing:.01em;}
  input{width:100%;padding:13px 16px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:12px;font-size:15px;font-family:inherit;color:#fff;margin-bottom:16px;transition:border-color .15s,box-shadow .15s,background .15s;}
  input::placeholder{color:#8194c9;}
  input:focus{outline:none;background:rgba(255,255,255,.10);border-color:#93c5fd;box-shadow:0 0 0 4px rgba(147,197,253,.14);}
  .code-input{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:24px;font-weight:600;letter-spacing:10px;text-align:center;padding:14px 8px 14px 18px;}

  button{width:100%;padding:13px;border:0;border-radius:999px;background:#fff;color:#14204f;font-size:14.5px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 6px 22px rgba(10,18,48,.35);transition:opacity .15s,transform .05s;}
  button:hover:not(:disabled){opacity:.9;}
  button:active:not(:disabled){transform:translateY(1px);}
  button:disabled{opacity:.5;cursor:default;}

  .err{font-size:13px;color:#fda4af;min-height:18px;margin:-6px 0 12px;text-align:center;}
  .step{display:none;} .step.on{display:block;animation:rise .35s ease;}
  @keyframes rise{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
  .back{display:block;text-align:center;font-size:13px;color:#b7c4ee;text-decoration:none;margin-top:22px;cursor:pointer;transition:color .15s;}
  .back:hover{color:#fff;}
  .foot{position:relative;z-index:1;margin-top:56px;font-size:12px;color:#7d8dbd;text-align:center;}
  .foot a{color:#93a3d1;text-decoration:none;}
</style></head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="brand-logo"><svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="14" width="3.4" height="7" rx="1.2" fill="#fff" opacity="0.55"/>
        <rect x="8.3" y="10" width="3.4" height="11" rx="1.2" fill="#fff" opacity="0.75"/>
        <rect x="13.6" y="6" width="3.4" height="15" rx="1.2" fill="#fff"/>
      </svg></div>
      <div class="brand-word">Vet<span>ric</span></div>
    </div>

    <div id="step1" class="step on">
      <h1>Market intelligence,<br><em>by invitation.</em></h1>
      <p class="sub">Enter your email and we'll send you a one-time sign-in code.</p>
      <form id="f1" onsubmit="return reqCode(event)">
        <label for="email">Email</label>
        <input id="email" type="email" placeholder="you@company.com" autocomplete="email" required autofocus>
        <div class="err" id="err1"></div>
        <button id="btn1" type="submit">Continue</button>
      </form>
    </div>

    <div id="step2" class="step">
      <h1><em>Check your inbox.</em></h1>
      <p class="sub">We sent a 6-digit code to <b id="sentTo"></b><br>It expires in 10 minutes.</p>
      <form id="f2" onsubmit="return verify(event)">
        <label for="code">Sign-in code</label>
        <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
        <div class="err" id="err2"></div>
        <button id="btn2" type="submit">Sign in</button>
      </form>
      <a class="back" onclick="goBack()">&larr; Use a different email</a>
    </div>
  </div>
  <div class="foot">Vetric · Veterinary market intelligence · Access is by invitation</div>
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
    if(!r.ok){ err.textContent=d.error||'Something went wrong.'; btn.disabled=false; btn.textContent='Continue'; return false; }
    currentEmail=email;
    document.getElementById('sentTo').textContent=email;
    document.getElementById('step1').classList.remove('on');
    document.getElementById('step2').classList.add('on');
    document.getElementById('code').focus();
  }catch(ex){ err.textContent='Network error — try again.'; }
  btn.disabled=false; btn.textContent='Continue';
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
    if(!r.ok){ err.textContent=d.error||'Invalid code.'; btn.disabled=false; btn.textContent='Sign in'; return false; }
    window.location.href='/';
  }catch(ex){ err.textContent='Network error — try again.'; btn.disabled=false; btn.textContent='Sign in'; }
  return false;
}
function goBack(){ document.getElementById('step2').classList.remove('on'); document.getElementById('step1').classList.add('on'); document.getElementById('err2').textContent=''; }
</script>
</body></html>`;
