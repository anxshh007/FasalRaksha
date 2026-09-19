# Architecture map

The re-anchoring document for *how* the system is put together. `SPEC.md` is *what*;
`CONSTITUTION.md` is what cannot be broken; `REQUIREMENTS.csv` is what is real so far.

---

## 1 · The one rule, drawn

> **Precompute on the server, ship the output, compute every user-specific value on the device.**

```
                        ┌─────────────────────────── nightly, the only place a model runs ─┐
 data/raw/  ──ingest──► │ ml/ingest → clean → validate → climatology → features            │
 (synthetic,§4.4)       │   → raksha (RK-1…RK-6, RK-8) → evaluate (forward-chain, skill)   │
                        │   → export  ──► data/bundles/  crop×district JSON (~2 KB)        │
                        │                 + msp.json, crops.json, climatology/<district>   │
                        │   → vision  ──► data/models/  per-family INT8 ONNX (<5 MB)       │
                        └──────────────────────────────┬────────────────────────────────────┘
                                                       │ versioned · ETag · sha256 integrity
                       ┌───────────────────────────────▼──────────────────────────────┐
                       │ apps/api  (Fastify, zod at every boundary, pino w/o PII)     │
                       │   bundles · market · raksha · listings · offers · deals ·    │
                       │   payments · reputation · disputes · pools · contact grants  │
                       │   adapters: Mock* | Live* (switch by .env, never by code)    │
                       │        │ authenticate → BEGIN → set_config(actor, LOCAL) →   │
                       │        ▼ query → RLS decides                                 │
                       │   PostgreSQL 18 — fasal_app: NOSUPERUSER NOBYPASSRLS, owns   │
                       │   nothing; contacts in separate tables; append-only audit    │
                       └───────▲────────────────────────▲─────────────────▲──────────┘
             outbox drain       │  (mutations only,      │ webhooks         │
             (idempotent)       │   server-authoritative │                  │
  ┌─────────────────────────────┴───┐              ┌─────┴───────┐   ┌──────┴──────┐
  │ apps/web  PWA (React 18, Vite)  │              │ WhatsApp    │   │ SMS · IVR   │
  │  SW: SWR bundles, cache shell   │              │ apps/       │   │ apps/       │
  │  Dexie: bundles, profile,       │              │ channels    │   │ channels    │
  │   listings, deals, outbox,      │              └─────┬───────┘   └──────┬──────┘
  │   photo Blobs, model artefacts  │                    │                  │
  │  camera worker (OffscreenCanvas)│                    │                  │
  │  ONNX Runtime Web (lazy)        │                    │                  │
  └──────────────┬──────────────────┘                    │                  │
                 │ every farmer-screen number            │                  │
                 ▼                                       ▼                  ▼
       ┌──────────────────────────────────────────────────────────────────────┐
       │ @fasal/shared — the ONE implementation (pure TS, zero deps, no I/O)  │
       │ units · parser · benchmark · staleness · decision (RK-7, RK-9) ·     │
       │ matching · aggregation · dealstate+dispute · vision post-processing ·│
       │ bundle (schema, integrity) · constants · i18n                        │
       └──────────────────────────────────────────────────────────────────────┘
                 ▲ parity: golden vectors in data/golden/, equal to 1e-9
                 └──────────── ml/ (Python mirrors of features and decisions)
```

**Why this is legal:** the model predicts `crop × district × horizon`, never the farmer
(Constitution §4). The output space is small and enumerable, so it ships instead of being
served. Lot size, storage access, cash position and the sell/wait verdict are computed on the
device (RK-7, RK-9) and never reach the model. **There is no live inference endpoint.**

**Dependency rules** (enforced by tests as they become checkable):
`@fasal/shared` depends on nothing (ARCH-01). `apps/web`, `apps/api`, `apps/channels` depend on
`@fasal/shared` and never on each other. `ml/` depends on nothing in TypeScript and is held to
`@fasal/shared` by parity tests, not imports.

## 2 · Repository

```
MVP V-3/
├── PROMPT.md  CONSTITUTION.md  SPEC.md  REQUIREMENTS.csv  CUTS.md  README.md
├── reference/phase1/FasalRakshak_1.html     visual + behavioural source of truth
├── reference/report/                         technical report (docx + extracted text)
├── docs/                                     ARCHITECTURE.md (this) · PHASE1-STUDY.md
├── packages/shared/src/                      @fasal/shared                       [P2]
├── apps/api/src/{config,log,db,http}         foundation                          [P1 ✓]
│             src/modules/<domain>/           auth · farmers · buyers · fpos · market · forecast ·
│                                             raksha · matching · aggregation · vision · listings ·
│                                             offers · deals · logistics · storage · payments ·
│                                             reputation · disputes · grievances · registry ·
│                                             messaging · bundles · audit          [P3–P19]
│             src/adapters/<name>/{mock,live} nine adapters, one contract suite  [P4]
├── apps/web/src/                             PWA                                 [P1 shell ✓, P8+]
│   └── design/                               tokens.css · type.css · glyphs/     [P9]
├── apps/channels/                            whatsapp · sms · ivr                [P19]
├── ml/{generate,ingest,clean,validate,climatology,features,raksha,vision,evaluate,export}/  [P5–P7, P12]
├── data/{raw,reference,golden,bundles}/
├── infra/{docker-compose.yml, migrations/}   + seed/, e2e/ as they land
├── tools/                                    requirements audit · verify · (gates, contrast, budgets)
└── .github/workflows/ci.yml
```

Folders are created when their first real file lands — an empty module is not scaffolding
worth committing.

## 3 · Decisions taken in P1, and why

| Decision | Reason |
|---|---|
| **pnpm 10** installed per-user (`npm i -g pnpm`) | Stack lock (§3.2). `corepack enable` needs admin; a user-prefix install does not. V-2 had to substitute npm; V-3 does not. |
| **TypeScript 6.0**, not 7.0 | 7.0 (native port) is out, but `typescript-eslint` supports `<6.1`. 6.0 is the stable JS-API release; moving to 7 is a version bump, not a rewrite. |
| Strict everywhere: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `verbatimModuleSyntax` | "TS strict" (§3.2), taken literally. Index access and optional-vs-undefined are exactly where unit and price bugs hide. |
| ESM, `NodeNext` for shared/api, `Bundler` for web | Node runs the API's emitted JS directly; the relative-import `.js` discipline makes shared valid in both worlds. |
| `@fasal/shared` exports a **`source` condition** | Vite and Vitest resolve shared to its TypeScript source, so the device and the tests run the same code with no stale `dist` in between; `tsc -b` checks against the emitted declarations. |
| **React 18.3.1** pinned exactly | Locked by §3.2; React 19 is current. |
| Vite 8 · Vitest 5 · Fastify 5 · zod 4 · pino 10 · pg 8 | Current majors, compatible with each other and with React 18. |
| **Real PostgreSQL via `embedded-postgres`** locally (CUTS C-01), `postgres:18` in compose and CI | No Docker on this machine. A real server beats V-2's in-process PGlite: separate login roles, a real pool, the production driver. |
| Two DB roles: `fasal_owner` (migrations) and `fasal_app` (API) | §8.1: the app connects `NOBYPASSRLS`, never superuser, never owner. `assertLeastPrivilege` refuses to boot otherwise. |
| `set_config(key, value, true)` instead of `SET LOCAL` | Identical transaction scope, but parameterisable — no string-built SQL for identities. |
| Accessors named `app.actor_id()` / `app.actor_role()` | `current_role` is a reserved SQL keyword; the GUC names stay `app.current_user_id` / `app.current_role` as §8.1 specifies. |
| Tables will `FORCE ROW LEVEL SECURITY` | Proven in P1: with FORCE, even the owner sees nothing without an actor. Seeding must therefore set an actor or run before FORCE. |
| Migrations: SQL files, SHA-256 checksummed, advisory-locked, one transaction each | Edited or missing applied migrations stop the run (ARCH-05). |
| **LF everywhere** (`.gitattributes`), bundles/golden `-text` | Bundle integrity is a hash of bytes; a CRLF checkout must not break an honest bundle. |
| One seed, `26132`, for every random source | §14.2 determinism; chosen so nobody shops for a luckier seed. |
| Logs scrubbed at three points (merge object, serializers, final line) | §8.5; a detector test asserts both "redacts the seeded phone" and "leaves SHA-256 digests alone" (V-2 lesson). |
| `/api/health` is `no-store` and reports measured DB reachability | V-2 lesson: `navigator.onLine` and cached 200s lie about connectivity. Field mode (P8) will measure. |

### Decisions taken in P6–P7

| Decision | Reason |
|---|---|
| Seasonal profiles, arrival norms and weather climatology are built from **earlier years only** | PROMPT §5.2 says leave-current-year-out. In forward-chaining validation that must also leave *later* years out, or a 2025 profile leaks into a 2023 test fold. The first P6 run did exactly this and looked better for it. |
| Widening, layer weights and the wait threshold are **scored held out** (fold k judged by what folds before k taught) | Otherwise the coverage and wait-precision columns grade their own homework. Calibration-fold coverage is still printed, labelled "≥ nominal by construction". |
| RK-8: a **tie for first place reads FLAT** | Evidence that splits UP/DOWN contradicts itself; it must never read as a direction. |
| `bandKappa` **measured** from the spread of a-day price moves | The first derivation (the h14/h7 width ratio) pinned volatile onion at the floor. √(W² + R_a²) is what a band read a days late must cover. |
| The pipeline confidence is **the device's GR-3 formula in price terms** | confidenceMin is calibrated in Python and applied on the phone; golden vectors hold the two to 1e-9. |
| Bundle = **Python-sealed core + TypeScript publisher** | The pipeline owns what it measured; MSP, storage and transport come from the constants module and adapters. The publisher verifies every Python seal in TypeScript: parity on every real artefact, not only on vectors. |
| Served body = **canonical JSON**, ETag = integrity | Disk, database and wire carry the same bytes; revalidation of an unchanged bundle is a bodiless 304. |
| A **release** switches atomically (`bundle_releases` row written last) | A phone can never mix one night's forecast with another night's climatology. |
| Bundles parsed by a **dependency-free strict parser in `@fasal/shared`**, not zod | Shared has zero runtime dependencies (ARCH-01), and the API and the device must refuse exactly the same documents. Unknown keys are errors: a new field is a new schema version. |
| `generatedAt` is the run's **logical time** (02:00 IST after as-of) | Reruns with the same `--as-of` are byte-identical (§14.2); the wall clock would make every run a new hash. |
| Releases are **committed** under `data/bundles/<version>/` | The app runs, and `pnpm db:start` serves prices, without the Python pipeline installed. |

### Decisions taken in P8

| Decision | Reason |
|---|---|
| The home screen reads **only IndexedDB** (Dexie); the network only refreshes it | Gate A by construction: with the API dead, nothing on the render path waits on a request. |
| Failures classified as **unreachable / rejected / failed**, never from `navigator.onLine` | §XI: a missing network must never sign a farmer out; only a server that answers "no" can. Captive portals report online (V-2 lesson). |
| **Single-flight session refresh** | Refresh tokens rotate with reuse detection (P3); React StrictMode's double effect would otherwise present one token twice and end the session. |
| Access token **in memory only**; refresh token an httpOnly cookie; the profile cached with its confirmation time | An XSS payload cannot lift a long-lived credential from storage; offline, the farmer is restored and the screen can say how old the profile is. |
| Device verifies every bundle (hash + manifest integrity + strict parser) before it replaces anything | SEC-14 on the phone; a failed document is logged for Judge Mode and the last verified copy stays. |
| SW precache list **generated from the built `dist/`**, version = hash of file contents | V-2 hand-listed the shell and missed hashed assets; the first offline reload then failed. |
| SW shell match uses **`ignoreVary`** | Vite's server sends `Vary: Origin`, module scripts carry Origin: without it the offline reload found index.html but not its script. Found by the Gate A run, not assumed. |
| Bundle requests from the sync are network-first with a **marked** cache fallback | The sync must see a real 304/200; a cached answer is labelled `x-fasal-from-cache` so it is never mistaken for the server (V-2 lesson). |
| `POST /api/outbox`: one entry per request, **idempotent under its key**, request hash checked | A 2G retry replays the recorded answer; the same key with different content is a 409, not an overwrite. Kinds whose features come later answer 501 and stay on the phone. |
| Price alerts are the first real outbox kind (migration 0006) | The only offline-queueable action with no dependency on later phases; it gives the outbox a true round trip now. District is taken from the verified profile on the server (P1-04). |
| Farmer location = the **market town the village names**, else the district centroid, and it says which | The registry gives a village name, not coordinates; GR-7 needs a distance. No arbitrary constant location (P1-04). |
| E2E in the **installed Microsoft Edge** (`channel: 'msedge'`) with a stack supervisor that really kills the API process | No browser download (G-4 closed); "kill the backend" is a SIGKILL of a real process over a real PostgreSQL, not a mocked route. |

### Decisions taken in P9

| Decision | Reason |
|---|---|
| Tokens in `design/tokens.css` for NIGHT (default) and FIELD, switched by `data-theme` on `<html>` | §9.3–§9.4: one identity, two first-class themes; nothing else writes a colour (checked by `interface.test.ts`). |
| `--text-faint` corrected to pass AA (CUTS C-04) | The specified values fail §9.10; the contrast test computes all 246 pairs from the shipped tokens and prints the table. |
| Figures in **Latin digits with Indian grouping** in every language (`mr-IN-u-nu-latn`) | Every figure is DM Mono for tabular alignment (§9.5), and DM Mono has no Devanagari digits. Mixed fallback produced `₹३ , ५०८`. Words stay Marathi; dates read `18 सप्टेंबर, 2026`. |
| Self-hosted woff2 subsets, own `@font-face` rules (Latin for Manrope/DM Sans/DM Mono, Devanagari for Noto) | P1-12 and offline: precached with the shell; Fontsource's CSS would also ship .woff fallbacks and double what a 2G phone stores. ₹ comes from Noto's Devanagari subset through the font stack. |
| Theme and language read from IndexedDB **before first render** | No theme flash; `lang` is right for the first text drawn. An IndexedDB read, never a network request. |
| Record spine: vertical rail ≥ 700px, top band on a phone | §9.6 wants a full-height spine; at 360px a 72px rail would take a fifth of the screen, so the phone gets the same items as a band. |
| Navigation shows only built sections | §9.7's four tabs arrive as their phases land; a tab to a page that does not exist would be a fake. |
| Drawn glyph set (27 SVGs, 20px grid, 1.25px square-cap stroke) inlined at build | §9.6: no icon library, no emoji; `currentColor` so role and semantic colours carry through. |
| Interface rules enforced by a source scan (`interface.test.ts`) | Security chips, emoji, model terminology, external fonts, stray colours, radii > 4px, blur, gradients and sub-13px text fail the build rather than a review. |
| Visual snapshots at 360 and 1440 in both themes under a fixed clock | A design change is always deliberate (`--update-snapshots`); wall-clock readouts are masked. |

### Decisions taken in P10

| Decision | Reason |
|---|---|
| The briefing leads with **one crop** (remembered choice, else the first with current prices); the rest are compact rows | §9.7: "the farmer's crop is the most important object on the screen". |
| Evidence ledger is a **pure function** (`briefing/evidence.ts`) of bundle + evaluation | Nine rows, each testable; stances are relative to where the evidence as a whole leans, so "arrivals ↑ supporting" can mean arrivals are falling. |
| RK-7 row uses the device's own downside rule, in rupees on the whole lot | The farmer's inputs never leave the phone; the row states the loss against the limit they can bear. |
| Anything ahead rounded to **₹10**; today's rate to the rupee | §9.8: no fake decimal precision on a forecast. |
| `<Tx>` sets only inserted values in DM Mono | A Marathi sentence in a monospace face spaces every word; figures stay tabular. Dates use tabular digits in the interface face. |
| Range bar and sparkline are hand-drawn SVG (1px strokes, `vector-effect: non-scaling-stroke`) with HTML labels | No chart library (§9.9-2); labels never stretch with a responsive band. |
| Lot size is remembered on the phone and recomputes RK-7/GR-7 with **no request** (asserted in the P10 gate) | Constitution §4: farmer inputs are joined to market data only on the device. |

### Decisions taken in P11

| Decision | Reason |
|---|---|
| Three complete interfaces (mr, hi, en); the string table's type requires all three | §10.1 and Gate H: a missing translation fails the build, not a demo. Bengali and Punjabi stay in the shared locale list, offered once their tables exist. |
| The parse runs on every keystroke, on the phone | The shared parser is instant and deterministic; the confirm card updates as the farmer types or as speech arrives. |
| The confirm card's questions *are* the structured form | With no text at all (offline, no recogniser) the card asks crop and quantity directly; a listing never waits on voice. |
| An unmarked price blocks "List for sale" until one tap answers it; a price over 4× or under ¼ of today's rate once normalised is flagged | Gate I / P1-03: the per-kilo-meant-per-quintal mistake produces confident wrong answers, not errors. |
| Offline, the mic records (MediaRecorder) and the server transcribes on reconnection; a transcript fills an empty listing note through the outbox | §10.2: "we do not pretend" recognition works offline; the recording enriches the record, it never gates it. |
| Listings travel through `POST /api/outbox`; an update that overtakes its own create gets 409 `LISTING_NOT_YET_RECEIVED`, which the phone retries | The shared drain order sends creates first, but a failed create must not turn a later edit into a lost one. |
| DATE columns are selected as text | node-pg turns a DATE into local midnight, which is the previous day in UTC (IST is +05:30). |
| Hash routes (`#/sell`, `#/deals`) | Back button and reload work, and one service-worker shell serves every place. |
| Known limit: native date inputs follow the browser's own locale, not the app's | Recorded rather than replaced with a custom picker; the stored value is always ISO. |

### Decisions taken in P12

| Decision | Reason |
|---|---|
| The grader is a fixed descriptor stage (soft colour-signature assignment against 16 learned prototypes, their patchiness, blemish, texture and Laplacian energy at two scales, colour moments) plus a two-layer classifier with **INT8 per-channel weights** dequantised in-graph, one per vision family, about 4.9 KB each | G-3: no PyTorch here and no field photographs. Its contract is a MobileNetV3-Small drop-in (`image` float32 [N,3,224,224] in, `grade_probs` [N,3] out), so trained CNN weights replace one file, not the device code. |
| Trained on **procedurally rendered lots** (`ml/vision/render.py`): packed bulbs, fruit, kernels and bolls on gunny, tarpaulin, concrete or soil, with rot, sprouting, greening, spots, cracks, foreign matter, chaff, mould and pest holes; the grade label is computed from the rendered defect fraction | A laboratory leaf corpus would give near-perfect, meaningless accuracy (§7.6). Held-out figures on rendered lots (exact 0.62–0.86, within one grade ≥ 0.97, INT8 = float ≥ 0.988, accuracy rising with the band) stay in `data/models/report.json`, internal only. `fieldValidated: false` everywhere (CUTS C-06). |
| **ONNX Runtime Web actually runs it**, in the camera's worker, fed the engine bytes the app verified (`env.wasm.wasmBinary`), single-threaded | §7.3, and V-2 left the runtime unwired. `parity.test.ts` proves the phone's own session code reproduces Python's ONNX Runtime numbers on a golden input for all seven models. |
| The 14 MB engine (2.4 MB brotli) and the models load **only when the camera opens**, are pinned by SHA-256 values compiled into the app, cached in IndexedDB after a hash check, never precached, never fetched on 2G | A farmer who never photographs a lot never pays for grading. A corrupt cache is evicted and fetched once more; bytes that do not match the pin are never run (CAM-09). |
| Coverage is measured against the family's **colour signature, block by block** (colour share and texture per 8×8 block), not against the border colour | §7.1 describes a border comparison; a lot that correctly fills the frame has no border. Priors are written from descriptions of the produce (CUTS C-07). |
| Message order kept as §7.1 lists it, with TOO BRIGHT added after TOO DARK; sharpness is gated only when some crop is in view | A washed-out frame is outside the brightness range §7.1 requires; calling it "too dark" would be false. A blank wall reads NO CROP DETECTED, never HOLD STEADY. |
| A capture whose views all fail **for want of crop** (too far, too little, none) is the out-of-distribution outcome; views that fail on **image quality** (dark, bright, blurred) are CAM-10 | §7.2's copy is about coverage ("doesn't show enough of the crop"); a wall, face or shoe chosen from the gallery must get that path and no band, not "no grade: no crop was seen". |
| The band is worded **Confidence / खात्री / भरोसा**: High, Moderate or Low, never a percentage; one view can never be High; an exact tie goes to the lower grade | §7.4's own mock-up; Constitution §8 bans "confidence interval" and numbers, and the interface scan enforces it. |
| The farmer's decision writes the listing (`farmer-declared-ai-assisted` on CONFIRM, `farmer-declared` on CHANGE or a grade given without a proposal); the proposal is stored beside the photo (grade, band, views, model version) | §7.5, and the §7.6 learning loop: photograph + proposal + declaration + (P16) buyer's grade at pickup is one field-labelled example. |
| Photographs upload in **64 KB pieces** to `/api/photos/uploads` (open → PUT at the agreed offset), not through `/api/outbox` | CAM-13 "resumable": on 2G a dropped connection resumes from the server's byte count; the session is keyed by (farmer, listing, content hash), so a retry never makes a second photo. |
| Server hardening (§8.6): magic bytes, 8 MB cap enforced as bytes arrive, header-dimension bomb guard before decode, decoder/sniff agreement, sharp re-encode to JPEG 1280 px q82 with no metadata, SHA-256 check against the phone's fingerprint, a virus-scan hook, server UUID keys, signed-URL serving as a nosniff attachment, 30 sessions an hour, 5 per listing, 200 per account | The phone's EXIF stripping is convenience; the server strips again. G-8: sharp's prebuilt binaries work on this Windows machine. |
| HEIC: the phone converts it where the browser decodes HEIC (Safari) and otherwise refuses it in plain words; the server refuses an undecodable HEIC as `IMAGE_UNDECODABLE` | G-6: no 1 MB WASM decoder. Both are allowed by CAM-07; the prebuilt sharp has no HEVC decoder (patents). |
| The camera is a step inside Sell (`#/sell/photo`), opened only by a tap; a reload lands on Sell with the camera closed | The back button closes it; every way out (close, back, route, hidden tab, closed tab, a stream granted after close) stops every track. |

### Decisions taken in P13

| Decision | Reason |
|---|---|
| The district's demand is one document (`GET /api/demand/:district`), verified on the phone by its integrity hash and a strict shared parser, then stored; the shortlist is ranked **on the phone** by `rankBuyers` | Gate A: the shortlist must render, freshly computed, with the API dead. It also keeps the farmer's lot on the phone: the server is never told what they are about to sell. |
| A buyer's track record reaches the phone only as aggregates, from `app.buyer_track_records`, a SECURITY DEFINER function | Row-level security keeps every deal private to its two parties. The card needs "23 completed deals · pays in ~4 days", not a deal. The function refuses a caller with no asserted actor, application role included. |
| Reputation counts completed deals only: payment days from confirmed payments, a **default** is a delivered deal unpaid 90 days later (exposure capped at that), and an unresolved dispute is shown on the card | §8.9. Risk is then priced from the buyer's own history, so "₹50 more but pays in 90 days" ranks below a prompt payer by arithmetic, not by a rule about days. |
| The demonstration buyers are real rows: accounts, GSTIN verifications, requirements, and their history as completed deals (listing → deal → both deliveries → payment) | The shortlist and the track records are then computed by the production path, not stubbed. Seeded once, flagged `demonstration`, and every screen that shows one says so (CUTS C-09). |
| §16.2's offers (₹1,950 / ₹2,000 / ₹1,900) are **scaled** by today's benchmark ÷ ₹1,840, the market they were written for | At the synthetic ₹3,508 onion price the literal figures fall below the farmer's walk-away price and the engine correctly shows nothing. Scaling keeps every relative gap, so the scenario is the one the specification describes: A above C above B, B's higher gross undone by payment risk. |
| Requirements are refreshed on every seed, priced against the current release and valid around its date; accounts and history are not | A new bundle release moves the benchmark; stale offers would drift away from it and quietly vanish below the walk-away price. |
| The card's headline is what reaches the farmer after freight; the order key also subtracts payment-delay and default cost, and any card offering more than one above it says why | §6.5. A farmer can check every clause: the offer, the distance, the quantity overlap, the gross, the freight, the record. Nothing on the screen asks to be trusted. |
| Buyers left out are counted by reason behind "Why some buyers are not here" | The absence of a buyer the farmer expected is information: another crop, unverified, too far, below the mandi. Silence would look like a bug. |
| A crop with no district price on the phone says so instead of ranking | Scoring an offer with no benchmark to compare it against is exactly P1-06's defect in another form. |

### Decisions taken in P14

| Decision | Reason |
|---|---|
| A consignment's totals — contributors, volume, grade range, shared window — come from `app.pool_totals`, a SECURITY DEFINER function returning sums and counts only | Migration 0003 keeps every membership row private to its own farmer and the coordinator, and that is right: a farmer deciding whether to join needs to know what the consignment holds, not whose lots are in it. Without the function the joining farmer sees a consignment of one lot — their own. |
| Whether a consignment has cleared is written by `app.pool_settle` (migration 0010), derived from the lots in it against the buyer's stated minimum, and both join and leave read the status back out of the table | It is arithmetic, not anybody's opinion. The API used to set it after a join; row-level security silently dropped that UPDATE — a farmer is not the coordinator — and the answer said "cleared" while the database still said "forming". A test that only read the response passed. The DB test now reads the row. |
| Joining and leaving a consignment are the one thing in this build that need a network, and the screen says so in plain words | A join changes what another buyer is promised. Two phones offline could each be told they took the last place. Everything the phone already knows — the consignments your lots are in — is kept in IndexedDB and shown offline like the rest. |
| Aggregation is opt-in twice over: the listing carries `pool_opt_in`, and the farmer taps to join. `pool_members_join` checks both in the database | §6.6. Nobody can pool another farmer's lot, and the check is not in application code that could be forgotten on another path. |
| The panel asks "what could this lot join?" only once the server holds the lot | A lot written in the field has no server id yet, and the server cannot answer about a listing it has not received. It asks the moment the outbox lands, so a listing composed offline finds its consignment without a reload. |
| The demonstration consignment is six member farmers' real listings — 28 quintals against a 30-quintal minimum — joined to a real forming pool, coordinated by a real FPO account | The gate is "a real MOQ cleared from real listings". Two quintals short on purpose: one more farmer's lot is what clears it, through the production path. Seeded once, flagged `demonstration` (CUTS C-09). |
| The farmer's share is shown as quintals of the total, never as a percentage | §8 of the Constitution: no match percentages, and a share is the same arithmetic wearing a different hat. "Your 5 quintals of the 33" is the number that governs the money. |
| The coordinator's own screen is deferred; the FPO account type, its members, its consignments and `POST /api/pools` are built and tested | CUTS C-10. The farmer's side is what §16 demonstrates, and an FPO dashboard nobody walks through in the rehearsal would be untested surface. |

## 4 · Environment (measured 2026-09-19)

Windows 11 · Node 24.19 · pnpm 10.34.5 · Python 3.12.6 (`.venv`, pinned `ml/requirements.txt`) ·
PostgreSQL 18.4 (embedded) · git 2.55. **Not available:** Docker, `psql`, admin rights, PyTorch,
TensorFlow, Playwright browsers (not yet attempted).

## 5 · Gaps and risks, named now

| # | Gap / risk | Plan | Phase |
|---|---|---|---|
| G-1 | No real market dataset | §4.4 synthetic structural process with every §4.2 defect injected; header-tolerant ingest so a real file drops in; labelled synthetic everywhere | P5 |
| G-2 | Policy constants (MSP 2025-26, storage tariffs, e-NWR pledge rate, freight tariffs, spoilage curves) have no machine-readable source here | One `constants` module in `@fasal/shared`, each value with its named source and a `verified` flag; **I will ask you to confirm the values** (§0.4) | P2, P18 |
| G-3 | No PyTorch/TensorFlow; no field-labelled grading images | **Closed in P12:** a descriptor model with an INT8 classifier per family, trained on rendered lots, exported to ONNX and run by ONNX Runtime Web in the camera's worker (parity-tested against Python). `fieldValidated: false`; CUTS C-06 | P12 |
| G-4 | Playwright browsers not installed | **Closed in P8:** Playwright drives the installed Microsoft Edge (`channel: 'msedge'`); no browser download needed | P8 |
| G-5 | Marathi copy must be culturally natural, not machine-translated | I will write it deliberately and flag it for a native-speaker review by the team before the demo | P11 |
| G-6 | HEIC decode on the client needs a WASM decoder (~1 MB) | **Closed in P12:** converted on the phone where the browser decodes HEIC, refused in plain words elsewhere; no decoder shipped | P12 |
| G-7 | Argon2id needs a native module | Try `@node-rs/argon2` (prebuilt, no compiler); V-2 fell back to scrypt | P3 |
| G-8 | `sharp` on Windows | **Closed in P12:** sharp 0.35 prebuilt binaries install and run here (libvips, mozjpeg, libheif without HEVC) | P12 |
| G-9 | Live adapters cannot be exercised without credentials | `Live*` implementations written against the documented request/response shapes and run in the contract suite against recorded fixtures; Judge Mode reports mock vs live | P4 |
| G-10 | Onion is the demo crop and the least forecastable | Feature it: the guardrail is expected to refuse more often on onion. Not tuned away (§5.7, §16.1) | P6, P21 |

## 6 · V-2 as a reference (decided 2026-09-19)

`../MVP V-2` implemented an earlier prompt. A V-2 module may be ported only after a
line-by-line audit against v3 and only with its tests passing under v3 requirement IDs; every
gate is proven again here. What V-2 is most useful for: its `CUTS.md` findings (seven defects
only a real browser revealed; the in-memory PGlite seed trap; `navigator.onLine`; Devanagari
line-height and conjunct rendering; a zero-skill layer pointing downward). What must **not**
carry over: its C-12 design deviation (10–20px radii, radial glows, four shadow tokens) —
precisely what v3 PART IX forbids.

## 7 · Phase plan and gates

| Phase | Build | Gate / proof |
|---|---|---|
| P1 | Monorepo, strict TS, CI, compose, migrations, PART 0 artefacts, Phase-1 study | `pnpm build` clean; artefacts exist; 71 seeded rows |
| P2 | `@fasal/shared` domain engine | ≥ 97 tests; P1-02…P1-06 green |
| P3 | Schema, RLS, auth | SEC-01…14 fail to bypass — **Gate B** |
| P4 | Nine adapters, one contract suite each | mock and live shapes pass the same suite |
| P5 | Synthetic generator, ingest, cleaner | INGEST REPORT + resolved column mapping printed |
| P6 | RAKSHA layers, forward chaining, conformal, skill | validation table; `insufficient` withheld |
| P7 | Bundles + serving | size per district; ETag + integrity verified |
| P8 | Offline PWA: SW, Dexie, outbox, session | **Gate A** |
| P9 | Design system port (both themes), fonts, glyphs, spine | contrast table, Lighthouse, snapshots |
| P10 | Home briefing, benchmark strip, RAKSHA, evidence panel | benchmark dominates; nine live layers |
| P11 | Parser UI, voice, price-unit question, parse-confirm | **Gates H, I** |
| P12 | Camera pipeline | **Gate C** — CAM-01…14 walked |
| P13 | Matching + shortlist + honest emptiness | **Gate F** |
| P14 | FPO pools | **a real MOQ cleared from real listings** — 28 qtl + 5 qtl ≥ 30 qtl, in the browser |
| P15 | Offers, deals, sauda slip | **Gate G** |
| P16 | Delivery, payment, reputation | reputation moves only on completed deals |
| P17 | Disputes, grievance routing | open dispute suppresses clean reputation |
| P18 | Transport, storage, e-NWR, weather urgency | **Gates D, E** |
| P19 | WhatsApp · SMS · IVR | identical benchmark on all four channels |
| P20 | Full suite, Judge Mode, seeds | **Gate J**; all ten gates green |
| P21 | 23-step rehearsal, both themes | §16 unbroken twice |
