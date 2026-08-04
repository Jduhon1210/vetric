// GET /api/auth/me — lets the front-end show the real signed-in email (avatar initials, sign-out
// label) without ever touching localStorage. By the time index.html can even run this fetch,
// _middleware.js has already guaranteed the request is authenticated — this just reads WHO.
// Also returns the account's licensing metadata (tier/firm/regions/started) from the session
// snapshot, so the client can show the demo badge and the admin panel. Sessions created before
// the licensing update carry no tier — they read as full access.
export async function onRequestGet({ request, env }) {
  const token = _readCookie(request, 'vf_session');
  const raw = token ? await env.VETRIC_KV.get('session:' + token) : null;
  if (!raw) return json({ authed: false });
  let s = {};
  try { s = JSON.parse(raw) || {}; } catch (e) {}
  return json({
    authed: true,
    email: s.email || null,
    tier: s.tier || 'full',
    regions: (Array.isArray(s.regions) && s.regions.length) ? s.regions : ['tx'],
    firm: s.firm || null,
    started: s.started || null
  });
}
function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
