// POST /api/ai — the Vetric AI brain. Proxies chat + tool-calling to Cloudflare Workers AI
// (FREE tier — no API key, ~10k neurons/day) via the `AI` binding. The FRONT-END owns the tool
// registry and executes tools against live app state; this endpoint only runs the model.
// Session-gated by functions/_middleware.js like every other /api route (except /api/auth/*),
// so only allow-listed users can spend the daily free allocation.
//
// Setup (one-time, dashboard): Pages project → Settings → Bindings → Add → Workers AI →
// variable name "AI" (Production and Preview). Until then this returns a friendly 503.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';   // free-tier model with function calling

async function _rateOK(env, key, limit, ttl) {
  try {
    const n = parseInt(await env.VETRIC_KV.get(key) || '0', 10);
    if (n >= limit) return false;
    await env.VETRIC_KV.put(key, String(n + 1), { expirationTtl: ttl });
  } catch (e) {}
  return true;
}
export async function onRequestPost({ request, env }) {
  try {
    // 30 AI calls / 10 min per IP — a chat turn is 1-5 calls (agentic rounds); protects the
    // shared Workers AI free-tier quota from a runaway or scripted client.
    const _ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await _rateOK(env, 'rl:ai:' + _ip, 30, 600)))
      return json({ error: 'Vetric AI is cooling down — try again in a few minutes.' }, 429);
    if (!env.AI) return json({ error: 'Vetric AI isn’t configured yet — add the Workers AI binding "AI" to the Pages project (Settings → Bindings), then redeploy.' }, 503);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const messages = Array.isArray(body && body.messages) ? body.messages.slice(-40) : null;
    const tools = Array.isArray(body && body.tools) ? body.tools : undefined;
    if (!messages || !messages.length) return json({ error: 'no messages' }, 400);
    for (const m of messages) { if (m && typeof m.content === 'string' && m.content.length > 8000) m.content = m.content.slice(0, 8000); }

    const out = await env.AI.run(MODEL, { messages, tools, max_tokens: 900, temperature: 0.2 });
    return json({ response: (out && out.response) || null, tool_calls: (out && out.tool_calls) || null });
  } catch (e) {
    return json({ error: 'AI error — ' + String((e && e.message) || 'unknown').slice(0, 200) }, 500);
  }
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
