# फसल रक्षा · Fasal Raksha — Phase 2 prototype (v3)

**Offline-first price intelligence and a verified-buyer marketplace for the field gate.**
Smart India Hackathon 2026 · PS 26132 — *Strengthening market linkages and price discovery for
farmers* · Government of Maharashtra, Maharashtra State Innovation Society · Team Fasal Rakshak.

> Fasal Raksha does not merely find a buyer. It protects the farmer's decision before the buyer
> names the price.

| Read first | What it is |
|---|---|
| [`PROMPT.md`](PROMPT.md) | The master build prompt (v3) — the contract |
| [`CONSTITUTION.md`](CONSTITUTION.md) | The eighteen rules that cannot be broken |
| [`SPEC.md`](SPEC.md) | The condensed specification |
| [`REQUIREMENTS.csv`](REQUIREMENTS.csv) | Traceability: every requirement, where it lives, which test proves it |
| [`CUTS.md`](CUTS.md) | Every scope decision and substitution, with its reason |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The architecture map, decisions, gaps and phase plan |
| [`docs/PHASE1-STUDY.md`](docs/PHASE1-STUDY.md) | What carries forward from the Phase-1 build, and what changes |

## Status

Built phase by phase, each gate proven and committed (PROMPT PART XV). **Current: P9 — the
design system.** Done so far:
- the foundation, and the shared domain engine;
- the schema with row-level security, and authentication;
- the nine adapters;
- the synthetic dataset with its cleaner;
- the forecast pipeline with its validation table;
- sealed, versioned bundles served with ETags;
- the offline core: service worker, device store, verified district-first sync, session persistence
  across connectivity loss, and the outbox (Gate A, automated);
- the Phase-1 identity on a real design system: NIGHT and FIELD themes, self-hosted Manrope, DM
  Sans, DM Mono and Noto Sans Devanagari, a drawn glyph set, the record spine and the field-mode
  strip. Every colour pair passes AA in both themes, and the performance budget is measured on
  every run.

A farmer can choose a language, sign in, verify a PM-KISAN record and see their district's prices
and a sell/wait decision computed on the phone. That keeps working with the API killed or the
network gone. The morning briefing, evidence panel and buyer shortlist come next (P10–P13). The
shortlist half of Gate A is proven when the shortlist exists (P13).

`REQUIREMENTS.csv` is the source of truth for what is real. Run `pnpm requirements` to see it.

## Quick start

Requires Node ≥ 20.11, pnpm 10 and Python 3.11+.

```bash
pnpm install
pnpm db:start          # real PostgreSQL 18 (no Docker needed); writes .env; Ctrl+C stops it
pnpm dev:api           # in a second terminal — http://127.0.0.1:8787/api/health
                       # bundles: /api/bundles/manifest · /api/bundles/onion/nashik
pnpm dev:web           # http://localhost:5173
pnpm e2e               # Gate A in Microsoft Edge: kills the API mid-session and checks home still computes
```

With Docker instead: `docker compose -f infra/docker-compose.yml --env-file .env up -d`, then
`pnpm db:bootstrap` (see `.env.example`).

`pnpm db:start` loads the newest committed bundle release, so prices are served without Python.
To regenerate from scratch: `pnpm ml:pipeline --as-of 2026-09-18` (synthetic data → cleaned →
RAKSHA → sealed bundle cores, about three minutes), then `pnpm bundles:publish`.

Python pipeline environment:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r ml/requirements.txt    # Windows
.venv/bin/python -m pip install -r ml/requirements.txt        # Linux / macOS
```

## Prove it

```bash
pnpm verify            # strict typecheck · build · unit · real-PostgreSQL · ml · Gate A end-to-end · traceability
pnpm verify --deps     # … plus the dependency audit (fails at high)
```

Individually: `pnpm typecheck` · `pnpm build` · `pnpm test` · `pnpm test:db` · `pnpm e2e` · `pnpm ml:test` ·
`pnpm requirements`.

## Honesty notes (stated before anyone asks)

- **RAKSHA-QAD does not claim gradient boosting as an invention.** The contribution is the
  decision architecture around a standard quantile estimator:
  - skill-weighted fusion of nine signals, with measured weights;
  - a cost-sensitive asymmetric decision rule on conformalised quantiles;
  - a seven-condition guardrail that decides when the system refuses to advise.
- **The market data is synthetic.** No real Agmarknet/MSAMB extract was supplied, so the pipeline
  generates a structural price process and deliberately injects every defect class the cleaner
  must repair (PROMPT §4.4). Its metrics prove the pipeline is sound. They prove nothing about
  real Nashik onion prices.
- **Volatile crops look worse, and the table shows by how much.** Onion, tomato and chilli are
  regime-switching, and policy shocks such as export bans or stock limits cannot be forecast.
  On the synthetic run:
  - onion and tomato bands are roughly three to four times wider than the grains' (log width
    0.32–0.46 against 0.09–0.14), and that width is what drives refusals;
  - their skill against naive is lower (+0.05 to +0.26, grains +0.13 to +0.36);
  - pomegranate at 14 days does not beat naive at all, so that horizon is withheld;
  - banana at 14 days reaches only 0.44 held-out wait precision on 16 cases. That is printed as
    it is, not smoothed over.

  None of this has been tuned away, and none of it predicts what real onion data will show. The
  generator's day-to-day noise is an order-of-magnitude assumption (grains about 1.5 % a day,
  onion and tomato 6–7 %), not a measurement.
- **Where the skill comes from.** The shipped layer weights are measured out of fold:
  - arrival pressure (RK-3) and persistence (RK-1) carry most of it;
  - the seasonal layer (RK-2) contributes mainly at 14 days for the grains;
  - the weather layer (RK-4) earns roughly zero weight, because the generator couples rain to price
    only weakly. RK-8 therefore gives it no vote.

  For the perishables, a skill of +0.2 against "no change" is mostly the model seeing through
  day-to-day noise. For grains at 14 days it is mostly the harvest calendar. In neither case is it
  the model foreseeing events.
- **Every validation number is held out.** Folds are forward-chaining and purged. Seasonal
  profiles, arrival norms and weather climatology use earlier years only, and tests fail if
  truncating the future moves any past feature. The band widening, layer weights and wait
  threshold are learned only from earlier folds when scoring a later one. The first run, before
  these fixes, looked better. It was leaking.
