// /api/admin/accounts — the licensing roster behind Settings → Access & licensing.
// Admin-only (the caller's acct record must say tier "admin" — checked FRESH from KV, not from
// the session snapshot, so demoting an admin takes effect immediately).
//
//   GET    → [{email, code, firm, tier, regions, started, lastSeen}] from the allow-list
//   POST   {email, code, firm, tier, regions} → upsert allow:<email> + acct:<email>
//            (started is preserved on update, stamped today on create)
//   DELETE ?email= → remove allow:/acct:/seen: — live sessions die on their next request
//            (the middleware re-checks the allow-list per request)
//
// Self-lockout guards: an admin cannot revoke their own entry or drop their own admin tier.
export async function onRequest(context) {
  const { request, env } = context;
  const admin = await _requireAdmin(request, env);
  if (!admin) return json({ error: 'Admin access required.' }, 403);

  try {
    if (request.method === 'GET') return await _list(env);
    if (request.method === 'POST') return await _upsert(request, env, admin);
    if (request.method === 'DELETE') return await _remove(request, env, admin);
    return json({ error: 'Method not allowed.' }, 405);
  } catch (e) {
    return json({ error: 'Server error — try again in a moment.' }, 500);
  }
}

async function _requireAdmin(request, env) {
  const token = _readCookie(request, 'vf_session');
  const raw = token ? await env.VETRIC_KV.get('session:' + token) : null;
  if (!raw) return null;
  let email = null;
  try { email = (JSON.parse(raw) || {}).email; } catch (e) {}
  if (!email) return null;
  try {
    const acct = JSON.parse(await env.VETRIC_KV.get('acct:' + email) || 'null');
    return (acct && acct.tier === 'admin') ? email : null;
  } catch (e) { return null; }
}

async function _list(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.VETRIC_KV.list({ prefix: 'allow:', cursor });
    for (const k of page.keys) {
      const email = k.name.slice('allow:'.length);
      const [code, acctRaw, lastSeen] = await Promise.all([
        env.VETRIC_KV.get(k.name),
        env.VETRIC_KV.get('acct:' + email),
        env.VETRIC_KV.get('seen:' + email)
      ]);
      let acct = null;
      try { acct = acctRaw ? JSON.parse(acctRaw) : null; } catch (e) {}
      out.push({
        email,
        code: code === '1' ? null : code,
        firm: (acct && acct.firm) || null,
        tier: (acct && acct.tier) || 'full',
        regions: (acct && Array.isArray(acct.regions) && acct.regions.length) ? acct.regions : ['tx'],
        started: (acct && acct.started) || null,
        lastSeen: lastSeen || null
      });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (a.firm || '￿').localeCompare(b.firm || '￿') || a.email.localeCompare(b.email));
  return json({ accounts: out });
}

async function _upsert(request, env, adminEmail) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const email = String((body && body.email) || '').trim().toLowerCase();
  const code = String((body && body.code) || '').trim();
  const firm = String((body && body.firm) || '').trim();
  const tier = String((body && body.tier) || 'demo');
  const regions = (Array.isArray(body && body.regions) && body.regions.length) ? body.regions.map(String) : ['dfw'];
  if (!email || !email.includes('@')) return json({ error: 'A valid email is required.' }, 400);
  if (!code || code === '1' || code.length < 4) return json({ error: 'Access code must be at least 4 characters.' }, 400);
  if (!['admin', 'demo', 'full'].includes(tier)) return json({ error: 'Unknown tier.' }, 400);
  if (email === adminEmail && tier !== 'admin') return json({ error: "You can't remove your own admin access." }, 400);

  // Prefer the admin's LOCAL date from the form — the server's UTC day rolls over at ~7pm
  // Central, which stamped evening signups "tomorrow". Existing accounts keep their date.
  let started = /^\d{4}-\d{2}-\d{2}$/.test(String(body && body.started || '')) ? body.started : new Date().toISOString().slice(0, 10);
  try {
    const prev = JSON.parse(await env.VETRIC_KV.get('acct:' + email) || 'null');
    if (prev && prev.started) started = prev.started;
  } catch (e) {}

  await env.VETRIC_KV.put('allow:' + email, code);
  await env.VETRIC_KV.put('acct:' + email, JSON.stringify({ firm: firm || null, tier, regions, started }));
  return json({ ok: true, email, started });
}

async function _remove(request, env, adminEmail) {
  const email = String(new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ error: 'email required' }, 400);
  if (email === adminEmail) return json({ error: "You can't revoke your own access." }, 400);
  await env.VETRIC_KV.delete('allow:' + email);
  await env.VETRIC_KV.delete('acct:' + email);
  try { await env.VETRIC_KV.delete('seen:' + email); } catch (e) {}
  return json({ ok: true });
}

function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
