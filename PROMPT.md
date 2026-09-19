# FASAL RAKSHA — MASTER BUILD PROMPT (v3)

**Smart India Hackathon 2026 · Problem Statement 26132 — Strengthening market linkages and price discovery for farmers · Government of Maharashtra, Maharashtra State Innovation Society · Team Fasal Rakshak**

> **How to start:** save this file at the repo root as `PROMPT.md`, put the Phase-1 file at `reference/phase1/FasalRakshak_1.html`, then open the agent session with:
> *"Read PROMPT.md in full. Open reference/phase1/FasalRakshak_1.html and study it — it is the visual source of truth. Execute PART 0 before writing any application code. Then build phase by phase, stopping at every gate."*

**v3 changes:** PART IX (the interface) is now derived from the team's own Phase-1 build rather than invented. PART IX-B is a migration audit naming exactly what carries forward, what is promoted, and four correctness bugs already present in Phase 1 that the specification forbids.

---

# PART 0 — AGENT OPERATING INSTRUCTIONS

## 0.1 Who you are

You are the **principal architect, product engineer, ML engineer, security engineer, UX director and demo engineer** for this build. Act as a senior engineering team, not as a transcription service for this document. Do not follow this prompt mechanically: understand the domain requirement, identify the correctness boundary, put the logic in the right layer, test the boundary, connect the UI to that logic, make the UI communicate the result honestly, ensure it works offline, ensure it is secure, ensure the demo path runs.

You are **not** building a mockup. You are building a working, demonstrable, production-structured prototype whose frontend, backend, ML pipeline, offline architecture, security model, transaction state machine, image pipeline, multilingual behaviour and data flow **actually function**.

The result must feel like a **purpose-built agricultural decision instrument** — not a SaaS dashboard, and absolutely not a generic AI application.

## 0.2 First action — before any application code

This build is too large to hold in one context window. Your first job is to create the artefacts that let you re-anchor yourself at every phase.

1. **Study `reference/phase1/FasalRakshak_1.html`.** It is Phase 1 of this project, built by this team. It is the **visual source of truth** for the product's identity and the **behavioural source of truth** for flows it already implements. PART IX and IX-B tell you exactly what to carry forward and what to change. Do not discard it and start fresh; do not copy it uncritically either.
2. Inspect the repository. Create an architecture map.
3. Create **`CONSTITUTION.md`** — copy PART I of this document into it verbatim. **Re-read it at the start of every phase.** It is the contract.
4. Create **`SPEC.md`** — the condensed specification: the six leaks, the fifteen deliverables with their IDs, the RAKSHA-QAD formulae, the seven guardrail conditions, the design tokens from PART IX.
5. Create **`REQUIREMENTS.csv`** — the traceability matrix. One row per requirement, columns:
   `id, requirement, frontend_path, backend_path, shared_path, ml_path, db_table, test_id, status`
   Seed it with the fifteen PS deliverables (`FR-01 … FR-15`), the nine RAKSHA layers (`RK-1 … RK-9`), the seven guardrail conditions (`GR-1 … GR-7`), the fourteen camera failure paths (`CAM-01 … CAM-14`), the fourteen adversarial security tests (`SEC-01 … SEC-14`) and the Phase-1 migration items (`P1-01 … P1-12`, PART IX-B).
   **Every test you write names the requirement ID it covers.** A requirement with no test row is not implemented.
6. Create **`CUTS.md`** — empty. Every time you decide not to build something, or reduce its scope, write one line here saying what and why. **A silent cut is a defect; a logged cut is a design decision.**
7. Identify implementation gaps, propose the repository structure, then begin.

**Do not ask me to describe the requirements again. This document, the technical report and the Phase-1 build are the specification. Build from them.**

## 0.3 Anti-drift rule

The moment you are about to write a mock return value, a `TODO`, a hardcoded display number, or a component that renders a value it did not compute — **stop**. You have exactly two legal options:

- implement it properly, or
- delete the feature, write one line in `CUTS.md`, and tell me.

There is no third option. There is no "placeholder for now".

## 0.4 Working rhythm

- Announce each phase, what you will build, which files you will touch, and which gate you are building toward.
- Build. Run the tests. **Print the actual output.** Then stop and wait for my confirmation.
- Commit at every gate. Message names the phase and the gate result.
- Keep `REQUIREMENTS.csv` current as you go — it is how we both know what is real.
- **Never fabricate a metric.** If you have not measured it, do not print it. Any target figures in this document are targets to *regenerate*, not numbers to reproduce. A different honest number beats a matching invented one.
- Ask me when a **policy constant** (MSP values, storage tariffs, freight tariffs, spoilage curves) or a genuine product decision is ambiguous. Placeholder constants live in one `constants/` module, each with a comment naming the real source it must come from.

---

# PART I — THE CONSTITUTION

**Copy this into `CONSTITUTION.md`. Re-read before every phase. Violating any line is a build failure, not a style disagreement.**

1. **Nothing is for show.** Every button does what it says. Every number is computed by real code from real inputs. I will change an input and watch the output move.
2. **No hardcoded results.** No fixture array pretending to be computation. No `if (demo) return 1950`.
3. **One implementation of every domain rule**, in `@fasal/shared`. Parser, units, benchmark, decision, matching, aggregation, deal state, dispute, vision post-processing, staleness. Imported by frontend, backend, WhatsApp, SMS, IVR; mirrored by the Python pipeline under parity tests. **A WhatsApp reply and an offline home screen must produce the identical number.**
4. **The model never receives farmer-identifying input.** It predicts `crop × district × horizon`, never `farmer × crop × district`. Anything needing lot size, storage access or cash position runs **on the device**. This boundary is what makes the output space enumerable and the whole offline architecture possible.
5. **The refusal path is the product, not an error state.** "Evidence is not strong enough to suggest waiting." "Not enough current data to advise you." "Waiting may not be practical for this lot." A system that always has an answer is lying some of the time.
6. **No fake precision.** No `71.234%`. No point price without a band. No "AI Vision Score 83%". **No buyer match percentage.** Categories and bands only.
7. **Security is deep in the backend and invisible in the farmer UI.** No badges, no shields, no "encrypted", no "RLS enabled", no "zero trust", no padlock chips. The farmer experiences a verified buyer, a private contact, a trustworthy record. That is all.
8. **No model terminology on a farmer screen.** Never: model, algorithm, AI, ML, inference, prediction, confidence interval, quantile, score. Judge Mode (§14.4) is the only exception.
9. **Offline is enforced by the type system.** Deal-state transitions are **absent from the outbox union type**, so constructing an offline offer-acceptance is a **compile error**, not a runtime guard a missed conditional could reintroduce.
10. **Staleness governs advice, not just display.** Every price and forecast carries `asOf`. Bands widen with age. Recommendations are **suppressed entirely** past 7 days (perishables) / 14 days (grains). No code path lets a stale forecast reach a farmer wearing a recommendation.
11. **Explain first, rank second.** Never a bare score. Every ranked buyer carries a sentence a farmer can act on without trusting an algorithm they cannot inspect.
12. **Benchmark before price.** Every screen where a number is named or accepted shows today's district rate, the MSP floor and the 7-day trend. No exceptions.
13. **Marathi leads, and language is chosen before login.** It drives interface strings, number and currency formatting, speech-recognition locale, speech-synthesis voice **and the parser**. A selector that changes only the speech locale is a claim the product does not honour.
14. **Deterministic first, model second, never the reverse.** The crop parser is a rule cascade. A server-side model exists only as a fallback for what the cascade cannot resolve.
15. **Never fake a live integration.** Never display "Connected to Agmarknet" unless it is. Every external dependency sits behind an adapter with `mock` and `live` implementations of the identical interface; switching is **environment configuration, not code change**.
16. **Every error is a domain explanation.** Never "Something went wrong." Always what happened, in the farmer's terms, and what they can do.
17. **AI appears only where it creates real value**: quantile price forecasting, agricultural signal fusion, camera-assisted grading, language fallback. Never to make the product *appear* intelligent.
18. **Do not hide unfinished functionality behind impressive UI.** Do not substitute animation for function, mock buttons for real flows, or "AI-looking" graphics for actual algorithms.

**Do not build, under any circumstances:** chatbot-first interface · AI farming assistant · AI-generated agronomic advice · blockchain · cryptocurrency · tokens · social feed · follower system · gamification · points · fake AI confidence scores · fake point price predictions · fake security badges · a weather *prediction* model · public farmer phone numbers · government API credentials in the browser · offline deal finalisation · fake field-validated vision claims · moisture detection from RGB imagery · **generic buyer "match percentage"** · generic dashboard design.

**If a proposed feature does not answer a real failure mode, remove it and log it in `CUTS.md`.**

---

# PART II — THE PRODUCT

## 2.1 The thesis

> **Fasal Raksha is not another marketplace. It is the information-and-trust layer around the agricultural transaction.**

Discovery — connecting a farmer to a buyer — is the *least* broken part of this market. A farmer in Nashik can find a buyer by lunchtime. What is broken is that the farmer meets that buyer **uninformed**, unable to verify them, holding a lot too small to interest anyone who pays properly, with no way to prove quality remotely, no record if payment never arrives, and no practical ability to wait.

> **Note on Phase 1:** the Phase-1 title reads *"AI-powered farmer & buyer marketplace"*. Both halves of that phrase are now wrong. It is not a marketplace, and "AI-powered" is precisely the framing the specification rejects. The product name and description change to: **Fasal Raksha — offline-first price intelligence and a verified-buyer marketplace for the field gate.**

The single sentence a judge must understand within thirty seconds:

> **Fasal Raksha does not merely find a buyer. It protects the farmer's decision before the buyer names the price.**

## 2.2 The fourteen questions the farmer must be able to answer

What their crop is worth today · how that compares with the district market · how it compares with MSP · what the recent trend looks like · whether the evidence supports selling or waiting · **when the system should refuse to recommend waiting** · which verified buyer gives the best risk-adjusted net realisation · whether a small lot can be aggregated · **whether a photograph is usable before attempting grading** · what happens after an offer · at delivery · at payment · when something goes wrong · **and how the entire journey behaves when connectivity disappears.**

All of it without the farmer needing to understand machine learning.

## 2.3 The six leaks and their answers

| # | Leak | Evidence | Answer in the product |
|---|---|---|---|
| **L-1** | Price information asymmetry | Only **40.7%** of paddy households know MSP exists (37.1% wheat) | Benchmark + MSP floor + 7-day trend on every pricing screen |
| **L-2** | Payment default and delay | No contract, no recourse, no counterparty history | Ranking by **risk-adjusted net realisation**; payment timeliness is the headline buyer score |
| **L-3** | Lot size below buyer minimums | **86%** of holdings small or marginal | Opt-in aggregation pools until an institutional MOQ clears; FPOs as first-class accounts |
| **L-4** | Quality assessment at a distance | No credible remote quality signal → every match collapses into physical inspection | Camera grading with confidence **bands**, farmer-confirmed, provenance recorded |
| **L-5** | Perishability | **31.8 Mt** lost post-harvest 2020–22 | Weather-driven urgency; "wait" refused when no storage is within reach |
| **L-6** | Channel exclusion | **548M of 958M** Indian users are rural, intermittent | Offline PWA on ~2 KB/district/day + WhatsApp + SMS + IVR |

## 2.4 The fifteen deliverables — `FR-01 … FR-15`

Seed `REQUIREMENTS.csv` with these. PS 26132's Expected Solution clause is a **specification, not a theme**. All fifteen are implemented. None are faked.

| ID | Asked for | Implemented as | Phase-1 status |
|---|---|---|---|
| FR-01 | Aggregate mandi prices | Nightly Agmarknet-shaped ingestion, cleaning, district benchmark | absent |
| FR-02 | Buyer demand | Buyer requirements — crop, grade floor, quantity, price, district, radius; several concurrent | **partial — buyer profile exists** |
| FR-03 | Quality requirements | Variety, FAQ grade, moisture where relevant; grade minimums on requirements | absent |
| FR-04 | Arrival volumes | Ingested, cleaned, used as RAKSHA signal layer 3 | absent |
| FR-05 | Transport options | District transporter directory; attached at acceptance | absent |
| FR-06 | Storage options | Accredited warehouse lookup; e-NWR pledge-finance route at the decision | absent |
| FR-07 | Localised price trends | District modal, MSP floor, 7-day trend, week-of-year seasonal position | absent |
| FR-08 | Sale-window recommendations | RAKSHA 7- and 14-day direction with band, behind the seven-condition guardrail | absent |
| FR-09 | Match farmers and FPOs with verified buyers | Explained, ranked shortlist; FPO a distinct account type | **partial — scored, must become explained** |
| FR-10 | Lot creation | Offline-capable listing with photographs, sync-state display, outbox | **partial — listing form exists** |
| FR-11 | Quality grading | On-device vision pipeline with gates, OOD rejection, bands, farmer confirmation | absent |
| FR-12 | Digital offers | Offer → counter → accept, server-authoritative | absent |
| FR-13 | Logistics coordination | Suggested pickup recorded on the sauda slip; pickup risk checked against weather | absent |
| FR-14 | Payment tracking | Independent delivery confirmation, farmer payment confirmation feeding reputation | absent |
| FR-15 | Dispute / grievance | Reason-coded dispute from delivery onward, with evidence, routed to district officer | absent |

## 2.5 The narrative spine

Every screen should sit somewhere on this chain, and the finished prototype should make it visually obvious:

```
INFORMATION ASYMMETRY → benchmark before price → SELL / WAIT decision →
quality proof → trusted buyer → risk-adjusted realisation → aggregation →
transport / storage → sauda slip → delivery → payment → reputation →
dispute + recourse
```

…and underneath the entire journey: **FIELD MODE.**

---

# PART III — ARCHITECTURE

## 3.1 The governing rule

> **Precompute on the server, ship the output, compute every user-specific value on the device.**

This is sound only because of Constitution §4: model outputs are user-independent. The output space is therefore small and enumerable, so it ships as **2–10 KB of versioned static JSON** instead of being queried.

**There is no live inference service.** A farmer on 2G cannot wait for a model round-trip, and a per-query inference cost does not survive contact with a rural user base. The nightly pipeline is the only thing that ever runs a model; the device downloads its output once and never calls it again. The price is staleness, and we handle that explicitly (Constitution §10) rather than hiding it.

## 3.2 Stack — locked, do not substitute

- **Frontend:** React 18 + Vite + TypeScript (strict), installable PWA. Service Worker, Dexie/IndexedDB, offline outbox, ONNX Runtime Web. No Next.js, no SSR — this must install and run from cache.
- **Backend:** Fastify + TypeScript, PostgreSQL with Row-Level Security, `zod` at every boundary, `pino` with PII redaction.
- **Shared:** `@fasal/shared` — TypeScript, zero runtime dependencies, pure functions only.
- **ML:** Python 3.11+, pandas, numpy, scikit-learn, LightGBM (quantile objective), onnx / tf2onnx. Nightly job. No service.
- **Channels:** WhatsApp bot, SMS responder, IVR menu — all importing `@fasal/shared`.
- **Tooling:** pnpm workspaces, Node 20+, Vitest, Playwright, docker-compose for Postgres.

> **Migration note.** Phase 1 is a single-file vanilla-JS app with `localStorage` as its database. It is a *prototype of the interface*, not of the architecture. Port the **design, copy, flows and component grammar**; replace the **data layer** entirely (localStorage → Dexie/IndexedDB on the client, PostgreSQL on the server) and the **rendering approach** (string-concatenated `innerHTML` → React components). See PART IX-B.

## 3.3 Repository

```
fasal-raksha/
├── CONSTITUTION.md  SPEC.md  REQUIREMENTS.csv  CUTS.md  README.md
├── reference/phase1/FasalRakshak_1.html     ← the visual source of truth
├── packages/shared/          @fasal/shared
│    ├── units/ parser/ benchmark/ decision/ matching/
│    ├── aggregation/ dealstate/ vision/ staleness/ bundle/
├── apps/
│   ├── web/
│   │    ├── design/          tokens.css, type.css, glyphs/ (hand-drawn SVG)
│   │    └── …
│   ├── api/                  Fastify — domain modules, not giant controllers
│   └── channels/             whatsapp/ sms/ ivr/
├── ml/
│   ├── ingest/ clean/ validate/ climatology/ features/
│   ├── raksha/ vision/ evaluate/ export/
├── data/
│   ├── raw/                  the user-supplied dataset lands here
│   ├── golden/               golden vectors for TS↔Python parity
│   └── bundles/              generated: versioned, ETag'd JSON
└── infra/                    docker-compose, migrations, seed, e2e
```

**API domain modules** (not controllers): `auth · farmers · buyers · fpos · market · forecast · raksha · matching · aggregation · vision · listings · offers · deals · logistics · storage · payments · reputation · disputes · grievances · registry · messaging · bundles · audit`.

## 3.4 Adapters — every external dependency

`MarketDataAdapter · WeatherAdapter · FarmerRegistryAdapter · BuyerRegistryAdapter · MessagingAdapter · SpeechAdapter · ModelFallbackAdapter · StorageRegistryAdapter · TransportTariffAdapter`

Each has `Mock*` and `Live*` implementations satisfying **one interface test suite run against both**. Mocks are **not stubs returning empty data** — they behave like plausible instances of the real service, so the product can be demonstrated and load-tested honestly.

```
MarketDataAdapter
 ├── MockMarketDataAdapter
 └── AgmarknetMarketDataAdapter
```

Switching to live changes `.env`, never application code.

> Phase 1 already gets this right in spirit: `GOV_FARMER_REGISTRY` carries a long comment explaining that in production the lookup **must** move server-side and the browser must never hold a government API key. **Keep that instinct and formalise it as `FarmerRegistryAdapter`.**

---

# PART IV — THE DATA CONTRACT (make it work on MY dataset)

The dataset I supply lands in `data/raw/`. It is Agmarknet/MSAMB-shaped and it is **dirty**. Be tolerant on input, strict on output.

## 4.1 Column resolution — never hardcode headers

Resolve incoming headers against a synonym table, then **print the resolved mapping for my confirmation**:

```
canonical     ← accepted synonyms
date          ← Price Date, Arrival_Date, Reported Date
state         ← State, state_name
district      ← District, District Name, dist
market        ← Market, Market Name, APMC, mandi
commodity     ← Commodity, Crop, commodity_name
variety       ← Variety, variety_name
grade         ← Grade, FAQ grade
min_price     ← Min Price, Min_x0020_Price, minimum_price
max_price     ← Max Price, maximum_price
modal_price   ← Modal Price, Modal_x0020_Price, modal_price_rs_quintal
arrivals      ← Arrivals, Arrival Qty, arrival_tonnes
unit          ← Unit, price_unit
```

If a required column cannot be resolved: **stop and ask me.** Do not guess. Do not synthesise.

## 4.2 The cleaner must actually detect and repair — with counters

1. **Unit inconsistency** — rows quoted per kilogram while labelled per quintal. Detect by robust deviation from the crop × district rolling median (|log ratio| ≈ log 100 ± tolerance). **Repair and count.** This is the highest-value defect: it produces confident wrong answers rather than errors.
2. **Duplicate sessions** — same market × commodity × date reported twice. Collapse by volume-weighted median. **Count.**
3. **Missing trading days** — never forward-fill silently. Mark `imputed: true`, cap consecutive imputation, exclude imputed days from validation targets.
4. **Zero-arrival days** — distinguish "market closed" from "genuinely zero arrivals". Not the same signal for L3.
5. **Inconsistent commodity naming across markets** — canonicalise through the crop dictionary with an **auditable** synonym table. Never a silent fuzzy merge.
6. **Impossible rows** — min > max, modal outside [min, max], non-positive prices, future dates → quarantine to `data/raw/_rejected.csv` with a reason column.
7. **Outliers** — Hampel filter on log price. Flag, do not delete; excluded from training targets, retained in the record.

The report is a first-class artefact, printed at the P5 gate and surfaced in Judge Mode:

```
INGEST REPORT — <dataset>
raw rows                      ......
resolved columns              ../..
unit errors repaired          ......
duplicate sessions collapsed  ......
impossible rows rejected      ......
imputed trading days          ......
crop × district series        ......  (min / median / max length)
```

## 4.3 Thin series

`MIN_SERIES = 400 observations`, `MIN_SEASONS = 2`. Below either → `insufficient`, forecast **withheld from the bundle**. The app must render correctly and honestly for a crop with no forecast. That path is **tested**, not incidental.

## 4.4 If I supply no dataset

Only then generate one — and generate a structural **price process** (prices responding to arrival pressure, a seasonal harvest calendar, rainfall anomaly, autocorrelated noise, occasional shocks), then **deliberately inject** every defect class in §4.2 so the cleaner has real work to do. Never hand-craft plausible-looking numbers into the UI.

## 4.5 Weather and climatology

Weather is **consumed, never predicted**. `WeatherAdapter` mock generates a plausible district forecast series; live reads a public forecast API. Climatology (district × week-of-year rainfall/humidity norms) is computed from the historical record and shipped in the bundle.

---

# PART V — RAKSHA-QAD, THE ALGORITHM

**RAKSHA** — Risk-Aware Agricultural Signal and Knowledge-Horizon Aggregator.
**RAKSHA-QAD** — *Risk-Aware Quantile Signal Fusion + Asymmetric Decision Guardrail*: the name for the system-level algorithm.

## 5.1 Honesty about novelty — state this in the README and in code comments

**Do not claim gradient boosting is an original invention.** It is not, and a judge will catch it. The contribution is the **decision architecture around** an existing quantile estimator:

1. **Skill-weighted fusion** of nine independently computed agricultural signals, where each layer's weight is its own *measured* out-of-fold skill, not a hand-set constant.
2. A **cost-sensitive asymmetric decision rule** operating on conformalised quantiles against this farmer's real storage, spoilage and financing economics.
3. A **seven-condition guardrail** that governs what the system refuses to say.

```
raw agricultural observations
  ↓ data quality / cleaning
  ↓ nine agricultural signal layers
  ↓ quantile distribution
  ↓ skill-weighted signal agreement
  ↓ uncertainty widening (staleness + conformal)
  ↓ farmer-specific downside calculation      ← device
  ↓ storage / spoilage / financing economics  ← device
  ↓ seven-gate permission system              ← device
  ↓ SELL / WAIT / REFUSE
```

## 5.2 The nine layers

| ID | Layer | Computes | Method | Runs |
|---|---|---|---|---|
| RK-1 | Market persistence | Today against lagged prices | Lags {1,2,3,7,14,28}, EWMA spans {3,7,14}, momentum | Server |
| RK-2 | Seasonal position | Where this week sits historically | Empirical week-of-year median + IQR band per crop × district, **leave-current-year-out** | Server |
| RK-3 | Arrival pressure | Arrivals vs seasonal norm | `log(arrivals / WOY_median_arrivals)`, winsorised | Server |
| RK-4 | Weather pressure | Rain/humidity anomaly × crop sensitivity | Anomaly vs district climatology × per-crop sensitivity coefficient | Server |
| RK-5 | Market shock | Abnormal movement | Robust z of log returns, rolling median/MAD, 60-day window | Server |
| RK-6 | Quantile forecast | 7- and 14-day direction + magnitude band | **GBT under pinball loss, τ ∈ {0.1, 0.5, 0.9}** | Server |
| RK-7 | Risk asymmetry | The farmer's own downside | Cost-sensitive rule on the lower quantile vs storage, spoilage, financing | **Device** |
| RK-8 | Evidence agreement | Whether the signals concur | **Skill-weighted vote across three buckets** | Server |
| RK-9 | Decision guardrail | Whether "wait" is permissible at all | **Seven-condition conjunction** | **Device** |

RK-7 and RK-9 are on-device **by necessity**, not convenience: they are the only layers taking farmer-specific input, and that input must never reach the model.

## 5.3 RK-6 — the estimator

- LightGBM `objective='quantile'`, `alpha=τ`. One model per **crop × horizon × τ**. District as a categorical feature with a shared per-crop model when series are thin; per crop × district when they are long. **Justify the split you choose in a comment with the series-length evidence.**
- Target: `log(P_{t+h} / P_t)` — model the log return, not the level. Invert to a price band at read time.
- Features (**all must be available at prediction time**): RK-1 lags/EWMAs, RK-2 seasonal position, **RK-3 arrival pressure lagged by one day**, RK-4 weather anomaly, RK-5 shock z, day-of-week, week-of-year (sin/cos), days-since-last-trade, imputation flag.
  > **The leakage trap:** same-day arrival volume is *not* available at prediction time. Write a test that fails if any feature reads a same-day arrival. This is the single most likely silent error in the pipeline.
- **Conformalised bands.** Raw quantile regression is miscalibrated on short series. After training, run split-conformal calibration on the final forward-chaining fold: compute conformity scores on held-out residuals and **widen** (never narrow) the τ=0.1/0.9 band until empirical coverage ≥ nominal. Report achieved coverage. **This is what makes the band honest enough for RK-7 to reason against.**
- **Staleness widening.** Ship `bandKappa` per crop; the device applies `band_multiplier(age) = 1 + κ · age_days`. Bands visibly widen as data ages.

## 5.4 RK-8 — skill-weighted evidence agreement

An earlier design summed **signed** votes, so five signals unanimously reading "flat" summed to zero and the system reported "unclear" — discarding the single most useful thing you can tell a farmer deciding whether to wait: that nothing strong is expected to happen. **Do not use a signed sum.**

```
for each layer i ∈ {RK-1 … RK-6}:
    bucket_i ∈ {UP, FLAT, DOWN}        by that layer's own calibrated threshold
    w_i      = max(0, skill_i)          that layer's standalone out-of-fold skill
                                        score vs the naive baseline — MEASURED,
                                        never hand-tuned

score(b)  = Σ_{i : bucket_i = b} w_i          for b ∈ {UP, FLAT, DOWN}
direction = argmax_b score(b)
agreement = score(direction) / Σ_b score(b)   ∈ [1/3, 1]
```

**Unanimous calm is reported as confident calm**, not as absence of evidence. Recompute `w_i` every pipeline run and ship the weights in the bundle so an evaluator can inspect them.

## 5.5 RK-7 — the cost-sensitive decision rule (device)

A wrong "wait" costs principal, storage and spoilage. A wrong "sell" costs only foregone upside. The errors are **not symmetric**, so this is not a classifier threshold.

```
p0            = today's district modal price (₹/qtl, from bundle)
q10,q50,q90   = conformalised predicted price quantiles at horizon h

carry(h)      = storage_rate_per_qtl_month · (h/30)
              + spoilage_fraction(crop, h) · p0
              + finance_rate_annual · p0 · (h/365)

G  (expected gain)   = q50 − p0 − carry(h)
D  (downside)        = q10 − p0 − carry(h)
V  (lot value)       = p0 · quantity_qtl
L  (tolerable loss)  = τ_loss · V          τ_loss default 0.02, farmer-adjustable

WAIT permissible  ⟺  G > 0
                 AND  D · quantity_qtl > −L
                 AND  RK-9 passes
```

`storage_rate`, `spoilage_fraction` and `finance_rate` come from the storage lookup for **this** farmer's reachable warehouse and the e-NWR pledge rate — **never from a constant**. Storage cost and expected spoilage are netted out of any projected gain **before that gain is shown**, so the comparison the farmer sees is the real one.

## 5.6 RK-9 — the seven-gate guardrail · `GR-1 … GR-7`

Before "wait" is ever suggested, **all seven** must hold. Each is a separately named predicate with its own test and its own farmer-facing refusal sentence.

| ID | Condition | Refusal when it fails |
|---|---|---|
| GR-1 | Price data is fresh within this crop's staleness limit | *"Not enough current data to advise you."* |
| GR-2 | The model has beaten its naive baseline for this crop | *"The forecast does not beat the normal seasonal baseline."* |
| GR-3 | Forecast confidence clears the higher of the two thresholds | *"The evidence is not strong enough to suggest waiting."* |
| GR-4 | Evidence agreement across layers is sufficient | *"The signals do not agree strongly enough."* |
| GR-5 | Seasonal position does not strongly contradict the signal | *"The season points the other way."* |
| GR-6 | Expected gain, net of storage, spoilage and financing, clears its cost | *"Expected upside does not cover storage and spoilage costs."* |
| GR-7 | A real, named storage mechanism is within reach of this farmer | *"Waiting may not be practical for this lot."* |

Show *which* condition failed, in farmer language, on demand. **Test all seven independently as seven distinct refusals.**

## 5.7 Validation — and what we refuse to claim

- **Forward-chaining only.** Expanding window: train through *t*, test *t+1 … t+k*, roll forward. A random split on a time series is catastrophic leakage — **assert against it in a test.**
- **Every forecast reported against a naive baseline.** For daily price series "tomorrow equals today" is a very strong predictor; a model can post an impressive error metric having learned nothing but persistence. Report **skill score** — improvement over naive *and* over seasonal-naive. **A crop whose model does not beat naive is marked `insufficient` and withheld from the bundle rather than shipped anyway.**
- Regenerate this table every run, per crop:

| Metric | Reported as |
|---|---|
| Error vs naive baseline | Skill score, 7-day and 14-day |
| Error vs seasonal climatology | Skill score, 7-day and 14-day |
| Directional accuracy | 7-day and 14-day |
| **Precision on the "wait" recommendation** | The expensive error, isolated |
| Conformal band coverage | Achieved vs nominal |
| Bundle status | `published`, or `insufficient` and withheld |

- **State the weaknesses before anyone asks.** Onion, tomato and chilli are volatile and regime-switching; policy interventions (export bans, stock limits, procurement drives) are exogenous and unforecastable. Expect **visibly lower skill and wider bands** on exactly these crops, and a guardrail correspondingly more likely to refuse. **That is the honest result, not a defect. Do not tune it away.** Put it in the README.

## 5.8 The bundle

```jsonc
{
  "schemaVersion": 3,
  "version": "2026-09-04.1",
  "generatedAt": "2026-09-04T02:14:00Z",
  "asOf": "2026-09-04",
  "district": "nashik", "crop": "onion",
  "benchmark": { "modal": 1840, "min": 1500, "max": 2100, "unit": "quintal" },
  "msp": null,
  "trend": [ /* 7 daily modals */ ],
  "seasonal": { "woyMedian": 1755, "woyIQR": [1600,1980], "position": "below" },
  "arrivalsRatio": 0.82,
  "forecast": {
    "h7":  { "q10":1790, "q50":1905, "q90":2060, "direction":"up",
             "agreement":0.71, "skill":0.14, "coverage":0.91, "bandKappa":0.06 },
    "h14": { /* … */ }
  },
  "raksha": { "layerWeights": { "RK-1":0.9, "RK-2":0.4, "…":0 } },
  "buyers": [], "storage": [], "transport": [],
  "stalenessLimitDays": 7,
  "status": "published",
  "integrity": "sha256-…"
}
```

Plus shared bundles: `msp.json`, `climatology/<district>.json`, `crops.json` (dictionary, synonyms, sensitivity coefficients, staleness limits).

Bundles are **versioned, cacheable, ETag-aware, integrity-checked and stale-aware**. A farmer's own district is **~2 KB**. Sync is progressive and district-first.

---

# PART VI — `@fasal/shared`

Pure TypeScript. No I/O, no framework imports, fully deterministic, exhaustively tested. **Exactly one implementation of each rule in the entire codebase.**

```ts
// ─── units ────────────────────────────────────────────────────────────
type Unit = 'kg' | 'quintal' | 'tonne' | 'lot';
type Money = { amount: number; unit: Unit };         // NEVER a bare number
parseQuantity(text: string, locale: Locale): { value: number; unit: Unit } | Ambiguous
normalisePrice(m: Money, to: Unit): Money

// ─── parser ───────────────────────────────────────────────────────────
parseListingIntent(text: string, locale: Locale, farmerDistrict: District): {
  crop?: CropId; quantity?: Quantity; price?: Money | AmbiguousPrice;
  intent: 'sell' | 'enquire';
  district: District;                                 // NEVER a constant fallback
  unresolved: Field[];
}

// ─── benchmark ────────────────────────────────────────────────────────
computeBenchmark(bundle: Bundle, farmerAsk?: Money): {
  modal: Money; mspFloor: Money | null; delta: Money; trend7: number[];
  seasonalPosition: 'above'|'within'|'below'; asOf: ISODate; ageDays: number;
}

// ─── decision — RK-7 + RK-9 ───────────────────────────────────────────
evaluateWait(input: {
  bundle: Bundle; horizon: 7|14; quantityQtl: number;
  storage: StorageOption | null; financeRate: number; tolerableLossFraction: number;
}): { verdict: 'sell'|'wait'|'refuse';
      failedConditions: GuardrailId[];                // GR-1 … GR-7
      expectedGain: Money; downside: Money; carry: Money;
      explanation: Explanation; asOf: ISODate }

// ─── matching ─────────────────────────────────────────────────────────
rankBuyers(lot: Lot, requirements: BuyerRequirement[], ctx: MatchContext): RankedMatch[]
netRealisation(offer: Offer, lot: Lot, freight: Money, history: BuyerHistory): Money

// ─── aggregation ──────────────────────────────────────────────────────
formPools(listings: Listing[], requirement: BuyerRequirement): Pool[]

// ─── dealstate ────────────────────────────────────────────────────────
type DealState = 'LISTED'|'OFFERED'|'COUNTERED'|'ACCEPTED'|'SAUDA_SLIP'
               | 'DELIVERY_CONFIRMED'|'PAYMENT_CONFIRMED'|'MUTUALLY_RATED';
type DisputeState = 'DISPUTE_OPEN'|'UNDER_REVIEW'|'RESOLVED';
type OutboxEntry = ListingCreate | ListingUpdate | ListingRenewal
                 | PriceAlert | PhotoUpload;          // ← no deal transitions. ever.
transition(deal: Deal, event: DealEvent, actor: Actor): Deal | TransitionError

// ─── vision ───────────────────────────────────────────────────────────
evaluateGates(stats: FrameStats): GateResult          // ordered, with hysteresis
aggregateFrames(preds: FramePrediction[]): GradeProposal | OODReject

// ─── staleness ────────────────────────────────────────────────────────
isAdviceSuppressed(asOf: ISODate, now: ISODate, crop: CropId): boolean
bandMultiplier(ageDays: number, kappa: number): number
```

## 6.1 The parser

Rule-based cascade over a crop dictionary carrying synonyms in **Latin transliteration and native script — Devanagari first**, since it carries both Marathi and Hindi. Bengali and Gurmukhi resource files retained in the build.

> **Phase 1 already has the skeleton of this** — `CROPS[]` with a `syn[]` array per crop and `findCropInText()`. **Keep the structure. Extend it:** add native-script synonyms (`कांदा`, `कांदे`, `गहू`, `सोयाबीन`), move the dictionary out of the app bundle and into `crops.json` shipped with the data bundle, and replace the flat `CITIES[]` array with a district registry keyed to the farmer's verified district.

Runs **entirely on-device, deterministically**. Not a compromise: it is what makes the feature work offline, instantly, identically every time. It matters acutely for voice, because Marathi and Hindi speech recognition returns Devanagari — a Latin-only dictionary would fail precisely when voice input is most needed.

Must extract: **crop · quantity · unit · price · location · intent**, with synonyms, transliteration and **Devanagari numerals (१२३)**.

Required passing inputs:
`"मला ५ क्विंटल कांदा विकायचा आहे"` · `"Mere paas 400 kilo soyabean hai, Latur"` · `"kanda 20 quintal 1840"` · `"२० क्विंटल कांदा"` · `"tamatar 3 crate"`

Display parsed output for confirmation before creating the listing:
```
crop: onion · quantity: 5 · unit: quintal · intent: sell · location: Nashik
```

## 6.2 The price-unit boundary — a correctness requirement

*"Mala 2500 rupaye pahijet"* may mean **₹2,500 per quintal, per kilogram, or for the whole lot.** These differ by two orders of magnitude, and a silent misreading corrupts the benchmark comparison, the match ranking and the deal value while producing **confident wrong answers rather than errors**.

**An unmarked number is never silently assigned a unit.** Stop and ask, with a single tap:

```
₹2,500 किसके लिए?
  ○ प्रति क्विंटल      ○ प्रति किलो      ○ पूरी खेप
```

Equivalent Marathi / Hindi / English variants must all work. Store the unit **explicitly at the input boundary**. Normalise **once, centrally**. Never duplicate unit-conversion logic across the frontend.

> **This is bug `P1-03`.** Phase 1's `parseCropMessage()` assigns `price = Math.round(parseFloat(...))` — a bare number with no unit — and then displays it as `inr(r.price) + "/qtl"`, asserting a unit it never established. Fix at the source, not at the display.

## 6.3 Quantity normalisation

> **This is bug `P1-02`.** Phase 1 does `if (unit.indexOf("quintal") !== -1) n = n * 100` — silently converting everything to kilograms at parse time, discarding the unit the farmer actually used. The farmer said "5 quintal"; the system stores 500 and later shows "500 kg". **Never discard the stated unit.** Carry `{ value, unit }` through the entire system as a `Quantity`, convert only at the point of comparison, and echo the farmer's own unit back to them.

## 6.4 Location safety

Where the message contains no location, use the farmer's **verified district from their registry record**. **Never a hardcoded default district.** A Latur farmer silently placed in Nashik receives matching that is not merely wrong but *plausibly* wrong.

> **This is bug `P1-04`.** Phase 1's `parseCropMessage(text, fallbackLocation)` falls back to an arbitrary passed-in location, and `CITIES[]` is a flat list of Indian cities unconnected to the farmer's verified identity. Replace with the verified district from the registry record.

## 6.5 Matching — explained, not scored

The buyer card must **never** show a match percentage.

> **This is bug `P1-01`, and it is the most important visual change in the whole migration.** Phase 1 renders `<div class="match-score"><strong>94</strong><span>MATCH</span></div>`. To its credit, Phase 1 already *computes* that number rather than hardcoding 94/89/84 as the original build did — the `About this build` modal says so proudly. **That was the right fix for the wrong problem.** A computed match percentage is still a number a farmer cannot interrogate, cannot act on, and cannot verify. Replace it with the one number that *is* actionable — **net realisation** — plus the reasons.

**Delete the `.match-score` component. Replace it with:**

```
GODAVARI AGRO TRADERS · Lasalgaon                        [verified]

₹1,950 / qtl
₹110 above today's Nashik rate
12 km away
Wants your full 5 qtl

₹9,750 gross
₹9,400 estimated after freight        ← this is the headline figure

23 completed deals · pays in ~4 days
```

Every clause is a matching dimension the farmer can act on without trusting an algorithm they cannot inspect.

**This is deliberately not machine learning.** With no historical transaction corpus a learned ranker has nothing to learn from and cannot explain itself. Use **constrained multi-criteria ranking against an explicit objective — expected net realisation** — explainable by construction:

- **Crop is a hard filter**, not a weight, with **one auditable substitution table**; substitutions are always labelled as such in the explanation.
  > Phase 1's `matchScore()` gives `+25` for a *substring* crop match (`sc.indexOf(bc) !== -1`) and `+5` for no match at all — so a wheat lot can rank against a cotton buyer. **A crop mismatch is a filter failure, not a score deduction.**
- **Quantity is overlap, not ratio.** `500 kg matched · 4,500 kg remaining` — never "100%" or "10%". Partial fulfilment is ordinary in this trade.
- **Price is scored against the market benchmark, never the farmer's own ask.**
  > Phase 1 does `ratio = buy.price / sell.price` — scoring the buyer against the farmer's ask. **This rewards a buyer for exploiting a farmer who guessed low**, which is the exact failure the product exists to prevent. Score against the district modal.
- **Distance is scored as cost**, via `TransportTariffAdapter` using a real hired-vehicle tariff — not `distance × arbitrary ₹/km`, and not Phase 1's binary `same city +20 / else +8`.
- **Final ranking = gross offer − estimated freight − expected payment-delay cost − default risk cost**, the last two derived from that buyer's **own completed-deal history**. **A buyer offering ₹50/qtl more who pays in 90 days must rank below one who pays in four. Assert this in a test.**
- **There is no score floor.**
  > Phase 1 does `Math.max(55, Math.min(98, ...))` — a floor of 55 means **every buyer always looks like at least a 55% match**, including a cotton buyer for a wheat lot. Remove it entirely. When nothing clears a workable threshold, do **not** manufacture a shortlist. Show: nearest mandi, current district rate, watchlist, aggregation opportunity, price revision. **Honest emptiness beats fake recommendations.**

## 6.6 Aggregation and FPOs

A **constrained clustering problem**, not a prediction problem. Cluster open listings on **crop, grade band, availability window, geodesic radius**; pool greedily until the buyer's MOQ clears. **Opt-in.** The buyer sees one consignment:

```
ONE CONSIGNMENT
Total volume  18.5 qtl
Grade range   B–A
Coordinating  XYZ FPO
Contributors  12 farmers
```

Proceeds split **proportionally by contributed volume, recorded in the sauda slip**.

**FPO is a first-class account type** — member farmers, pooled listings, aggregation, proportional settlement, its own transaction history — transacting as the counterparty of record. Not a coordinator field on a listing.

---

# PART VII — THE IMAGE PATH · `CAM-01 … CAM-14`

**This is the most fragile surface in the product and the one most likely to break live on stage. Over-engineer it.** Phase 1 has no camera at all, so this is built from zero — treat it as the highest-risk phase.

Treat the camera as **a complete product inside the product**, not an upload field with a badge on it. Build order matters more than model choice: **ship photo capture with framing guidance first**, because a well-lit, well-framed photograph of the actual lot lets a buyer make a conditional offer with no model behind it at all — which is most of the available value.

```
OPEN CAMERA → FRAME GUIDANCE → QUALITY GATE → OOD REJECTION →
STABLE CAPTURE → MULTI-FRAME AGGREGATION → MODEL PROPOSAL →
CONFIDENCE BAND → FARMER CONFIRMATION → PROVENANCE RECORD
```

## 7.1 The quality gate — runs before anything is scored

When the farmer opens the camera, **do not immediately run classification.** Run lightweight quality checks first. A frame failing any gate is **never scored**.

- **Blur** — Laplacian variance below threshold
- **Brightness** — mean luminance outside acceptable range
- **Subject coverage** — subject-area fraction against border/background colour
- **Stability** — inter-frame motion above threshold

The viewfinder reports **why**, in farmer language, one message at a time in priority order, at **~11 fps**:

```
TOO DARK · MOVE CLOSER · HOLD STEADY · SHOW MORE OF THE CROP · NO CROP DETECTED
```

Apply **400 ms hysteresis** so the message does not flicker. **Never display a constantly changing percentage** (`Image Quality 82% → 84% → 76%`) — that is meaningless to a farmer and asserts precision that does not exist. The shutter enables only when all gates are green for a continuous **500 ms**.

> **Implementation, non-negotiable:** downscale each frame to 256 px on an `OffscreenCanvas` **inside a Web Worker**; throttle to ~11 fps with `requestAnimationFrame` plus a time gate. **The main thread must never block.** A blocked main thread is the single most common reason a camera UI "feels broken".

## 7.2 Out-of-distribution rejection

An **explicit rejection stage** with a hard confidence floor, built on **crop-family colour-signature priors**. It must reject: ceiling · shoe · wall · face · unrelated object · unusable background — **before grading**.

```
This photo doesn't show enough of the crop.
Try again with the produce filling more of the frame.
```

**Never produce a grade from an obviously invalid image.** OOD rejection is a *distinct code path* from low confidence, with distinct copy and no band shown.

## 7.3 The classifier

Small **per-crop-family** model, **INT8, 224×224, under 5 MB**, running **entirely on-device** — ONNX Runtime Web in the PWA, TFLite-compatible architecture for Android. A drop-in for **MobileNetV3-Small or EfficientNet-Lite0**; swapping trained weights replaces exactly one function. Load lazily (only when the camera opens), cache in IndexedDB, verify integrity, and **degrade to photo-only capture if the model fails to load**.

**Assesses:** ripeness stage on tomato / chilli / mango / banana; sprouting, greening, rot, surface damage on potato / onion; foreign matter, chaff, visible mould, pest damage in grain lots.

**Refuses to claim: moisture content** — the commercially decisive attribute for grain — because moisture is invisible to an RGB sensor and requires a meter, oven-drying or NIR spectroscopy. The UI says so exactly where a farmer would otherwise assume otherwise:

> **Moisture requires a meter or laboratory measurement.**

## 7.4 Multi-frame capture

**Never trust a single frame.** Capture **5 stable frames over ~1.2 s** from one deliberate press, classify each, aggregate to a **category plus a confidence band**:

```
PROPOSED GRADE
Grade B
Confidence  Moderate
Based on 4 stable views
```

A figure that drifts from 71% to 84% as the wrist turns asserts a precision that does not exist.

## 7.5 Farmer confirmation and provenance

```
Does this look right?
[ CONFIRM ]   [ CHANGE ]   [ SKIP GRADING ]
```

**The model proposes. The farmer confirms. The confirmation writes the listing.** The model never writes to a listing directly. Record provenance as `farmer-declared` or `farmer-declared · AI-assisted`.

> Phase 1's **"AI Understanding" card** is already this pattern in embryo: parse → show back → farmer acts. Keep the interaction; rename it (Constitution §8) and extend it from text parsing to grade proposal. See §9.8.

## 7.6 Field-validation honesty and the learning loop

Public leaf-disease corpora are captured in laboratory conditions on uniform backgrounds; models trained on them report near-perfect accuracy and degrade badly on real field photographs. The model artefact carries **`fieldValidated: false`**, reported internally, **never as a marketing claim**. Architecture must support replacing weights once real field-labelled data exists.

Demonstrate the loop — this is a genuine innovation story:

```
photo → AI proposal → farmer declaration → buyer confirmation at pickup
      → labelled field example → future training dataset
```

## 7.7 The fourteen failure paths — every one handled, all demonstrated at the P11 gate

| ID | Path | Required behaviour |
|---|---|---|
| CAM-01 | No camera hardware | File-input fallback, identical downstream pipeline |
| CAM-02 | Permission **denied** | Explain why it was needed, offer file fallback, never re-prompt in a loop |
| CAM-03 | Permission **dismissed** (≠ denied) | Distinct copy, single retry affordance |
| CAM-04 | Camera busy / in use by another app | Named error, retry |
| CAM-05 | `getUserMedia` constraint failure | Fallback ladder: `{facingMode:'environment',width:1920}` → `{facingMode:'environment'}` → `{video:true}` → file |
| CAM-06 | iOS Safari | `playsinline` + `muted` + `autoplay`, HTTPS, user-gesture triggered; re-acquire stream on `visibilitychange` (black-video-on-backgrounding) |
| CAM-07 | HEIC/HEIF via file fallback | Detect by magic bytes, convert client-side or reject clearly. Never silently upload an unrenderable file |
| CAM-08 | Low memory / canvas allocation failure | Drop to 1 frame, then to photo-only |
| CAM-09 | Model load failure (network, corrupt cache, no WASM SIMD) | Photo capture fully works; grading simply absent, one honest line |
| CAM-10 | All frames fail the gates | No grade; keep the best frame; say what was wrong |
| CAM-11 | OOD reject | Distinct path from low confidence; different copy; no band |
| CAM-12 | Offline at capture | Photo queued in the IndexedDB outbox as a Blob; **listing creation never blocks on upload** |
| CAM-13 | Upload failure / slow network | Resumable, exponential backoff, per-item state visible, idempotency key prevents duplicates |
| CAM-14 | Orientation and EXIF | Apply orientation, then **strip all EXIF including GPS** by redrawing to canvas before upload |

Also mandatory: revoke every `ObjectURL`; call `track.stop()` on **every** unmount path — route change, back button, tab close; cap concurrent canvases; never leave the torch on.

## 7.8 Upload discipline

Downscale to **1280 px long edge**, JPEG **q 0.82**, target 200–400 KB. Strip EXIF. Client-side content hash as the idempotency key. Queue as a Blob in IndexedDB. Drain with exponential backoff. Server-side hardening is §8.6.

---

# PART VIII — BACKEND, DATABASE AND SECURITY

**All of this is deep in the backend and invisible in the farmer UI.** No badges, no shields, no "encrypted", no "RLS enabled", no "JWT secured", no "AES-256", no "zero trust", no security dashboard. The farmer simply experiences a **verified buyer, a private contact and a trustworthy record.**

> **Phase-1 note:** the `🔒 Runs locally` and `🛡️` chips and the `🔒 Demo build` disclaimer are trust-theatre by the specification's standard and must be removed (`P1-07`). **But the underlying instinct is correct** — Phase 1's honest comment block explaining that registry lookups must move server-side is exactly the right engineering posture. Keep the posture; drop the chips.

## 8.1 Ownership lives in the database, not the application

Every request: **authenticate user → begin transaction → `SET LOCAL app.current_user_id` → `SET LOCAL app.current_role` → query → let RLS enforce ownership.** The application connects as a role with **`NOBYPASSRLS`**, never a superuser, never the table owner.

The test of correctness: **a malicious client that skips the API entirely and calls the database with a forged farmer id still cannot** read another farmer's contacts, modify another buyer's requirement, or approve its own offer.

**The highest-value schema decision: contact tables are separate from public profiles.** A phone number or a registry id is **never in the same row** as a name a buyer can browse.

> **This is `P1-08`.** Phase 1 stores `contact` and `phone` directly on the buyer and listing objects, and `openContactModal()` renders them to anyone who clicks. Split the tables and gate the disclosure (§8.4).

## 8.2 Database tables — minimum set, normalised, with FKs and RLS policies

```
users · farmer_profiles · farmer_verifications · farmer_contacts
buyer_profiles · buyer_verifications · fpos · fpo_members
market_prices · market_arrivals · weather_observations · weather_forecasts
crop_profiles · forecast_bundles · raksha_signals
storage_facilities · transporters
buyer_requirements · listings · listing_photos
offers · counters · deals · sauda_slips · deliveries · payments · ratings
disputes · grievance_evidence
aggregation_pools · aggregation_members
contact_grants · audit_log
```

**Never put public and private identity data in the same table.**

## 8.3 Verification points at the risky side

- Farmers verify via **PM-KISAN / AgriStack farmer identifier**; buyers via **GSTIN or Udyam**. All lookups **server-side** — a browser never holds a government API credential.
- **Unverified buyers may browse listings and see prices. They may not make offers or receive farmer contact details.**
- Farmers are not forced through equivalent verification friction merely to participate. **Trust is deliberately pointed at the financially risky side.**
- The verified name becomes the farmer's **immutable identity**; every listing is bound to the account by foreign key. Verification that does not propagate to the point of use is decorative.

> **`P1-09` — this is the largest behavioural inversion in the migration.** Phase 1 gates the **farmer** (`renderAuth()` requires a PM-KISAN ID before the farmer dashboard opens) and leaves the **buyer** entirely ungated — anyone can post a buying profile with no verification at all. The specification requires the opposite. **Keep the whole verification UI — it is well built** (the tabs, the `verify-note`, the simulated round-trip, the `verified-card`, the "Not you? Re-check ID" affordance) — and **re-point it at the buyer**, adding GSTIN/Udyam. Farmers keep a lighter PM-KISAN/AgriStack check that establishes identity and district, not a barrier to entry.

## 8.4 Contact privacy

```
Buyer makes offer → Farmer acknowledges → Masked communication channel opens
```

Contact details are **never rendered openly**. Every grant writes an **audit row**: accessor, target, timestamp, reason/context. **Per-buyer daily rate limits** apply. A marketplace holding government-verified farmer identities alongside open phone numbers is a contact-harvesting resource for exactly the intermediaries the product exists to bypass.

> **Keep Phase 1's contact modal as the UI pattern** — it is already the right shape (a deliberate reveal behind an action, not a field on a card). Move the gate from "clicked a button" to "made an offer the farmer acknowledged", and replace the raw values with a masked channel.

## 8.5 Standard hardening

`zod` at every boundary — HTTP, outbox drain, webhook, bundle load; parse, never cast · parameterised queries only · Argon2id for secrets at rest · short-lived access tokens, rotating refresh tokens with reuse detection, session revocation · per-IP / per-account / per-endpoint rate limits, stricter on verification, contact-grant, offer and OTP · strict CORS allowlist · security headers · real CSP with no `unsafe-inline` · HSTS · `frame-ancestors 'none'` · CSRF on cookie-auth routes · **idempotency keys on every mutating endpoint** (listing sync, photo upload, non-authoritative writes, message delivery — a 2G retry must never create a duplicate transaction) · **PII redaction in logs**, with a test that greps the log stream for a seeded phone number and fails if it appears · append-only **audit log** for verification, contact grants, deal transitions, dispute actions, admin reads · signed, versioned, integrity-checked bundles · dependency audit failing CI at `high` · **no secrets committed**, `.env.example` only.

> **`P1-10`.** Phase 1's advanced panel accepts a **Groq API key typed into a browser input and stored in `localStorage`**. That key would be readable by any script on the page and would travel with the device. Remove it entirely. The model fallback is `ModelFallbackAdapter`, server-side, with the key in server environment configuration. Log the removal in `CUTS.md`.

> **Keep `escJsAttr()`'s discipline.** Phase 1 carries a long, correct comment about JS-escaping *before* HTML-escaping when interpolating into an `onclick` attribute. React removes this class of bug by construction, but the care behind it is exactly right — carry that care into how you handle any `dangerouslySetInnerHTML` (ideally: never use it).

**Internally log:** request IDs, sync events, bundle versions, decision inputs, decision outputs, security violations, contact grants, dispute events. **Never leak sensitive values into ordinary logs.**

## 8.6 Image upload hardening

**Magic-byte sniffing** — never trust `Content-Type` or extension · allowlist JPEG/PNG/WebP/HEIC · hard size cap (8 MB) enforced **while streaming, before buffering** · **decompression-bomb guard** — reject implausible dimensions or pixel counts before decode · **re-encode every image server-side with `sharp`** to canonical JPEG, which destroys any embedded payload · **strip all metadata including GPS a second time server-side** (client stripping is convenience, not trust) · store under a **server-generated UUID**; the user-supplied filename never touches disk, a URL, or an unescaped response · serve from object storage via **short-lived signed URLs** with `Content-Disposition: attachment` and `nosniff` · per-account upload rate limit and quota · virus-scan hook behind the adapter interface · **SVG never accepted.**

## 8.7 The fourteen adversarial tests · `SEC-01 … SEC-14`

A dedicated suite. **All fourteen must fail to bypass** for the gate to pass.

1. Cross-tenant read of another farmer's contact row
2. Cross-tenant write to another farmer's listing
3. Forged `farmer_id` at the DB layer, API bypassed
4. Forged `buyer_id` at the DB layer
5. Unverified buyer attempts an offer
6. Contact grant without farmer acknowledgement
7. Contact grant exceeding the per-buyer daily rate limit
8. Buyer approving its own offer
9. Offline-constructed deal transition submitted through the outbox
10. Rating a deal that never completed
11. Dispute raised before `DELIVERY_CONFIRMED`
12. Direct edit of a counterparty's reputation
13. IDOR on a photo's signed URL after expiry
14. Bundle tampering — modified bundle rejected by integrity check

## 8.8 API surface

```
POST /api/auth/otp/request        POST /api/auth/otp/verify     POST /api/auth/refresh
POST /api/verify/farmer           POST /api/verify/buyer        GET  /api/me

GET  /api/bundles/manifest        GET  /api/bundles/:crop/:district      (ETag, integrity)
GET  /api/market/benchmark        GET  /api/market/trend
GET  /api/raksha/:crop/:district

POST /api/listings                GET  /api/listings/:id        PATCH /api/listings/:id
POST /api/listings/:id/photos     GET  /api/listings/mine
POST /api/requirements            GET  /api/requirements        PATCH /api/requirements/:id
GET  /api/buyers/matches/:listingId          (server mirrors device math — must agree)

POST /api/offers                  POST /api/offers/:id/counter
POST /api/offers/:id/accept       POST /api/offers/:id/acknowledge
GET  /api/deals/:id               GET  /api/deals/:id/sauda-slip
POST /api/deals/:id/delivery      POST /api/deals/:id/payment   POST /api/deals/:id/rate
POST /api/deals/:id/dispute       POST /api/disputes/:id/resolve         (district officer)

GET  /api/pools                   POST /api/pools/:id/join      POST /api/pools/:id/leave
GET  /api/storage                 GET  /api/transport
POST /api/contact-grants                                        (masked; audited)

POST /api/channels/{whatsapp|sms|ivr}/webhook
GET  /api/_judge/*                                              (Judge Mode, §14.4)
```

**Server-side authorisation is always enforced.** Client checks are UX, never security.

## 8.9 The deal state machine

```
LISTED → OFFER → COUNTERED → ACCEPTED → SAUDA SLIP
      → DELIVERY CONFIRMED (both sides, independently)
      → PAYMENT CONFIRMED (farmer) → MUTUALLY RATED

from DELIVERY CONFIRMED onward, either party may raise:
      DISPUTE OPEN → UNDER REVIEW → RESOLVED
```

**Server-authoritative. Cannot be finalised offline.** Two parties accepting the same lot offline is a real conflict with real financial consequence. Offline, the interface shows **"Pending server confirmation"** — never "Deal completed".

**Reputation** attaches to **completed transactions only**. Buyers: payment timeliness, weighment fairness, pickup reliability. Farmers: quality as described, quantity as described, availability. **Always display rating alongside the count of completed deals**, so one rating cannot make a new profile look equivalent to a buyer with a hundred closed transactions. **Payment timeliness is the load-bearing signal.**

**Disputes** carry a **structured reason code** — quantity short · grade dispute · payment overdue · no-show · other structured reason — plus a note and an evidence photograph, routed to the **district agriculture officer**, so the institutional dashboard can report grievance patterns at district resolution rather than parsing free text. **An open dispute suppresses the counterparty's clean-reputation presentation.** That is what gives the mechanism teeth.

---

# PART IX — THE INTERFACE

**This part is derived from `reference/phase1/FasalRakshak_1.html`. Open it, run it, and study it before building. It is the product's visual identity and you are extending it, not replacing it.**

## 9.1 What Phase 1 got right — the identity to preserve

Phase 1 established a genuine visual identity that is **not** generic AI-product design, and it should survive into Phase 2:

- **A dark, agricultural, near-black-green ground** (`#07110c`) rather than the default white SaaS canvas.
- **A distinctive lime/pistachio accent** (`#b9e879`) that reads as crop and daylight, not as a framework default. This is the brand.
- **Role theming** — lime for the farmer side, sky blue (`#7ec4ff`) for the buyer side. A genuinely good idea: the two sides of the transaction are visually distinct and the farmer always knows whose surface they are on. **Keep this and extend it to FPO** (see §9.4).
- **Manrope for display, DM Sans for interface** — tight, confident display type with real character, at `-2px`/`-3px` tracking on large sizes.
- **A voice-first affordance already in the product** — the `.mic-button` with its `mic-pulse` listening animation, sitting inline with the field label rather than buried in a menu.
- **A parse-and-confirm pattern** — the "understanding card" showing crop / quantity / price / location back to the farmer in a 4-up grid before anything is committed.
- **A deliberate contact reveal** behind a modal, rather than phone numbers rendered on cards.
- **A verification flow with a simulated round-trip** and an honest disclaimer about what is demo data.
- **Toasts, empty states, disabled/loading button states, and a responsive collapse** already exist and are reasonable.

## 9.2 What must change — the generic-AI signifiers

These make an interface read as machine-generated and the specification forbids them. Remove all of them:

| Phase-1 element | Why it goes |
|---|---|
| `"✦ AI-POWERED AGRICULTURE"` eyebrow | Constitution §8, §17 |
| `"🤖 AI Understanding"` heading, `"Live AI"` badge | Constitution §8 |
| `.match-score` percentage (`94 MATCH`) | Constitution §6, §11 — see `P1-01` |
| Radial-gradient glows, `.glow` blur(70px) orb | Generic AI-product visual grammar |
| `backdrop-filter: blur(18px)` on the navbar; modal `blur(4px)` | Glassmorphism as primary language |
| `linear-gradient(145deg, …)` card fills | No gradient-filled surfaces |
| `box-shadow: 0 35px 90px rgba(0,0,0,0.45)` and friends | Soft-shadow depth stack |
| Emoji as iconography (🌾 👨‍🌾 🏪 🧅 📭 🎯 🛡️ 🔒 ✅ ⚠️) | Replace with drawn glyphs, §9.6 |
| `.floating-stat` cards hovering over the hero | Decoration that carries no data |
| `⭐ BEST MATCH` badge | Ranking is explained, not awarded |
| `🔒 Runs locally`, `🛡️`, `🔒 Demo build` chips | Constitution §7 — security is invisible |
| `border-radius: 22px` on cards | §9.5 — 4px maximum |
| Groq API key input in the browser | `P1-10` — security |

**Keep the warmth those emoji provided.** Removing them must not make the product cold — that is what the drawn glyph set and the hand-drawn sparklines are for.

## 9.3 The resolution — two themes, one identity

There is a real tension: Phase 1 is dark, and **dark interfaces are harder to read in direct sunlight**, which is where this product is used. Do not resolve this by abandoning the identity. Resolve it by shipping two themes, both first-class:

- **NIGHT** — Phase 1's palette, extended. The default theme, the brand surface, the marketing site, and what a judge sees on a projector in a dim hall.
- **FIELD** — a high-contrast ink-on-paper theme for outdoor use, structured like a printed mandi patti. Same components, same layout, same type scale; inverted ground and a warmer, more literal palette.

Theme selection sits beside language in the record spine. Default to NIGHT; offer FIELD prominently on first run; persist the choice. If the `AmbientLightSensor` API is available and reports high lux, **suggest** FIELD once — never switch without asking.

## 9.4 Design tokens

Define these once in `apps/web/design/tokens.css` as CSS custom properties. Nothing anywhere else hardcodes a colour.

### NIGHT (default — extends Phase 1)

```css
--ground:        #07110C;   /* page */
--ground-soft:   #0B1710;   /* alternating bands */
--surface:       #0E1B13;   /* cards, panels */
--surface-raised:#122018;   /* sheets, modals */
--rule:          #1C2B22;   /* hairlines — replaces rgba(255,255,255,.09) */
--rule-strong:   #2A3C31;   /* table borders, spine divider */

--text:          #F4F7F3;
--text-muted:    #91A097;   /* Phase 1 --muted, kept */
--text-faint:    #65736B;

--farmer:        #B9E879;   /* Phase 1 lime — brand + farmer side + affirmative */
--farmer-tint:   rgba(185,232,121,0.08);
--buyer:         #7EC4FF;   /* Phase 1 sky — buyer side + institutional data */
--buyer-tint:    rgba(126,196,255,0.08);
--fpo:           #D2C09E;   /* NEW — third account type, warm sand */
--fpo-tint:      rgba(210,192,158,0.08);

--caution:       #E8B44A;   /* staleness, weather urgency */
--caution-tint:  rgba(232,180,74,0.08);
--refuse:        #E8836B;   /* guardrail refusal, dispute, risk */
--refuse-tint:   rgba(232,131,107,0.09);
```

### FIELD (high-contrast, outdoor)

```css
--ground:        #F7F8F7;
--ground-soft:   #EDF2EE;
--surface:       #FFFFFF;
--surface-raised:#FFFFFF;
--rule:          #DCE0DD;
--rule-strong:   #A9BEB0;

--text:          #1A1E1C;
--text-muted:    #5C645E;
--text-faint:    #7C8981;

--farmer:        #1E5631;   --farmer-tint:  #E9F3EB;
--buyer:         #1F3864;   --buyer-tint:   #ECF0F8;
--fpo:           #8A5A00;   --fpo-tint:     #EEE7DB;
--caution:       #8A5A00;   --caution-tint: #FDF3E0;
--refuse:        #9C3A2A;   --refuse-tint:  #FBEEEB;
```

**Rules of use, both themes.** Tints are **washes behind information**, never large filled blocks. **One accent per screen, maximum** — determined by whose surface it is (farmer / buyer / FPO) plus at most one semantic (caution or refuse). The semantic mapping is fixed and never decorative. **Colour is never the only carrier of meaning** — pair with a label, a rule weight, or a glyph. No gradients anywhere. Verify **every** text/background pair programmatically in **both** themes and print the contrast table (§9.9).

## 9.5 Typography

Phase 1's pairing is good and stays. Two additions are mandatory, because neither Manrope nor DM Sans covers Devanagari, and because prices must not reflow.

```
Manrope 700/800            display — page titles, the price figure, section heads
DM Sans 400/500/600/700    interface, body, labels
DM Mono 400/500            NEW — all figures: prices, quantities, dates, IDs, sauda slip
Noto Sans Devanagari       NEW — all Marathi and Hindi text
```

- **DM Mono is the sibling of DM Sans** — it pairs exactly, and it gives true tabular figures. Apply `font-variant-numeric: tabular-nums lining-nums` wherever a number can change. **A price that reflows as it updates destroys the instrument feeling.**
- **Noto Sans Devanagari** is optically matched at the same optical size; set `lang="mr"` / `lang="hi"` on the elements and let the stack resolve. Test line-height separately — Devanagari needs more leading than Latin at the same size.
- Keep Phase 1's tight display tracking (`-2px` at 46px, `-3px` at 72px) for Latin. **Set tracking to `0` for Devanagari** — negative tracking breaks conjuncts.
- Scale (4px grid): **12 / 14 / 16 / 20 / 25 / 31 / 39 / 49**. Body 16px — Phase 1 runs 10–13px in many places, which is **too small for an outdoor product used by farmers of all ages**. Raise the floor: no interface text below 13px, no body text below 15px.
- Field labels: 12px, `letter-spacing: .08em`, uppercase, `--text-faint` — Phase 1's `.tagline` / `.step-number` treatment, kept.

## 9.6 Materials, structure and motion

- **Hairline rules at `--rule` do the work shadows did in Phase 1.** Exactly **one** shadow token survives — `0 1px 2px rgb(0 0 0 / .18), 0 8px 24px rgb(0 0 0 / .12)` — used only on genuinely floating surfaces (modals, bottom sheets, the capture overlay). Phase 1's `.panel`, `.listing-card`, `.farmer-visual-card` and `.floating-stat` all lose their shadows and gain a 1px rule.
- **Corner radius: 4px maximum** on containers, 2px on inputs, **0 on tables and rules**. Phase 1 runs 9–22px; bring it all down. The one exception: the `.mic-button` pill stays pill-shaped — it is a physical-button metaphor and it earns it.
- **No `backdrop-filter` anywhere.** The navbar becomes opaque `--ground` with a bottom hairline.
- **Asymmetric layout.** Introduce a persistent **record spine** (56–72px, full height, hairline divider) carrying: district · language · theme · sync state · as-of date. Content sits right of it in a deliberately non-50/50 grid (3:2 or 2:1). Phase 1's centred `.dashboard-intro` and symmetric `.form-row` give way to this.
- **Iconography: draw your own.** ~20 glyphs on a 20px grid, 1.25px stroke, square caps, no rounded terminals — quintal weight, mandi shed, sauda slip, warehouse, truck class, rain, MSP floor line, verified seal, dispute flag, microphone, camera. Inline SVG, `currentColor`, in `apps/web/design/glyphs/`. **No icon library, no emoji.**
- **Motion:** 120–180ms, `cubic-bezier(.2,0,0,1)`. Opacity and 2–4px translate **only**. Phase 1's `translateY(-2px)` hover lift is fine; its `box-shadow` bloom on hover is not. Numbers change with a 90ms crossfade, **never a count-up**. **Keep `mic-pulse`** — it communicates live recording state, which is real information. Full `prefers-reduced-motion` support.
- Density is a feature: this is a record, not a landing page.

## 9.7 The home screen is a morning field briefing, not a dashboard

Phase 1's farmer dashboard opens with a centred "Describe your crop" panel. **Invert this.** The farmer opening the app at 6am needs to know what their crop is worth *before* they are asked to type anything.

**Header / spine** — identity · district · language · theme · connectivity · last data update. Connectivity is **subtle and intentional**, in DM Mono:

```
FIELD MODE · LAST SYNC 04 SEP          ✔
NETWORK ERROR!!!   /   ERROR 503        ✘
```

The farmer must feel the product is **intentionally designed for poor connectivity**, not that something is broken.

**Hero — the farmer's crop is the most important object on the screen.**

```
ONION · NASHIK

TODAY'S MARKET
₹1,840 / qtl          ← Manrope, 39–49px, DM Mono for the figure, tabular

district modal · MSP floor · seven-day movement · as-of date
```

**The benchmark must visually dominate.** *Benchmark before price.* If the farmer enters a price anywhere in the app, the benchmark remains available.

**Navigation is minimal:** `HOME · SELL · BUYERS · MY DEALS`. Phase 1's `.nav-pill` row is the right component — reduce it to these four. Everything else is contextual.

## 9.8 RAKSHA as a decision instrument

A distinctive component. **Do not display the acronym expansion constantly.** The farmer sees:

```
SELL NOW        /        WAIT MAY BE POSSIBLE        /        NOT ENOUGH EVIDENCE TO WAIT
```

Never `AI confidence 83%`, `prediction score 91%`, `model says…`, `AI recommendation…`.

Instead: **"Market is leaning upward."** Then a quiet **"Why?"** affordance opening the evidence.

**Forecast UI — never a single predicted price as if it were fact. Always a band:**

```
7-DAY OUTLOOK

Likely direction     UP
Expected range       ₹1,780 — ₹1,960
Evidence strength    Moderate
As of                04 Sep 2026
```

Use a distribution/band visualisation, never a single line. **No fake decimal precision anywhere.**

## 9.9 The six signature elements

1. **The evidence panel ("Why this signal?")** — the intellectual centrepiece, and **the direct descendant of Phase 1's "understanding card"**. Keep that card's DNA: a bordered, tinted, deliberately-separate surface that shows the system's reasoning back to the farmer. Extend it from a 4-up grid to a stacked ledger of the nine layers: name, plain-language meaning, and a **hairline meter** (a 1px rule with a 3px tick, not a progress bar) showing measured contribution weight. As-of date at the foot. **Human meanings by default:**
   ```
   Market prices        ↑ supporting
   Arrivals             ↓ supporting
   Seasonal position    → neutral
   Weather              ↑ supporting
   Forecast             ↑ moderate
   Evidence agreement     Strong
   ```
   Then a **"Technical details"** disclosure for judges — Phase 1's `.advanced-toggle` is exactly the right component for this; repurpose it.

2. **The benchmark strip** — on *every* screen where a number is named. Modal in Manrope/DM Mono; MSP floor as a **drawn horizontal rule** beneath it; the 7-day trend as a hand-drawn 1px SVG sparkline (**no chart library**); the delta as `+₹110` in the semantic colour. Never a chart card.

3. **The parse-confirm card** — Phase 1's understanding card, renamed and corrected. Shows crop · quantity **in the farmer's own unit** · price **with its unit explicitly established** · district **from the verified record**. Any field the parser could not resolve renders as an inline question, not as "Not detected". The price-unit question (§6.2) lives here.

4. **The sauda slip** — an emotional and product anchor, digitally inspired by a traditional agricultural transaction record. DM Mono figures, a perforated edge drawn in CSS (`repeating-linear-gradient` + `mask`), hairline box. Carries: farmer · buyer · crop · quantity · **grade declaration and its provenance** · **benchmark at time of sale** · agreed price · estimated freight · payment terms · pickup arrangement · date/time · transaction ID · status · dispute pathway · and the proportional split table when it is a pool. **Printable and shareable at A5** via a dedicated `@media print` stylesheet that forces the FIELD theme.

5. **The refusal card** — `--caution-tint` ground, hairline left rule in `--caution`, the sentence in Manrope 20px, the failed condition named plainly beneath. It must look **considered**, never like an error. Phase 1's `.info-message` is the starting point; it must become more substantial than a one-line strip. **The refusal is the product.**

6. **The field-mode strip** — the offline state as an intentional, permanent part of the chrome rather than an alarm. Phase 1 has no offline state at all. This is the single most memorable moment of the demo; make it feel designed.

## 9.10 Responsive, accessible, fast

**Design mobile-first. Do not merely shrink a desktop layout.** Priority sizes: **360×800 · 390×844 · desktop 1440+ · tablet**. Phase 1's breakpoints (900 / 700 / 430) are sensible — keep them and add 360 as the design origin rather than the collapse target. Buttons large enough for outdoor use. **No dense data tables shown to farmers** (tables are for Judge Mode).

**Accessibility, hard requirements:** WCAG AA on all text in **both themes** — verify every pair programmatically and **print the contrast table**. *(Phase 1 fails this in several places: `--text-faint` variants at `#4e5953` and `#526059` on `#07110c` are well below AA, and 8–10px type is used throughout. Both must be fixed.)* · 44×44px minimum touch targets *(Phase 1's `.icon-btn` and `.advanced-toggle` are smaller)* · full keyboard operation · visible 2px focus rings · correct `lang` attributes switching with locale · works at 320px · **no layout shift** (reserve space for every async value).

**Performance budget (entry-level Android, 2G):** FCP from cache **< 1.5s** · JS **< 200 KB gzipped** excluding the ONNX runtime, which loads lazily **only when the camera opens** · **zero blocking network requests** to render home · 60fps scroll on a 2 GB device. **Self-host the fonts** — Phase 1's `@import` from Google Fonts inside a `<style>` block is render-blocking and fails offline, which is fatal for this product. Subset them: Latin + Devanagari + the numerals, `font-display: swap`, preloaded. **Lazy-load** advanced screens, Judge Mode, heavy visualisations.

## 9.11 Screens

Phase-1 screens carry forward and are marked `[P1]`; new screens are marked `[NEW]`.

`Language select (pre-login)` `[NEW]` · `Landing` `[P1]` · `Sign in / verify` `[P1, re-pointed]` · `Home — briefing` `[NEW]` · `Why this signal` `[P1 understanding card → evidence panel]` · `Sell — speak or type` `[P1]` · `Price-unit disambiguation` `[NEW]` · `Camera capture` `[NEW]` · `Grade confirmation` `[NEW]` · `Listing review` `[P1]` · `Buyer shortlist` `[P1, descored]` · `Buyer detail` `[P1]` · `Offer / counter` `[NEW]` · `Sauda slip` `[NEW]` · `Delivery & payment` `[NEW]` · `Rating` `[NEW]` · `Dispute` `[NEW]` · `Aggregation pool` `[NEW]` · `Storage & e-NWR` `[NEW]` · `Transport` `[NEW]` · `My listings & deals` `[P1]` · `Buyer dashboard` `[P1]` · `Settings` `[NEW]` · `Judge Mode` `[NEW]`.

---

# PART IX-B — PHASE-1 MIGRATION AUDIT · `P1-01 … P1-12`

Seed these into `REQUIREMENTS.csv`. Each is a concrete, verifiable change with a test.

| ID | Phase-1 behaviour | Required Phase-2 behaviour | Severity |
|---|---|---|---|
| **P1-01** | `.match-score` renders a computed percentage (`94 MATCH`), floored at 55 by `Math.max(55, …)` | Percentage deleted. Ranking by **risk-adjusted net realisation** with explained reasons. No score floor — an empty shortlist is a valid result | **Correctness + Constitution §6** |
| **P1-02** | `parseCropMessage` silently converts quintal→kg (`n = n * 100`), discarding the stated unit | Carry `{value, unit}` end to end. Echo the farmer's own unit back | **Correctness** |
| **P1-03** | Price parsed as a bare number, then displayed as `/qtl` — a unit that was never established | `Money = {amount, unit}`. Ambiguous price triggers the single-tap unit question (§6.2) | **Correctness — the two-orders-of-magnitude bug** |
| **P1-04** | `parseCropMessage(text, fallbackLocation)` falls back to an arbitrary location; `CITIES[]` is unconnected to identity | District comes from the farmer's **verified registry record**. Never a constant | **Correctness** |
| **P1-05** | `matchScore()` gives partial credit for crop mismatch (`+5`) and substring matches (`+25`) | Crop is a **hard filter** with one auditable substitution table | **Correctness** |
| **P1-06** | Price scored as `buy.price / sell.price` — against the farmer's own ask | Scored against the **district benchmark**. Never the ask | **Correctness — inverts the product's purpose** |
| **P1-07** | `🔒 Runs locally`, `🛡️`, `🔒 Demo build`, `✅ Verified` chips | All security signalling removed from the farmer UI | **Constitution §7** |
| **P1-08** | `contact` and `phone` stored on buyer/listing objects; modal reveals them to anyone who clicks | Separate contact tables; disclosure only after offer + farmer acknowledgement; audited; rate-limited | **Security §8.4** |
| **P1-09** | **Farmer** is gated by PM-KISAN verification; **buyer** is entirely ungated | **Invert.** Buyer gated by GSTIN/Udyam before offering or receiving contacts. Farmer verification establishes identity and district, not a barrier | **Security §8.3 — largest behavioural change** |
| **P1-10** | Groq API key typed into a browser input, stored in `localStorage` | Removed. Model fallback is server-side behind `ModelFallbackAdapter`, key in server env | **Security §8.5** |
| **P1-11** | `localStorage` as the database; `innerHTML` string concatenation as the renderer | Dexie/IndexedDB + outbox on the client; PostgreSQL + RLS on the server; React components | **Architecture** |
| **P1-12** | Google Fonts `@import` inside `<style>`; render-blocking and fails offline | Self-hosted, subset, preloaded, `font-display: swap` | **Performance — fatal offline** |

**Migration rule:** for each row, port the Phase-1 *component and copy* first, then fix the behaviour. Do not rewrite a screen from scratch when the fix is behavioural — the interface was the part Phase 1 got right.

---

# PART X — LANGUAGE AND MICROCOPY

## 10.1 Language is a product decision, not a translation table

Language selection happens **before login** and controls **UI strings · currency formatting · number formatting · parser language · speech-recognition locale · speech-synthesis voice**. A selector that changes only the speech locale is a claim the product does not honour.

> Phase 1 has a "Choose your language" select inside the farmer dashboard that does not change the interface. Move it **before login**, into the record spine, and make it control all six things above.

**Marathi is the strongest demo language.** Do not translate only labels. Translate **navigation, explanations, decisions, error messages, camera guidance, buyer descriptions, price-unit clarification, voice prompts, confirmations and empty states.** Use **culturally natural Marathi**, not machine-translated corporate language. Bengali and Punjabi resource architecture retained so the build ports to other states.

## 10.2 Voice, both directions

Speech recognition sets its locale from the selected language. Speech **synthesis** reads back the benchmark, the RAKSHA recommendation and the top buyer — the half that serves a farmer who speaks comfortably but reads with difficulty.

**Offline, speech recognition cannot work and we do not pretend it does:** record the audio locally, let the farmer complete the listing through structured fields **immediately**, and transcribe on reconnection to enrich the record.

> **Keep Phase 1's `.mic-button` exactly as designed** — inline with the field label, with the `listening` state and `mic-pulse` animation. It is the best-executed component in the Phase-1 build. Add: an offline state that says recording-only, and the synthesis direction it currently lacks.

## 10.3 Microcopy — human, direct, domain-specific

The system speaks like a **trustworthy field assistant**, not like software documentation.

| Avoid | Prefer |
|---|---|
| "AI analysis completed successfully." | `फोटो नीट दिसत नाही. थोडं जवळ या.` |
| "Model confidence: 87%." | `पुरावा मध्यम आहे.` |
| "Prediction unavailable." | `सध्याचा डेटा थांबून राहण्याइतका मजबूत नाही.` |
| "🤖 AI Understanding" *(Phase 1)* | "Here's what we understood" / `आम्हाला हे समजलं` |
| "Not detected" *(Phase 1)* | An inline question: "Which crop?" with the options |

## 10.4 Error design — every failure gets a domain explanation

| Bad | Better |
|---|---|
| Something went wrong. | Today's market data is not fresh enough to give you a wait recommendation. |
| Upload failed. | Your photo is saved on this phone and will upload when the connection returns. |
| Match unavailable. | No buyer currently clears the workable price and payment-risk threshold. |
| Invalid input. | ₹2,500 — was that per quintal, per kilo, or for the whole lot? |
| Camera error. | Your phone didn't allow camera access. You can still add a photo from your gallery. |
| No buyers listed yet. *(Phase 1)* | No buyer currently clears the workable price and payment-risk threshold. Today's Lasalgaon rate is ₹1,840/qtl — you can watch for a better offer, join an aggregation pool, or revise your price. |

**Write every error string this way. There are no generic errors in this product.**

---

# PART XI — OFFLINE-FIRST

- Service worker: **stale-while-revalidate** for bundles, cache-first for the app shell, network-only for mutations (which go through the outbox).
- Dexie/IndexedDB: bundles, profile, listings, deals, outbox, photo blobs, model artefacts. **This replaces Phase 1's `localStorage` layer entirely** (`P1-11`) — `localStorage` is synchronous, size-capped, string-only and cannot hold photo Blobs.
- **Progressive, district-first sync.** A farmer's own district is ~2 KB, viable on 2G. Widen only if bandwidth allows. **Photographs and non-critical data sync later on poor networks** (`navigator.connection.effectiveType`).
- **On-device computation:** every function a farmer screen calls reads only from cached tables.
- **Session persistence across connectivity loss.** A farmer who opens the app with no network is **not signed out** because an identity endpoint could not be reached. Distinguish `server reached → authentication rejected` from `network unavailable`; in the latter case restore the last-confirmed profile from secure local cache. *(Phase 1's `loadSession()` reads from `localStorage` unconditionally and so accidentally gets this right — make it deliberate and make the distinction explicit.)*
- **The outbox** queues: listing creation, listing updates, listing renewal, price alerts, photo uploads. Drains with exponential backoff, retry and idempotency. **Deal-state transitions are absent from the outbox type** (Constitution §9).
- **Verify by destruction:** kill the backend entirely mid-session; home, decision evidence and buyer shortlist must keep rendering **freshly computed** numbers. Make this an automated E2E test, not a manual demo trick.

---

# PART XII — REACH BEYOND THE SMARTPHONE

The PWA is the richest channel and the narrowest. The **same `@fasal/shared`** backs:

- **WhatsApp bot** — accepts the same natural-language message the app parses
- **SMS responder** — the core value fits in a text message: `Kanda Lasalgaon Rs1840/qtl · 7d +4%`
- **IVR menu** — for feature-phone users, in Marathi

The farmers with the worst price information are reachable primarily through the last three; a product serving only the first optimises for the users least injured by the problem.

**Assert in a test that all four channels return the identical benchmark figure for the same crop × district × date.**

---

# PART XIII — LOGISTICS, STORAGE, WEATHER

A recommendation to wait is only actionable for a farmer who *can* wait, and most cannot. **Wherever the product suggests prices may rise, it presents the mechanism alongside the advice.**

**Storage lookup** — each facility: name · district · distance · capacity · crop compatibility · cost ₹/qtl/month · accreditation · **e-NWR availability**. When RAKSHA suggests waiting, storage appears **alongside the decision**, with the **e-NWR pledge-financing route** named including the credit guarantee scheme (CGS-NPF) backing it. Storage cost and expected spoilage are netted out of any projected gain **before it is shown**. Where no feasible mechanism exists: *"Waiting may not be practical for this lot"* — and stop (GR-7).

**Transport directory** — vehicle class · capacity · indicative tariff · district · availability. The freight estimate driving net-realisation ranking uses **actual tariff data**, not `distance × arbitrary ₹/km`. On acceptance, attach vehicle class, indicative freight and pickup date to the **sauda slip**. **Do not build a logistics booking engine** — coordinating a pickup is a phone call between two verified parties; make that call informed rather than replacing it.

**Weather as urgency, not prediction.** Rainfall/humidity forecast + anomaly + crop sensitivity → operational urgency:

> *"Rain expected Thursday in Nashik. Your onion lot is moisture-sensitive. Consider moving it within 48 hours."*

Weather also influences **pickup risk** and **listing expiry**.

---

# PART XIV — TESTS AND QUALITY GATES

**Do not stop at UI tests.** Every test names the requirement ID it covers, in `REQUIREMENTS.csv`.

## 14.1 Coverage

**`@fasal/shared` — target ≥ 97 tests** on the correctness boundaries that matter: parsing across languages in both transliteration and native script · Devanagari numerals · quantity normalisation **preserving the stated unit** (`P1-02`) · **the price-unit ambiguity boundary** (`P1-03`) · location fallback (`P1-04`) · staleness suppression at exact per-crop thresholds · **the seven gates as seven independent refusals** · buyer ranking including the ₹50-more-but-90-days case · the hard crop filter (`P1-05`) · benchmark-not-ask price scoring (`P1-06`) · partial-quantity overlap · aggregation pooling to MOQ · the deal state machine including dispute transitions · **the vision pipeline's distinct refusal paths** (gate fail vs OOD vs low confidence).

**`ml` — target ≥ 32 tests**: cleaning rules · feature generation · **the same-day-arrival leakage assertion** · baseline comparison · quantile output ordering (`q10 ≤ q50 ≤ q90`) · conformal coverage · bundle generation · **Python ↔ TypeScript parity** against golden vectors in `data/golden/` (identical feature vectors and identical decisions to 1e-9).

**Security — 14 adversarial tests** (`SEC-01…14`), all must fail to bypass.

**E2E — target ≥ 51 assertions**: one automated test walking the full demonstration journey against a live API, including the offline replay.

**Contract tests**: every adapter's mock and live implementations pass the identical interface suite.

**Accessibility**: automated axe pass on every screen **in both themes**, plus the programmatic contrast table.

**Performance**: Lighthouse CI budget and bundle-size budget both fail the build when exceeded.

**Visual regression**: snapshot every screen in NIGHT and FIELD, in all three locales, at 360px and 1440px.

## 14.2 Determinism

Seed every random source. The demo must produce the same numbers on two consecutive runs, or the pipeline is not reproducible and the validation table means nothing.

## 14.3 The ten acceptance gates — the prototype is not complete until all pass

| Gate | Requirement | How it is proven |
|---|---|---|
| **A · Offline** | Backend can be killed and home, benchmark, RAKSHA and buyer shortlist still render freshly computed values | Automated E2E with the API stopped |
| **B · Security** | All fourteen adversarial database tests fail to bypass | `pnpm test:security` output |
| **C · Camera** | Invalid frames are rejected; all fourteen failure paths handled | Walkthrough of `CAM-01…14` |
| **D · Staleness** | An old forecast cannot produce a recommendation | Clock-shifted test at the exact per-crop threshold |
| **E · Decision** | Any single failed guardrail condition blocks WAIT | Seven independent refusal tests |
| **F · Matching** | Buyer ranking is explainable, net-realisation ordered, and **carries no percentage anywhere** | The three-buyer scenario, §16 + a grep for `%` in match components |
| **G · Deal state** | Offline clients cannot finalise server-authoritative transitions | Compile-time proof + runtime test |
| **H · Language** | Switching language changes the actual interface, not only speech | Snapshot diff across all three locales |
| **I · Price units** | An ambiguous price unit cannot silently pass | The `₹2500` test |
| **J · Migration** | Every `P1-01 … P1-12` row has a passing test and `status = done` | `REQUIREMENTS.csv` printed |

## 14.4 Judge Mode

A hidden internal route (`/_judge`, lazy-loaded, **never linked from the farmer UI**) exposing: model health · bundle version · data freshness · **all nine RAKSHA layer values and their measured weights** · the seven guardrail conditions with pass/fail · validation metrics and baseline comparison · the ingest report · security test status · adapter status (mock vs live) · offline cache status · last vision run's gate results and frame aggregation.

This is how a judge verifies nothing is faked. **It is the only place in the product that may use model terminology freely.** It must not appear in the normal farmer experience.

> Phase 1's `About this build` modal is the ancestor of this — an honest, unprompted account of what is real and what is simulated. **Keep that instinct**, move it to Judge Mode, and make it generated from live system state rather than hand-written prose.

---

# PART XV — BUILD ORDER

**Do not spend the first phase polishing buttons. Get the domain engine working first.** Stop at every gate, print the output, wait for confirmation.

| Phase | Build | Prove it |
|---|---|---|
| **P1** | Architecture, monorepo, TS strict, CI, docker-compose, migrations, **PART 0 artefacts**, Phase-1 study | `pnpm build` clean; the four `.md`/`.csv` artefacts exist and `REQUIREMENTS.csv` carries all `FR/RK/GR/CAM/SEC/P1` rows |
| **P2** | `@fasal/shared` — units, parser, benchmark, staleness, decision, matching, aggregation, dealstate | ≥97 tests green; `P1-02…P1-06` tests green |
| **P3** | DB schema + RLS policies + authentication | `SEC-01…14` all fail to bypass — print the suite |
| **P4** | Mock data adapters (all nine), contract test suite | Same interface suite passes for mock and live shapes |
| **P5** | `ml/ingest` + `ml/clean` **on my dataset** | Print the INGEST REPORT and the resolved column mapping |
| **P6** | `ml/raksha` — RK-1…RK-6, RK-8, forward chaining, conformal calibration, skill scores | Print the validation table; `insufficient` crops withheld |
| **P7** | Bundle generation + `apps/api` bundle serving | Bundle size per district printed; ETag + integrity verified |
| **P8** | Offline PWA architecture — SW, Dexie, outbox, session persistence | **Gate A** |
| **P9** | **Design system port** — tokens (both themes), self-hosted type, glyph set, spine, shell, ported Phase-1 components | Contrast table in both themes + Lighthouse budget printed; visual snapshots |
| **P10** | Home briefing, benchmark strip, RAKSHA component, evidence panel | Benchmark dominates; evidence panel renders nine live layers |
| **P11** | Parser UI, voice, price-unit disambiguation, parse-confirm card | **Gates H, I** |
| **P12** | **Camera pipeline** | **Gate C** — walk all fourteen paths |
| **P13** | Buyer matching + shortlist + no-good-match path | **Gate F** |
| **P14** | FPO aggregation and pools | Pool clears a real MOQ from real listings |
| **P15** | Offers, deals, sauda slip | **Gate G** |
| **P16** | Delivery, payment, reputation | Reputation moves only on completed deals |
| **P17** | Disputes and grievance routing | Open dispute suppresses clean reputation |
| **P18** | Transport, storage, e-NWR, weather urgency | **Gates D, E** |
| **P19** | WhatsApp / SMS / IVR adapters | Identical benchmark across all four channels |
| **P20** | Full test suite, Judge Mode, seeds | **Gate J**; all ten gates green |
| **P21** | Demo polish and the 23-step rehearsal | §16 runs unbroken twice, in both themes |

---

# PART XVI — THE DEMONSTRATION

## 16.1 Seed for Maharashtra

**Primary: Nashik / Lasalgaon APMC / onion** — the largest onion market in Asia and the most economically and politically salient commodity in the state. Also seeded: **Latur** (soybean, tur) · **Jalgaon** (banana) · **Nagpur** (orange) · **Pune and Ahmednagar** (horticulture). The market adapter serves **MSAMB-shaped district data** alongside the Agmarknet-shaped feed. Seeded farmer, buyer and FPO accounts are Maharashtra entities operating in those districts.

> **Reseed from Phase 1.** Its demo data is West Bengal / Kolkata / Howrah, wheat and rice, with registry IDs like `PMK-WB-2201-04871`. The problem statement is Maharashtra's. **Move the seed** — `PMK-MH-…` IDs, Nashik and Latur districts, onion and soybean — while keeping the *shape* of Phase 1's registry (a small bundled sample standing in for a real lookup, with the honest disclaimer).

**Demo data must feel alive.** Never `Buyer 1` / `Buyer 2` / `Test Crop` / `₹100`. Use believable Maharashtra entities — but structure the implementation so mock data is trivially replaceable.

**Seeding on onion is deliberately the most honest demonstration**: it is exactly the crop where model skill is lowest, bands widest, and the guardrail most likely to refuse to recommend waiting. **We would rather show a panel a case where the system declines to advise than a case where it performs.** Feature this; do not hide it.

## 16.2 The scenario

Verified **Nashik** farmer · **onion** · **5 quintals** · **Marathi**. Three buyers:

| Buyer | Offer | Payment |
|---|---|---|
| A | ₹1,950/qtl | 4 days |
| B | ₹2,000/qtl | 60 days |
| C | ₹1,900/qtl | 2 days |

The ranking must make clear **why A can outrank B**:

```
₹2,000 gross
but higher payment-delay risk
```

## 16.3 The twenty-three steps — build so this runs unbroken

1. Choose **Marathi** (pre-login).
2. Sign in as the verified Nashik farmer.
3. Home shows onion **benchmark**, **MSP**, **seven-day trend**, **seasonal position**, **RAKSHA signal**, **best buyer**.
4. Tap **"Why this signal?"** → the nine-layer evidence panel in human language; "Technical details" available for judges.
5. Marathi **voice input**: `"मला ५ क्विंटल कांदा विकायचा आहे"` → parser extracts crop, quantity, unit, intent, location.
6. **Price-unit clarification** on the ambiguous `₹2500` — the app stops and asks.
7. Open camera. **Deliberately show a bad frame** (dark / empty background) → **"Too dark"**.
8. Move to a valid onion frame → gates go green → stable capture.
9. Multi-frame aggregation → **proposed grade + confidence band**.
10. **Farmer confirmation** before anything is written to the listing.
11. Buyer ranking — the three buyers above, **with no percentages anywhere**.
12. **Net-realisation reasoning** made visible.
13. Make/accept an offer.
14. **"Pending server confirmation"** shown briefly → server confirms.
15. **Sauda slip** generates.
16. Delivery confirmation.
17. Payment confirmation.
18. Buyer **reputation** updates.
19. On a second completed deal, raise a **grade dispute** with a photo → the buyer's clean reputation visibly changes to **"Under dispute"** → district-officer routing shown internally.
20. **Network OFF** — really off, not a UI toggle.
21. **Repeat the whole benchmark / RAKSHA / evidence / buyer journey offline**, all values rendered from cached bundles and computed locally. Attempt a server-authoritative action → *"Waiting for server confirmation"*, never "completed".
22. **Network ON.**
23. **Synchronisation** — the outbox drains.

**Step 21 is the emotional climax of the presentation.** Everything before it explains what the product knows; that step shows it **still knows it when the connection does not.**

> Optional, and strong if time allows: **switch to FIELD theme mid-demo** while standing under the hall lights, and say why. It demonstrates that the team thought about where the product is actually used.

---

# PART XVII — DEFINITION OF DONE

**You are NOT done when:** pages exist · buttons exist · cards exist · charts exist · API endpoints return dummy JSON · the Phase-1 screens have been repainted.

**You are done when the entire specified transaction journey actually works.**

- Every important UI element connects to real domain logic.
- Every recommendation originates from the implemented decision logic.
- Every buyer ranking originates from the implemented matching logic, **and shows no percentage**.
- Every image verdict originates from the implemented vision pipeline, or from an explicitly marked demo model.
- Every offline value originates from cached data plus local computation.
- Every transaction state respects the server-authoritative state machine.
- Every private object respects database-level ownership.
- **Every refusal path is real.**
- Every external service is replaceable through an adapter.
- All ten acceptance gates (§14.3) pass.
- `REQUIREMENTS.csv` has a test ID against every row — including all twelve `P1-*` migration rows — and `CUTS.md` explains every gap.

## Final design review — before declaring completion, review every screen as a product designer, in both themes

Does this look like generic AI? · Is the benchmark visually dominant? · Is uncertainty communicated honestly? · Can a farmer understand the action? · Is the language natural? · Does offline state feel intentional? · Does the camera guide the farmer? · Does the buyer ranking explain itself **without a score**? · Does the UI avoid fake precision? · Is any text below 13px? · Does every colour pair pass AA in both themes? · Does the product feel trustworthy? · **Does every feature connect to one of the six market failures?** · **Is this still recognisably the same product Phase 1 was?**

**If not, redesign.**

## The final principle

The product should feel as though someone asked:

> **"What would a farmer actually need to know in the 90 seconds before agreeing to a price at the field gate?"**

…and then engineered every layer of the system around that question.

The finished experience must communicate:

**Know the market. Understand the risk. See the evidence. Know the buyer. Record the deal. Keep your recourse. And keep working when the network disappears.**

That is Fasal Raksha.
