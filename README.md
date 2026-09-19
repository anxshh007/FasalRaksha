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

Built phase by phase, stopping at every gate (PROMPT PART XV). **Current: P1 — foundation.**
The repository is scaffolded and its foundations are tested. **There is no product surface yet:** no screens, no prices, no recommendations.
`REQUIREMENTS.csv` is the source of truth for what is real. Run `pnpm requirements` to see it.

## Quick start

Requires Node ≥ 20.11, pnpm 10 and Python 3.11+.

```bash
pnpm install
pnpm db:start          # real PostgreSQL 18 (no Docker needed); writes .env; Ctrl+C stops it
pnpm dev:api           # in a second terminal — http://127.0.0.1:8787/api/health
pnpm dev:web           # http://localhost:5173
```

With Docker instead: `docker compose -f infra/docker-compose.yml --env-file .env up -d`, then
`pnpm db:bootstrap` (see `.env.example`).

Python pipeline environment:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r ml/requirements.txt    # Windows
.venv/bin/python -m pip install -r ml/requirements.txt        # Linux / macOS
```

## Prove it

```bash
pnpm verify            # strict typecheck · build · unit · real-PostgreSQL · ml · traceability
pnpm verify --deps     # … plus the dependency audit (fails at high)
```

Individually: `pnpm typecheck` · `pnpm build` · `pnpm test` · `pnpm test:db` · `pnpm ml:test` ·
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
- **Volatile crops will look worse, on purpose.** Onion, tomato and chilli are regime-switching,
  and policy shocks such as export bans or stock limits cannot be forecast. Expect lower skill,
  wider bands and more refusals on exactly these crops. That is the honest result and will not
  be tuned away.
