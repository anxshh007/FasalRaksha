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

## 4 · Environment (measured 2026-09-19)

Windows 11 · Node 24.19 · pnpm 10.34.5 · Python 3.12.6 (`.venv`, pinned `ml/requirements.txt`) ·
PostgreSQL 18.4 (embedded) · git 2.55. **Not available:** Docker, `psql`, admin rights, PyTorch,
TensorFlow, Playwright browsers (not yet attempted).

## 5 · Gaps and risks, named now

| # | Gap / risk | Plan | Phase |
|---|---|---|---|
| G-1 | No real market dataset | §4.4 synthetic structural process with every §4.2 defect injected; header-tolerant ingest so a real file drops in; labelled synthetic everywhere | P5 |
| G-2 | Policy constants (MSP 2025-26, storage tariffs, e-NWR pledge rate, freight tariffs, spoilage curves) have no machine-readable source here | One `constants` module in `@fasal/shared`, each value with its named source and a `verified` flag; **I will ask you to confirm the values** (§0.4) | P2, P18 |
| G-3 | No PyTorch/TensorFlow; no field-labelled grading images | Decide at P12 between a CPU PyTorch MobileNetV3-Small trained on a clearly-labelled proxy set, and a smaller trained model on image descriptors — either exported to ONNX and **actually run by ONNX Runtime Web** (V-2 left the runtime unwired; v3 requires it). `fieldValidated: false` in every case | P12 |
| G-4 | Playwright browsers not installed | Attempt `playwright install chromium` at P8; if the download is unavailable, log a cut and prove Gate A with a process-kill harness plus the in-app browser | P8, P20 |
| G-5 | Marathi copy must be culturally natural, not machine-translated | I will write it deliberately and flag it for a native-speaker review by the team before the demo | P11 |
| G-6 | HEIC decode on the client needs a WASM decoder (~1 MB) | Either lazy-load it only on a HEIC file, or reject clearly (both allowed by CAM-07); decide by size | P12 |
| G-7 | Argon2id needs a native module | Try `@node-rs/argon2` (prebuilt, no compiler); V-2 fell back to scrypt | P3 |
| G-8 | `sharp` on Windows | Prebuilt binaries expected; verify at P12 | P12 |
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
| P14 | FPO pools | a real MOQ cleared from real listings |
| P15 | Offers, deals, sauda slip | **Gate G** |
| P16 | Delivery, payment, reputation | reputation moves only on completed deals |
| P17 | Disputes, grievance routing | open dispute suppresses clean reputation |
| P18 | Transport, storage, e-NWR, weather urgency | **Gates D, E** |
| P19 | WhatsApp · SMS · IVR | identical benchmark on all four channels |
| P20 | Full suite, Judge Mode, seeds | **Gate J**; all ten gates green |
| P21 | 23-step rehearsal, both themes | §16 unbroken twice |
