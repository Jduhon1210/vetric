// GET /api/auth/me — lets the front-end show the real signed-in email (avatar initials, sign-out
// label) without ever touching localStorage. By the time index.html can even run this fetch,
// _middleware.js has already guaranteed the request is authenticated — this just reads WHO.
export async function onRequestGet({ request, env }) {
  const token = _readCookie(request, 'vf_session');
  const raw = token ? await env.VETRIC_KV.get('session:' + token) : null;
  if (!raw) return json({ authed: false });
  let email = null;
  try { email = JSON.parse(raw).email; } catch (e) {}
  return json({ authed: true, email });
}
function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
