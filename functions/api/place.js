// Cloudflare Pages Function — deployed automatically at  /api/place
//
// Enriches one clinic with Google Places data (rating, review count, hours, type)
// WITHOUT exposing the Google API key to the browser. The key lives in a Cloudflare
// secret (env.GOOGLE_PLACES_KEY). Results are cached ~30 days at the edge so repeat
// lookups don't re-bill Google (and stay within Google's caching guidance).
//
// Call it from the app like:
//   fetch(`/api/place?name=${encodeURIComponent(c.name)}&lat=${c.lat}&lon=${c.lon}`)
//   → { placeId, rating, reviews, openNow, types }
//
// Same-origin (served from your Pages domain), so no CORS or key exposure.

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') || '').trim();
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'name, lat and lon are required' }, 400);
  }
  if (!env.GOOGLE_PLACES_KEY) {
    return json({ error: 'GOOGLE_PLACES_KEY not configured' }, 500);
  }

  // Cache key normalized to name + ~100m cell so tiny coordinate jitter still hits cache.
  const cacheKey = new Request(
    `https://vetric.cache/place?n=${encodeURIComponent(name.toLowerCase())}` +
    `&la=${lat.toFixed(3)}&lo=${lon.toFixed(3)}`
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Google Places API (New) — Text Search, biased to the clinic's location.
  let payload;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY,
        // Field mask keeps the bill low — we only pay for the fields we ask for.
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.rating,places.userRatingCount,' +
          'places.currentOpeningHours.openNow,places.types',
      },
      body: JSON.stringify({
        textQuery: `${name} veterinary`,
        locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 800 } },
        maxResultCount: 1,
      }),
    });
    if (!res.ok) return json({ error: `places ${res.status}` }, 502);
    const data = await res.json();
    const p = (data.places || [])[0];
    payload = p
      ? {
          placeId: p.id || null,
          name: p.displayName?.text || null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          reviews: p.userRatingCount || 0,
          openNow: p.currentOpeningHours?.openNow ?? null,
          types: p.types || [],
        }
      : { placeId: null, rating: null, reviews: 0, types: [] };
  } catch (e) {
    return json({ error: 'upstream fetch failed' }, 502);
  }

  const resp = json(payload, 200, { 'Cache-Control': 'public, max-age=2592000' });
  // Stash a clone in the edge cache for next time (best-effort).
  try { await cache.put(cacheKey, resp.clone()); } catch (e) {}
  return resp;
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
