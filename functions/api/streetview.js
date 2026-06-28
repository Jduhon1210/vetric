// Cloudflare Pages Function — proxies Google Street View Static so the API key stays
// SERVER-SIDE (never shipped to the browser). Route: GET /api/streetview?lat=..&lon=..
// Returns a JPEG (edge-cached 30 days) or HTTP 204 when no panorama exists nearby.
//
// Setup required (one-time):
//   1. Google Cloud → enable "Street View Static API" and allow your API key to call it.
//   2. Cloudflare Pages → Settings → Environment variables → add GOOGLE_PLACES_KEY (Production).
// Until both are done the image just won't render (the popup degrades gracefully).
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const key = env.GOOGLE_PLACES_KEY;
  if (!key) return new Response('Street View not configured', { status: 503 });
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return new Response('bad params', { status: 400 });
  const loc = lat.toFixed(6) + ',' + lon.toFixed(6);

  // Edge cache — a location's Street View is static, so cache hard and serve repeats for free.
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/streetview?loc=' + loc);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Metadata is FREE — skip the billable image call entirely when there's no panorama.
  let meta = null;
  try {
    meta = await (await fetch('https://maps.googleapis.com/maps/api/streetview/metadata?location=' +
      loc + '&radius=60&source=outdoor&key=' + key)).json();
  } catch (e) {}
  if (!meta || meta.status !== 'OK') return new Response(null, { status: 204 });

  const img = await fetch('https://maps.googleapis.com/maps/api/streetview?size=440x220&location=' +
    loc + '&fov=78&radius=60&source=outdoor&return_error_code=true&key=' + key);
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
