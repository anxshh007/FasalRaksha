# Deploying Fasal Raksha

Three pieces run: **PostgreSQL**, the **API** (Fastify, Node 24), and the **PWA** (static files).
The forecast pipeline is not a service — it is a batch job whose output, a sealed bundle release,
is committed to this repository and loaded into the database at deploy time.

Nothing here needs a third-party account to *work*: every adapter has a mock, and the demonstration
runs entirely on mocks. Going live is a matter of setting `*_ADAPTER=live` and supplying credentials,
one adapter at a time.

---

## 0 · What has to be true before you start

| | |
|---|---|
| Node | 24.x (the API and the build both assume it) |
| PostgreSQL | 16 or newer; 18 is what this was built against |
| Disk for photographs | Any writable directory, or an S3-compatible bucket behind the same `PhotoStore` interface |
| Secrets | Two 32-byte hex strings you generate yourself — see below. **Never** reuse the ones in `.env.example`; there are none to reuse. |

Generate the two secrets:

```bash
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('DB_CONTEXT_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

`DB_CONTEXT_KEY` is shared with the database: it signs the actor assertion that row-level security
trusts (migration 0002). If it is wrong, every query fails closed — which is the intended direction.

---

## 1 · The database

Create a database and three roles. The API **must not** connect as the owner: it connects as a
`NOSUPERUSER`, `NOBYPASSRLS`, non-owner role, and refuses to start otherwise (ARCH-03).

```bash
# DATABASE_SUPERUSER_URL points at the new PostgreSQL; DATABASE_NAME defaults to `fasal`.
pnpm db:bootstrap    # creates the roles and the database, applies every migration, installs the
                     # request-context key, and writes the URLs and secrets into a gitignored .env
```

`db:bootstrap` is the whole of step 1 on a database you control. If the roles already exist —
a managed instance where you were handed a connection string — apply migrations on their own:

```bash
DATABASE_OWNER_URL=postgres://fasal_owner:…@host:5432/fasal pnpm db:migrate
```

Then load the committed bundle release — the prices, forecasts, storage and transport tariffs the
phone verifies and computes from:

```bash
DATABASE_OWNER_URL=... pnpm bundles:publish
```

And, for a demonstration, the seeded traders and the consignment (§16.1). Skip this for a real
deployment; it is what CUTS C-09 and C-11 describe:

```bash
DATABASE_OWNER_URL=... pnpm db:seed-demo
```

Migrations are immutable once applied: an edited migration stops the next deploy rather than
letting two environments diverge silently.

---

## 2 · The API

```bash
pnpm install --frozen-lockfile
pnpm --filter @fasal/shared build
pnpm --filter @fasal/api build
node apps/api/dist/server.js
```

Environment, with `.env.example` as the full list. The minimum:

```
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=8787
DATABASE_URL=postgres://fasal_app:…@host:5432/fasal   # the least-privilege role
DB_CONTEXT_KEY=<32 bytes hex>
AUTH_SECRET=<32 bytes hex>
CORS_ORIGINS=https://your-pwa-domain
PHOTO_STORE_DIR=/var/lib/fasal/photos                 # writable, persistent
```

In production `NODE_ENV=production` also stops one-time codes being returned in the sign-in
response. Without a real `MESSAGING_ADAPTER=live`, nobody can sign in — which is correct, and is
the first adapter to make live.

**Health:** `GET /api/health` reports `{ ok, database }` and is what a platform should poll.

---

## 3 · The PWA — and why it shares the API's origin

```bash
pnpm --filter @fasal/web build     # → apps/web/dist
```

**The app and the API must answer on one origin.** The phone fetches `/api/…` relatively, sends
`credentials: 'same-origin'`, and its refresh token is an httpOnly cookie scoped to `/api/auth` —
a token the page can read is a token an injected script can steal, so the page cannot read it.
Splitting the app onto a static host and the API onto another domain breaks sign-in.

The simplest way to give them one origin is to let the API serve the files:

```
WEB_DIST_DIR=/app/apps/web/dist
```

With that set, the API serves the shell at `/` and at any route the app owns, `no-cache` on the
shell and on `sw.js`, `immutable` on the content-hashed files under `/assets/`, and still answers
its own `/api` — where an unknown endpoint is a refusal, never the shell. Unset, the API serves
only `/api` and you put a reverse proxy (Caddy, nginx, a platform rewrite) in front that routes
`/api/*` to the API and everything else to the files. Either shape works; two unrelated domains
does not.

The PWA needs **HTTPS** for the camera (`getUserMedia` requires a secure context) and for the
service worker. `localhost` is exempt; nothing else is.

---

## 4 · Adapters: mock to live, one at a time

Every adapter is switched by one environment variable, and a live adapter missing a credential
**fails at boot** rather than falling back silently to the mock (Constitution §15).

| Variable | Live means | Needs |
|---|---|---|
| `MESSAGING_ADAPTER` | Real SMS one-time codes | `SMS_GATEWAY_URL`, `SMS_GATEWAY_KEY`, `SMS_TEMPLATE_ID` |
| `MARKET_ADAPTER` | Agmarknet/OGD daily prices | `MARKET_API_KEY` (and `MARKET_RESOURCE_ID` if not the default) |
| `WEATHER_ADAPTER` | Open-Meteo forecasts | nothing — it is a public API |
| `REGISTRY_ADAPTER` | Real PM-KISAN / AgriStack lookup | `REGISTRY_GATEWAY_URL`, `REGISTRY_GATEWAY_KEY` |
| `SPEECH_ADAPTER` | Bhashini speech-to-text | `BHASHINI_URL`, `BHASHINI_KEY`, `BHASHINI_SERVICE_IDS` |
| `MODEL_FALLBACK_ADAPTER` | Server-side language model fallback | `ANTHROPIC_API_KEY` |
| `STORAGE_ADAPTER`, `TRANSPORT_ADAPTER` | Real warehouse and tariff directories | `LOGISTICS_GATEWAY_URL`, `LOGISTICS_GATEWAY_KEY` |
| `CHANNEL_SECRET` | Opens the WhatsApp/SMS/IVR webhooks | a shared secret your gateway presents |

Judge Mode (`#/_judge`) reports which mode each adapter is actually in, so a deployment can be
checked rather than assumed. Two things follow automatically from `REGISTRY_ADAPTER=live`: the
demonstration sign-in list disappears (CUTS C-14), and the seeded traders stop being relevant.

---

## 5 · A worked example: one service on Render

Any platform with a managed PostgreSQL and a persistent disk works the same way. One service
serves both halves, which is what §3 asks for.

**Database** — create a PostgreSQL instance and copy its connection string.

**Web service** — from this repository:

- Build:
  ```
  pnpm install --frozen-lockfile && pnpm -r build
  ```
- Start: `node apps/api/dist/server.js`
- Health check path: `/api/health`
- Disk: mount one and point `PHOTO_STORE_DIR` at it, or photographs vanish on the next deploy.
- Environment: §2's list, plus `WEB_DIST_DIR=/opt/render/project/src/apps/web/dist` (whatever the
  platform's checkout path is — it is the absolute path of `apps/web/dist` on that machine).

**Before the first start**, against the same database, from a one-off job or your own machine:

```bash
DATABASE_OWNER_URL=…  pnpm db:migrate
DATABASE_OWNER_URL=…  pnpm bundles:publish
DATABASE_OWNER_URL=…  pnpm db:seed-demo      # only if it is a demonstration
```

`CORS_ORIGINS` matters only if something else is calling the API from a browser; with one origin
the app never needs it.

**First check after deploying:** open `#/_judge`. It names the release loaded, its age, and every
adapter's mode. If the release is `null`, `bundles:publish` has not run against that database.
If sign-in never arrives, `MESSAGING_ADAPTER` is still `mock` in production, where one-time codes
are deliberately not returned to the caller.

---

## 6 · Refreshing the data

The pipeline is a batch job, run wherever you like — a laptop, a CI schedule, a cron container:

```bash
pnpm ml:pipeline        # ingest → clean → climatology → features → forecast → validate → export
pnpm bundles:publish    # seal the release and load it into the database
```

It writes a new dated release under `data/bundles/`. Phones pick it up on their next sync, verify
its integrity hash, and keep the previous one if the new one does not parse. Staleness is a rule,
not a nag: past a crop's limit (7 days for perishables, 14 for grains) the advice disappears on its
own and the price stays, with its date on it.

---

## 7 · Before a live deployment, not before a demonstration

The build is a prototype and says so. Three things to fix before real farmers use it:

- **Contact relay.** `contact_grants` issues a masked handle; nothing yet relays a call or a
  message through it. Until that exists the grant is a record, not a channel.
- **The FPO and officer consoles.** Both roles are first-class in the database with tested
  endpoints and no screens (CUTS C-10, C-12).
- **Grade models.** `fieldValidated: false` everywhere: they are trained on rendered lots, not
  photographs of real produce (CUTS C-06). The farmer always confirms the grade, and the
  provenance is recorded — but the proposal should be retrained on field data before it is leaned
  on commercially.
