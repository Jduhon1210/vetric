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
//
// LICENSING TIERS (2026-07-12):
//   - Revocation is live, not login-time: every request re-checks that the session's email is
//     still on the allow-list, so deleting "allow:<email>" (or revoking in the admin panel)
//     cuts existing sessions off on their next request — not 30 days later.
//   - Demo (metro-licensed) sessions get SLICED data: a request for a statewide proprietary
//     file is internally rewritten to its per-metro slice (pe-data-dfw.js etc., committed by
//     build-region-slices.mjs). The statewide dataset never reaches a metro-licensed browser.
//     Fail-open by design: any error in the rewrite serves the normal asset — a pilot seeing
//     more data beats a pilot seeing a broken app (trust is contractual at this scale).
const PUBLIC_PATHS = new Set(['/login', '/favicon.ico', '/favicon.svg']);

// Statewide proprietary files → their per-metro slices. tx-zips.json (public Census geography)
// and the dfw-* context files are deliberately NOT gated — the proprietary asset is the clinic
// intelligence, not public boundaries.
const REGION_SLICES = {
  dfw: {
    '/pe-data.js': '/pe-data-dfw.js',
    '/vet-clinics.js': '/vet-clinics-dfw.js',
    '/vet-staff.js': '/vet-staff-dfw.js',
    '/vet-species.js': '/vet-species-dfw.js',
    '/vet-services.js': '/vet-services-dfw.js'
  }
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path) || path.startsWith('/api/auth/')) {
    return next();
  }

  const token = _readCookie(request, 'vf_session');
  const raw = token ? await env.VETRIC_KV.get('session:' + token) : null;

  if (!raw) return _deny(request, url);

  let sess = {};
  try { sess = JSON.parse(raw) || {}; } catch (e) {}

  // Sessions minted BEFORE the licensing update carry no tier — re-read the account record
  // instead of defaulting to full access (a pre-update pilot session must not leak the
  // statewide files until its next login). One extra KV read, only for legacy sessions.
  if (sess.email && sess.tier === undefined) {
    try {
      const acct = JSON.parse(await env.VETRIC_KV.get('acct:' + sess.email) || 'null');
      if (acct) { sess.tier = acct.tier || 'full'; sess.regions = (Array.isArray(acct.regions) && acct.regions.length) ? acct.regions : ['tx']; }
    } catch (e) {}
  }

  // Live revocation: session is only as good as its allow-list entry.
  if (sess.email) {
    const allow = await env.VETRIC_KV.get('allow:' + sess.email);
    if (!allow) {
      try { await env.VETRIC_KV.delete('session:' + token); } catch (e) {}
      return _deny(request, url);
    }
  }

  // Metro slicing for demo-tier sessions (regions without statewide access).
  if (sess.tier === 'demo' && Array.isArray(sess.regions) && !sess.regions.includes('tx')) {
    const region = sess.regions[0];
    const map = REGION_SLICES[region];
    const sliced = map && map[path];
    if (sliced) {
      try {
        const res = await env.ASSETS.fetch(new URL(sliced, url.origin));
        if (res && res.ok) {
          const h = new Headers(res.headers);
          h.set('Cache-Control', 'private, max-age=300');   // per-user body on a shared URL — keep it out of shared caches
          h.delete('ETag');
          return new Response(res.body, { status: 200, headers: h });
        }
      } catch (e) { /* fall through to the normal asset */ }
    }
  }

  return next();
}

function _deny(request, url) {
  // Browser navigation → send them to the sign-in page. Anything else (a direct fetch of a
  // data file, an API call) → a flat 401 so it fails closed instead of returning HTML.
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) {
    return Response.redirect(url.origin + '/login', 302);
  }
  return new Response('Unauthorized', { status: 401 });
}

function _readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
