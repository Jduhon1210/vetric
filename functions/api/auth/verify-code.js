// POST /api/auth/verify-code   { email, code }
// On a match: issues a real session — a random token stored in KV (30-day TTL) and set as an
// HttpOnly cookie. This is what _middleware.js checks on every subsequent request.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const email = String((body && body.email) || '').trim().toLowerCase();
  const code = String((body && body.code) || '').trim();
  if (!email || !code) return json({ error: 'Missing email or code.' }, 400);

  const stored = await env.VETRIC_KV.get('code:' + email);
  if (!stored || stored !== code) return json({ error: 'Invalid or expired code.' }, 401);

  await env.VETRIC_KV.delete('code:' + email);

  const token = _randomToken();
  const THIRTY_DAYS = 60 * 60 * 24 * 30;
  await env.VETRIC_KV.put('session:' + token, JSON.stringify({ email, created: Date.now() }), { expirationTtl: THIRTY_DAYS });

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'vf_session=' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + THIRTY_DAYS + '; Path=/');
  return new Response(JSON.stringify({ ok: true, email }), { status: 200, headers });
}
function _randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
