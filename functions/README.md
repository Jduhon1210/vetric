# Vetric access control — setup guide

Real, server-side, invite-only login. Nobody without an allow-listed email can reach the app
OR the raw data files (`pe-data.js`, `vet-clinics.js`, `vet-staff.js`, `tx-zips.json`, etc.) —
the gate is enforced by `functions/_middleware.js` on every single request, not just a
client-side flag.

**How it works:** visitor enters their email at `/login` → if it's on your allow-list, they get
a 6-digit code by email (10-min expiry) → they enter it → they get a real session cookie
(30 days) → in. Not on the list = stopped right at the login screen with "This email doesn't
have access yet" (an explicit rejection — the owner chose clear UX over hiding who's invited).

## One-time setup (do this in the Cloudflare dashboard — I can't do this part for you)

### 1. Create a KV namespace
**Workers & Pages → KV** (left sidebar) → **Create a namespace** → name it `vetric-auth` → Create.

### 2. Bind it to your Pages project
Your Pages project (**vetfinder**) → **Settings → Functions → KV namespace bindings** → **Add binding**:
- Variable name: `VETRIC_KV`
- KV namespace: `vetric-auth`

Do this for **both Production and Preview** (there's a separate toggle for each), or preview
deploys will 500 on every request.

### 3. Set up Resend (sends the code emails) — free tier covers this easily
1. Sign up at **resend.com** (free: 100 emails/day, 3,000/month — plenty for invite-only access)
2. **API Keys** → create one → copy it
3. Back in Cloudflare: Pages project → **Settings → Environment variables** → add:
   - `RESEND_API_KEY` = the key you just copied (Production **and** Preview)
   - `RESEND_FROM` = `Vetric <onboarding@resend.dev>` to start (works immediately, no setup) —
     once you verify `vetric.co` in Resend (Domains → Add Domain → add the DNS records it gives
     you, which you can add directly in Cloudflare DNS since you already own the domain there),
     switch this to `Vetric <you@vetric.co>` so the emails come from your own domain.

**Until `RESEND_API_KEY` is set, the code is generated and stored but no email is sent** — the
app won't break, sign-in just won't work yet. Set this before you send anyone the link.

### 4. Add the people who are allowed in
**Workers & Pages → KV → vetric-auth** → **Add entry**:
- Key: `allow:their.email@company.com` (**must be lowercase**)
- Value: anything — a name or `1` is fine, only the key's presence matters

Add one entry per person. To revoke access, delete their entry — their next code request is
rejected at the login screen (existing sessions remain valid until they expire in 30 days or
you also delete their `session:*` key, which you can look up if needed).

### 5. Redeploy
Push this code to `main` (or trigger a deploy) so Cloudflare Pages picks up the new
`functions/` files. Once deployed, `vetric.co` will redirect anyone without a session to
`/login`.

## Testing it
1. Add your own email as an `allow:` entry.
2. Visit `vetric.co` in an incognito window → should redirect to `/login`.
3. Enter your email → check your inbox for the code (once Resend is configured).
4. Enter the code → should land on the real app, avatar shows your initials.
5. Click the avatar (sign out) → should bounce back to `/login`, and reloading `vetric.co`
   directly should redirect to `/login` again (session is really gone, not just hidden).

## Files
- `_middleware.js` — the gate; runs on every request.
- `login.js` — the public sign-in page (`/login`), self-contained (no external JS/CSS).
- `api/auth/request-code.js` — checks the allow-list, emails a code.
- `api/auth/verify-code.js` — checks the code, issues the session cookie.
- `api/auth/logout.js` — kills the session server-side.
- `api/auth/me.js` — lets the app show who's signed in (for the avatar).
