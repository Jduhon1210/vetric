// POST /api/auth/logout — kills the session server-side (not just the cookie), so the token
// can't be reused even if someone captured it before logout.
export async function onRequestPost({ request, env }) {
  const token = _readCookie(request, 'vf_session');
  if (token) { try { await env.VETRIC_KV.delete('session:' + token); } catch (e) {} }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'vf_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
