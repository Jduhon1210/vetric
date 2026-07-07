// POST /api/auth/request-code   { email }
// If the email is on the allowlist (a KV key "allow:<email>", added manually by the admin —
// see functions/README.md), emails a 6-digit one-time code (10-min TTL). ALWAYS returns the
// same generic success message whether or not the email is allowed, so this endpoint can't be
// used to probe who has access.
export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const email = String((body && body.email) || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return json({ error: 'Enter a valid email.' }, 400);

    const allowed = await env.VETRIC_KV.get('allow:' + email);
    if (allowed) {
      const cooldownKey = 'cooldown:' + email;
      // Light throttle: max 1 code per minute per email. NOTE: Cloudflare KV's MINIMUM
      // expirationTtl is 60 seconds — a smaller value makes put() THROW (was 30 → error 1101).
      if (!(await env.VETRIC_KV.get(cooldownKey))) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await env.VETRIC_KV.put('code:' + email, code, { expirationTtl: 600 });
        await env.VETRIC_KV.put(cooldownKey, '1', { expirationTtl: 60 });
        await _sendCodeEmail(env, email, code);
      }
    }
    // Same response either way — do not leak allowlist membership.
    return json({ ok: true, message: 'If that email has access, a sign-in code is on its way.' });
  } catch (e) {
    // Always answer JSON — an unhandled throw becomes Cloudflare's HTML "error 1101" page,
    // which the login page's r.json() can't parse (surfaced to users as a generic network error).
    return json({ error: 'Server error — try again in a moment.' }, 500);
  }
}

async function _sendCodeEmail(env, to, code) {
  if (!env.RESEND_API_KEY) return; // graceful no-op until Resend is configured (see functions/README.md)
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'Vetric <onboarding@resend.dev>',
        to: [to],
        subject: 'Your Vetric sign-in code',
        html: '<div style="font-family:system-ui,sans-serif;color:#1f2933">'
          + '<p>Your Vetric sign-in code is:</p>'
          + '<p style="font-family:ui-monospace,monospace;font-size:30px;font-weight:800;letter-spacing:6px;color:#1e3a8a">' + code + '</p>'
          + '<p style="color:#64748b;font-size:13px">Expires in 10 minutes. If you didn\'t request this, you can ignore this email.</p></div>',
      }),
    });
  } catch (e) { /* best-effort — the code still exists in KV for 10 min if the send fails */ }
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
