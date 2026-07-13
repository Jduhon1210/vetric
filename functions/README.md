# Vetric access control — setup guide

Real, server-side, invite-only login. Nobody without an allow-listed email can reach the app
OR the raw data files (`pe-data.js`, `vet-clinics.js`, `vet-staff.js`, `tx-zips.json`, etc.) —
the gate is enforced by `functions/_middleware.js` on every single request, not just a
client-side flag.

**How it works (access-code mode — current):** visitor enters their email + the access code you
gave them at `/login` → server checks the KV allow-list entry (its VALUE is that person's access
code) → match issues a real session cookie (30 days) → in. No emails are sent at all (the
email-code flow was removed 2026-07-08 to stay inside the Resend free tier — it's in git history
if we ever want it back). Not on the list = stopped at the login screen with "This email doesn't
have access yet." Wrong code = "Incorrect access code" (max 10 tries per 5 minutes per email).

## One-time setup (do this in the Cloudflare dashboard — I can't do this part for you)

### 1. Create a KV namespace
**Workers & Pages → KV** (left sidebar) → **Create a namespace** → name it `vetric-auth` → Create.

### 2. Bind it to your Pages project
Your Pages project (**vetfinder**) → **Settings → Functions → KV namespace bindings** → **Add binding**:
- Variable name: `VETRIC_KV`
- KV namespace: `vetric-auth`

Do this for **both Production and Preview** (there's a separate toggle for each), or preview
deploys will 500 on every request.

### 3. ~~Set up Resend~~ — NOT needed in access-code mode
The `RESEND_API_KEY` / `RESEND_FROM` variables are currently unused (no emails are sent).
Keep them if they're already set — harmless — and they'll matter again only if the email-code
flow is ever restored. Skip the rest of this section.

<details><summary>Old Resend instructions (only for restoring the email-code flow)</summary>

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
</details>

### 4. Add the people who are allowed in
**Workers & Pages → KV → vetric-auth** → **Add entry**:
- Key: `allow:their.email@company.com` (**must be lowercase**)
- Value: **their access code** — a code YOU choose (e.g. `mesa-vet-2026`). You give it to them
  directly (text, call, email — your choice). The value IS the credential, so don't use `1`
  or anything guessable; a couple of words + numbers is plenty.

Any old entry with value `1` (from the email-code era) can't sign in until you edit its value
to a real code. Add one entry per person; to revoke access, delete their entry (existing
sessions remain valid until they expire in 30 days, or also delete their `session:*` key).

### 5. Enable Vetric AI (Workers AI binding — free tier)
The AI tab (chat assistant) runs on **Cloudflare Workers AI** — free allocation (~10,000
neurons/day), no API key, no card. One binding:
**Pages project → Settings → Bindings → Add → Workers AI** → variable name **`AI`**
(Production and Preview). Until it's added, the AI tab answers with a friendly
"not configured yet" message — nothing breaks. Only signed-in (allow-listed) users can reach
`/api/ai`, so strangers can't burn the daily allocation.

### 6. Make yourself the admin (licensing panel — one KV record)
The licensing system (Settings → **Access & licensing**: pilot accounts, demo tags, per-metro
data) is driven by optional `acct:<email>` KV records next to the `allow:` entries. Accounts
WITHOUT a record are full-access — nothing changes for existing users. To unlock the admin
panel for yourself, add ONE record in the dashboard (KV → your namespace → Add entry):

- **Key**: `acct:jondduhon@gmail.com`
- **Value**: `{"tier":"admin","firm":"Vetric","regions":["tx"],"started":"2026-07-12"}`

Then sign out and back in (the tier is stamped into the session at login). Your Settings modal
gains the **Access & licensing** tab: every account with firm, phase tag (Demo/Licensed/Admin),
start date, access code, market, and last login — plus an add/update form and revoke buttons.
From there you manage everything in the UI; no more dashboard edits.

How the tiers behave:
- **Demo / pilot** (`tier:"demo"`, `regions:["dfw"]`): the middleware serves DFW-sliced data
  files (`pe-data-dfw.js` etc. — the statewide files never reach their browser), the map is
  locked to the DFW box, a "Demo · DFW metroplex" badge shows in the header, and CSV exports
  are disabled. Regenerate slices after a data refresh: `node build-region-slices.mjs`.
- **Licensed** (`tier:"full"` or no acct record): everything, statewide.
- **Admin**: full access + the licensing panel. You can't revoke or demote yourself.
- Revoking (panel or deleting the `allow:` entry) cuts live sessions on their NEXT request —
  the middleware re-checks the allow-list every time, so it's immediate, not in 30 days.

### 7. Redeploy
Push this code to `main` (or trigger a deploy) so Cloudflare Pages picks up the new
`functions/` files. Once deployed, `vetric.co` will redirect anyone without a session to
`/login`.

## Testing it
1. Set your own `allow:` entry's VALUE to an access code of your choosing.
2. Visit `vetric.co` in an incognito window → should redirect to `/login`.
3. Enter your email + that access code → should land on the real app, avatar shows your initials.
4. Wrong code → "Incorrect access code." · unknown email → "doesn't have access yet."
5. Click the avatar (sign out) → should bounce back to `/login`, and reloading `vetric.co`
   directly should redirect to `/login` again (session is really gone, not just hidden).

## Files
- `_middleware.js` — the gate; runs on every request.
- `login.js` — the public sign-in page (`/login`), self-contained (no external JS/CSS).
- `api/auth/login.js` — checks email + access code against the allow-list, issues the session
  cookie. (The old `request-code.js`/`verify-code.js` email-OTP pair was removed 2026-07-08;
  recover from git history to restore that flow.)
- `api/auth/logout.js` — kills the session server-side.
- `api/auth/me.js` — lets the app show who's signed in (for the avatar) + the account's
  licensing tier/firm/regions (for the demo badge and admin panel).
- `api/admin/accounts.js` — the licensing roster API (admin-only): list / upsert / revoke.
