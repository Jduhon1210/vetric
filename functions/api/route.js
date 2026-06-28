// Cloudflare Pages Function — proxies Google Routes computeRouteMatrix so the API key stays
// SERVER-SIDE. POST /api/route  body: { origin:{lat,lon}, destinations:[{lat,lon},...] }
// Returns: { durations: [{ i, s }] }  where i = destinationIndex, s = drive seconds (null = no route).
// Uses TRAFFIC_UNAWARE (typical drive time → the cheapest "Basic" Routes tier, $5/1k elements).
// Setup: enable Routes API in Google Cloud + allow it on the GOOGLE_PLACES_KEY.
export async function onRequestPost({ request, env }) {
  const key = env.GOOGLE_PLACES_KEY;
  if (!key) return json({ error: 'Routes not configured' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const o = body && body.origin, dests = body && body.destinations;
  const okPt = p => p && isFinite(+p.lat) && isFinite(+p.lon) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lon) <= 180;
  if (!okPt(o) || !Array.isArray(dests) || !dests.length || dests.length > 200 || !dests.every(okPt))
    return json({ error: 'bad params' }, 400);

  const wp = p => ({ waypoint: { location: { latLng: { latitude: +p.lat, longitude: +p.lon } } } });
  const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
    },
    body: JSON.stringify({
      origins: [wp(o)],
      destinations: dests.map(wp),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  if (!r.ok) { const t = await r.text(); return json({ error: 'routes failed', detail: t.slice(0, 200) }, 502); }

  let arr;
  try { arr = await r.json(); } catch (e) { return json({ error: 'bad upstream' }, 502); }
  // Elements can arrive out of order — key on destinationIndex.
  const durations = (Array.isArray(arr) ? arr : []).map(e => ({
    i: e.destinationIndex,
    s: (e.condition === 'ROUTE_EXISTS' && e.duration) ? parseInt(e.duration, 10) : null,
  }));
  return json({ durations });
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
