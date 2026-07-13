// POST /api/auth/login   { email, key }
// Access-key sign-in (no emails sent — replaces the one-time-code flow for now; that code is in
// git history if we ever switch back). The KV allow-list entry doubles as the credential:
//   key  = "allow:<lowercase email>"
//   value = the access key the admin chose for that person (NOT "1" — a real code, e.g. "prosper-2026")
// Match → same 30-day KV-backed session cookie as before. Delete the entry to revoke new logins.
// Light brute-force guard: 10 failed tries per email per 5 minutes.
//
// LICENSING TIERS (2026-07-12): an optional "acct:<email>" KV record carries the account's
// licensing metadata: {firm, tier, regions, started}. tier = "admin" (sees the access-management
// panel in Settings) | "demo" (pilot account: data files are served as metro slices by
// _middleware.js, exports disabled client-side) | "full". NO record = full access — every
// pre-existing account keeps working untouched. The matched acct snapshot is embedded in the
// session record so the middleware and /api/auth/me don't need extra KV reads per request.
export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const email = String((body && body.email) || '').trim().toLowerCase();
    const key = String((body && body.key) || '').trim();
    if (!email || !email.includes('@') || !key) return json({ error: 'Enter your email and access code.' }, 400);

    const failKey = 'fail:' + email;
    const fails = parseInt(await env.VETRIC_KV.get(failKey) || '0', 10);
    if (fails >= 10) return json({ error: 'Too many attempts — try again in a few minutes.' }, 429);

    const stored = await env.VETRIC_KV.get('allow:' + email);
    if (!stored) {
      return json({ error: "This email doesn't have access yet. Contact Vetric to request an invitation." }, 403);
    }
    if (stored === '1') {
      // Legacy entry from the code-email era — the admin hasn't set an access key for it yet.
      return json({ error: 'No access code is set for this email yet — contact Vetric.' }, 403);
    }
    if (stored !== key) {
      // KV minimum TTL is 60s; 300 gives a 5-minute rolling penalty window.
      await env.VETRIC_KV.put(failKey, String(fails + 1), { expirationTtl: 300 });
      return json({ error: 'Incorrect access code.' }, 401);
    }

    // Licensing metadata (absent = full-access legacy account; a parse error must never block login)
    let acct = null;
    try { const rawAcct = await env.VETRIC_KV.get('acct:' + email); if (rawAcct) acct = JSON.parse(rawAcct); } catch (e) { acct = null; }
    const tier = (acct && acct.tier) || 'full';
    const regions = (acct && Array.isArray(acct.regions) && acct.regions.length) ? acct.regions : ['tx'];
    const firm = (acct && acct.firm) || null;
    const started = (acct && acct.started) || null;

    const token = _randomToken();
    const THIRTY_DAYS = 60 * 60 * 24 * 30;
    await env.VETRIC_KV.put('session:' + token, JSON.stringify({ email, created: Date.now(), tier, regions, firm, started }), { expirationTtl: THIRTY_DAYS });
    // Last-seen stamp for the admin panel (best-effort — never blocks the login)
    try { await env.VETRIC_KV.put('seen:' + email, new Date().toISOString()); } catch (e) {}

    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'vf_session=' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + THIRTY_DAYS + '; Path=/');
    return new Response(JSON.stringify({ ok: true, email }), { status: 200, headers });
  } catch (e) {
    // Always answer JSON — an unhandled throw becomes Cloudflare's HTML error page, which the
    // login page's r.json() can't parse (would surface as a generic network error).
    return json({ error: 'Server error — try again in a moment.' }, 500);
  }
}
function _randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
