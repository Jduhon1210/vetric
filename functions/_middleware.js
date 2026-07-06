// Cloudflare Pages Function — the single access gate for the ENTIRE site. Every request
// (index.html, the data files, everything) passes through here first. This is what makes
// access control REAL: it protects the raw data files themselves (pe-data.js, vet-clinics.js,
// vet-staff.js, tx-zips.json...), not just the visible page — someone can't just curl the
// JSON directly to bypass a client-side check.
//
// Public (no session required): /login (the sign-in page), /api/auth/* (the sign-in flow
// itself — has to be reachable before you're signed in), and favicon.
//
// Everything else requires a valid vf_session cookie backed by a live session record in KV.
// Setup required (one-time, in the Cloudflare dashboard — see functions/README.md):
//   1. Workers & Pages → KV → create a namespace (e.g. "vetric-auth").
//   2. This Pages project → Settings → Functions → KV namespace bindings →
//      variable name "VETRIC_KV" → bind to that namespace (do this for Production AND Preview).
const PUBLIC_PATHS = new Set(['/login', '/favicon.ico']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path) || path.startsWith('/api/auth/')) {
    return next();
  }

  const token = _readCookie(request, 'vf_session');
  const session = token ? await env.VETRIC_KV.get('session:' + token) : null;

  if (!session) {
    // Browser navigation → send them to the sign-in page. Anything else (a direct fetch of a
    // data file, an API call) → a flat 401 so it fails closed instead of returning HTML.
    const accept = request.headers.get('Accept') || '';
    if (accept.includes('text/html')) {
      return Response.redirect(url.origin + '/login', 302);
    }
    return new Response('Unauthorized', { status: 401 });
  }

  return next();
}

function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
