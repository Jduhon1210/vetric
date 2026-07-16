// Cloudflare Pages Function — proxies Google Street View Static so the API key stays
// SERVER-SIDE (never shipped to the browser). Route: GET /api/streetview?lat=..&lon=..
// Returns a JPEG (edge-cached 30 days) or HTTP 204 when no panorama exists nearby.
//
// Setup required (one-time):
//   1. Google Cloud → enable "Street View Static API" and allow your API key to call it.
//   2. Cloudflare Pages → Settings → Environment variables → add GOOGLE_PLACES_KEY (Production).
// Until both are done the image just won't render (the popup degrades gracefully).
async function _rateOK(env, key, limit, ttl) {
  try {
    const n = parseInt(await env.VETRIC_KV.get(key) || '0', 10);
    if (n >= limit) return false;
    await env.VETRIC_KV.put(key, String(n + 1), { expirationTtl: ttl });
  } catch (e) {}
  return true;
}
export async function onRequestGet({ request, env }) {
  // 200 images / 10 min per IP — generous for human browsing (popups load 1-2 each, and the
  // edge cache absorbs repeats), a wall for anyone scripting against the paid Google key.
  const _ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await _rateOK(env, 'rl:sv:' + _ip, 200, 600))) return new Response('rate limited', { status: 429 });
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const key = env.GOOGLE_PLACES_KEY;
  if (!key) return new Response('Street View not configured', { status: 503 });
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return new Response('bad params', { status: 400 });
  const loc = lat.toFixed(6) + ',' + lon.toFixed(6);
  const big = url.searchParams.get('big') === '1';          // expanded/lightbox view
  const size = big ? '640x400' : '440x220';                 // 640 is the Street View Static max

  // Edge cache — a location's Street View is static, so cache hard and serve repeats for free.
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/streetview?loc=' + loc + (big ? '&big=1' : ''));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Metadata is FREE — skip the billable image call entirely when there's no panorama.
  let meta = null;
  try {
    meta = await (await fetch('https://maps.googleapis.com/maps/api/streetview/metadata?location=' +
      loc + '&radius=60&source=outdoor&key=' + key)).json();
  } catch (e) {}
  if (!meta || meta.status !== 'OK') return new Response(null, { status: 204 });

  const img = await fetch('https://maps.googleapis.com/maps/api/streetview?size=' + size + '&location=' +
    loc + '&fov=' + (big ? '90' : '78') + '&radius=60&source=outdoor&return_error_code=true&key=' + key);
  if (!img.ok) return new Response(null, { status: 204 });

  const resp = new Response(img.body, {
    status: 200,
    headers: {
      'Content-Type': img.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  });
  try { await cache.put(cacheKey, resp.clone()); } catch (e) {}
  return resp;
}
