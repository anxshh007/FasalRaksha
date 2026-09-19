# SPEC.md — Fasal Raksha, condensed

The re-anchoring sheet. `PROMPT.md` is the full contract, `CONSTITUTION.md` is the part that
cannot be broken, `reference/phase1/FasalRakshak_1.html` is the visual source of truth, and
`reference/report/` is the technical report. When this sheet and `PROMPT.md` disagree,
`PROMPT.md` wins and this sheet is wrong — fix it.

> **Fasal Raksha does not merely find a buyer. It protects the farmer's decision before the
> buyer names the price.**
>
> Product line: **Fasal Raksha — offline-first price intelligence and a verified-buyer
> marketplace for the field gate.** (Phase 1's "AI-powered farmer & buyer marketplace" is
> retired: it is not a marketplace, and "AI-powered" is the framing the spec rejects.)

---

## 1 · The six leaks (every feature must answer one)

| # | Leak | Evidence | Answer in the product |
|---|---|---|---|
| L-1 | Price information asymmetry | 40.7% of paddy households know MSP exists (37.1% wheat), NSS 77th round | Benchmark + MSP floor + 7-day trend on every pricing screen |
| L-2 | Payment default and delay | No contract, no recourse, no counterparty history | Rank by **risk-adjusted net realisation**; payment timeliness is the headline buyer signal |
| L-3 | Lot size below buyer minimums | 86% of holdings small/marginal | Opt-in aggregation pools to an institutional MOQ; FPO is a first-class account |
| L-4 | Quality at a distance | No credible remote quality signal | Camera grading with confidence **bands**, farmer-confirmed, provenance recorded |
| L-5 | Perishability | 31.8 Mt lost post-harvest 2020–22 (NABCONS) | Weather-driven urgency; "wait" refused when no storage is within reach |
| L-6 | Channel exclusion | 548M of 958M users rural, intermittent | Offline PWA on ~2 KB/district/day + WhatsApp + SMS + IVR |

Narrative spine (every screen sits somewhere on it; FIELD MODE runs underneath all of it):
`information asymmetry → benchmark before price → SELL/WAIT → quality proof → trusted buyer →
risk-adjusted realisation → aggregation → transport/storage → sauda slip → delivery → payment →
reputation → dispute + recourse`

## 2 · The fifteen deliverables (PS 26132 Expected Solution)

| ID | Asked for | Implemented as | Phase-1 |
|---|---|---|---|
| FR-01 | Aggregate mandi prices | Nightly Agmarknet-shaped ingestion, cleaning, district benchmark | absent |
| FR-02 | Buyer demand | Requirements: crop, grade floor, quantity, price, district, radius; several concurrent | partial |
| FR-03 | Quality requirements | Variety, FAQ grade, moisture where relevant; grade minimums on requirements | absent |
| FR-04 | Arrival volumes | Ingested, cleaned, RAKSHA layer RK-3 | absent |
| FR-05 | Transport options | District transporter directory; attached at acceptance | absent |
| FR-06 | Storage options | Accredited warehouse lookup; e-NWR pledge route at the decision | absent |
| FR-07 | Localised price trends | District modal, MSP floor, 7-day trend, week-of-year seasonal position | absent |
| FR-08 | Sale-window recommendations | RAKSHA 7/14-day direction + band behind the seven-condition guardrail | absent |
| FR-09 | Match farmers/FPOs with verified buyers | Explained, ranked shortlist; FPO a distinct account type | partial (scored → explained) |
| FR-10 | Lot creation | Offline listing with photos, sync-state display, outbox | partial |
| FR-11 | Quality grading | On-device vision: gates, OOD rejection, bands, farmer confirmation | absent |
| FR-12 | Digital offers | Offer → counter → accept, server-authoritative | absent |
| FR-13 | Logistics coordination | Suggested pickup on the sauda slip; pickup risk vs weather | absent |
| FR-14 | Payment tracking | Independent delivery confirmation; farmer payment confirmation → reputation | absent |
| FR-15 | Dispute / grievance | Reason-coded dispute from delivery onward, evidence, routed to district officer | absent |

## 3 · Architecture in one rule

**Precompute on the server, ship the output, compute every user-specific value on the device.**
Legal only because the model never sees a farmer (Constitution §4): it predicts
`crop × district × horizon`. There is **no live inference service**; the nightly pipeline is the
only thing that runs a model. Staleness is the price, handled explicitly (§10).

Stack (locked): React 18 + Vite + TS strict PWA (SW, Dexie, outbox, ONNX Runtime Web) · Fastify +
TS, PostgreSQL with RLS, `zod` at every boundary, `pino` with PII redaction · `@fasal/shared`
(zero runtime deps, pure) · Python 3.11+ pandas/numpy/scikit-learn/LightGBM(quantile)/onnx,
nightly job · channels WhatsApp/SMS/IVR importing `@fasal/shared` · pnpm workspaces, Node 20+,
Vitest, Playwright, docker-compose for Postgres.

Adapters (each `Mock*` + `Live*`, one interface suite run against both, switch by `.env`):
`MarketData · Weather · FarmerRegistry · BuyerRegistry · Messaging · Speech · ModelFallback ·
StorageRegistry · TransportTariff`.

## 4 · Data contract

- Headers resolved through a synonym table; mapping printed for confirmation; an unresolvable
  **required** column → stop and ask. Never guess.
- Cleaner detects **and repairs with counters**: unit inconsistency (|log ratio| ≈ log 100 vs
  crop × district rolling median) · duplicate sessions (volume-weighted median) · missing days
  (`imputed: true`, capped, excluded from targets) · zero-arrival vs market-closed · commodity
  canonicalisation via an auditable synonym table · impossible rows → `data/raw/_rejected.csv`
  with reason · Hampel outliers on log price (flag, keep, exclude from targets).
- INGEST REPORT printed at P5 and in Judge Mode.
- Thin series: `MIN_SERIES = 400` observations, `MIN_SEASONS = 2` → `insufficient`, forecast
  withheld; the no-forecast path is tested.
- **No user dataset is supplied** (confirmed 2026-09-19) → §4.4 synthetic structural price
  process with every §4.2 defect class injected deliberately. Labelled synthetic everywhere.
- Weather is consumed, never predicted. Climatology = district × week-of-year norms from history.

## 5 · RAKSHA-QAD

*Risk-Aware Quantile Signal Fusion + Asymmetric Decision Guardrail.* Gradient boosting is **not**
claimed as novel. The contribution is (1) skill-weighted fusion of nine signals with **measured**
weights, (2) a cost-sensitive asymmetric decision rule on conformalised quantiles against this
farmer's economics, (3) a seven-condition guardrail governing what the system refuses to say.

| ID | Layer | Method | Runs |
|---|---|---|---|
| RK-1 | Market persistence | Lags {1,2,3,7,14,28}, EWMA spans {3,7,14}, momentum | Server |
| RK-2 | Seasonal position | WOY median + IQR per crop × district, leave-current-year-out | Server |
| RK-3 | Arrival pressure | `log(arrivals / WOY_median_arrivals)`, winsorised, **lagged 1 day** | Server |
| RK-4 | Weather pressure | Rain/humidity anomaly vs climatology × crop sensitivity | Server |
| RK-5 | Market shock | Robust z of log returns, rolling median/MAD, 60-day window | Server |
| RK-6 | Quantile forecast | LightGBM `objective='quantile'`, τ ∈ {0.1, 0.5, 0.9}, target `log(P_{t+h}/P_t)` | Server |
| RK-7 | Risk asymmetry | Cost-sensitive rule on q10 vs storage/spoilage/finance | **Device** |
| RK-8 | Evidence agreement | Skill-weighted vote over {UP, FLAT, DOWN} | Server |
| RK-9 | Decision guardrail | Seven-condition conjunction | **Device** |

RK-6 details: one model per crop × horizon × τ (district categorical when thin, per crop × district
when long — the split is justified in code with series-length evidence) · features available at
prediction time only (a **test fails if any feature reads same-day arrivals**) · split-conformal
widening (never narrowing) of the τ 0.1/0.9 band on the final forward-chaining fold until
coverage ≥ nominal, achieved coverage reported · `bandKappa` per crop shipped;
`band_multiplier(age) = 1 + κ · age_days`.

**RK-8 (not a signed sum):**
```
bucket_i ∈ {UP, FLAT, DOWN}    per layer i ∈ RK-1…RK-6, by its own calibrated threshold
w_i      = max(0, skill_i)     measured out-of-fold skill vs naive — never hand-tuned
score(b) = Σ_{i: bucket_i=b} w_i
direction = argmax_b score(b);  agreement = score(direction) / Σ_b score(b) ∈ [1/3, 1]
```
Unanimous calm = confident calm. Weights recomputed every run and shipped in the bundle.

**RK-7 (device):**
```
carry(h) = storage_rate_per_qtl_month·(h/30) + spoilage_fraction(crop,h)·p0 + finance_rate_annual·p0·(h/365)
G = q50 − p0 − carry(h)         D = q10 − p0 − carry(h)
V = p0 · quantity_qtl           L = τ_loss · V      (τ_loss default 0.02, farmer-adjustable)
WAIT permissible ⟺ G > 0  ∧  D·quantity_qtl > −L  ∧  RK-9 passes
```
storage/spoilage/finance come from **this farmer's reachable warehouse and the e-NWR pledge
rate**, never a constant. Carry is netted out **before** any gain is shown.

**RK-9 · the seven gates (each a named predicate, own test, own refusal):**

| ID | Condition | Refusal |
|---|---|---|
| GR-1 | Price data fresh within the crop's staleness limit | "Not enough current data to advise you." |
| GR-2 | Model has beaten its naive baseline for this crop | "The forecast does not beat the normal seasonal baseline." |
| GR-3 | Forecast confidence clears the higher of two thresholds | "The evidence is not strong enough to suggest waiting." |
| GR-4 | Evidence agreement sufficient | "The signals do not agree strongly enough." |
| GR-5 | Seasonal position does not strongly contradict | "The season points the other way." |
| GR-6 | Net expected gain clears storage + spoilage + financing | "Expected upside does not cover storage and spoilage costs." |
| GR-7 | A real, named storage mechanism is within reach | "Waiting may not be practical for this lot." |

Staleness: every value carries `asOf`; bands widen with age; recommendations **suppressed** past
**7 days (perishables) / 14 days (grains)**.

Validation: forward-chaining expanding window only (a test asserts against random splits) ·
skill vs naive **and** seasonal-naive at 7 and 14 days · directional accuracy · **precision on
"wait"** · conformal coverage achieved vs nominal · status `published` or `insufficient`
(a crop that does not beat naive is withheld). Onion/tomato/chilli expected weaker — **do not
tune it away**; say it in the README.

Bundle (`schemaVersion: 3`): `version, generatedAt, asOf, district, crop, benchmark{modal,min,max,
unit}, msp, trend[7], seasonal{woyMedian, woyIQR, position}, arrivalsRatio, forecast{h7,h14:{q10,
q50,q90,direction,agreement,skill,coverage,bandKappa}}, raksha{layerWeights}, buyers, storage,
transport, stalenessLimitDays, status, integrity`. Shared: `msp.json`,
`climatology/<district>.json`, `crops.json`. Versioned, ETag'd, integrity-checked, stale-aware,
~2 KB per own district, district-first progressive sync.

## 6 · `@fasal/shared` — the one implementation

Modules: `units · parser · benchmark · decision · matching · aggregation · dealstate (+dispute) ·
vision · staleness · bundle · constants · i18n`. Pure TS, no I/O, deterministic.
Key contracts: `Money = {amount, unit}` never a bare number · `Quantity = {value, unit}` carried
end to end, echoed in the farmer's unit (P1-02) · an unmarked price **never** gets a unit — ask
(P1-03) · location falls back to the **verified registry district**, never a constant (P1-04) ·
`OutboxEntry = ListingCreate | ListingUpdate | ListingRenewal | PriceAlert | PhotoUpload` — deal
transitions are **absent from the type** (Constitution §9).

Parser: deterministic rule cascade, Devanagari first, Devanagari numerals, crop dictionary in
`crops.json` (shipped with the bundle, not the app). Must pass:
`मला ५ क्विंटल कांदा विकायचा आहे` · `Mere paas 400 kilo soyabean hai, Latur` ·
`kanda 20 quintal 1840` · `२० क्विंटल कांदा` · `tamatar 3 crate`.

Matching (explained, **never** a percentage): crop is a **hard filter** + one auditable
substitution table (P1-05) · quantity is **overlap** ("500 kg matched · 4,500 kg remaining") ·
price scored against the **district benchmark, never the ask** (P1-06) · distance as **cost** via
`TransportTariffAdapter` · rank = gross − freight − payment-delay cost − default-risk cost from the
buyer's own history · **₹50 more but 90 days ranks below 4 days** (test) · **no score floor**;
empty shortlist is valid and says what to do instead.

Aggregation: constrained clustering on crop, grade band, availability window, geodesic radius;
greedy pooling to MOQ; opt-in; proportional split recorded on the sauda slip. FPO is an account.

## 7 · Vision (`CAM-01…14`)

`OPEN → FRAME GUIDANCE → QUALITY GATE → OOD REJECTION → STABLE CAPTURE → MULTI-FRAME AGGREGATION →
PROPOSAL → BAND → FARMER CONFIRMATION → PROVENANCE`. Gates (blur, brightness, coverage,
stability) at ~11 fps in a Worker on an OffscreenCanvas at 256 px, one message at a time, 400 ms
hysteresis, shutter after 500 ms all-green. OOD is a distinct path with distinct copy and no band.
Classifier per crop family, INT8 224×224 < 5 MB, ONNX Runtime Web, lazy, cached, integrity-checked,
degrades to photo-only. 5 frames over ~1.2 s → category + band. **Never moisture.**
`fieldValidated: false`. Upload: 1280 px long edge, JPEG q0.82, EXIF stripped, content-hash
idempotency key, Blob in IndexedDB outbox.

## 8 · Backend and security (invisible in the farmer UI)

Per request: authenticate → begin → `SET LOCAL app.current_user_id` → `SET LOCAL app.current_role`
→ query → RLS enforces. App connects as a **`NOBYPASSRLS`** non-owner role. Contacts in separate
tables from public profiles. Buyers verify via GSTIN/Udyam (gated: no offers, no contacts until
verified); farmers via PM-KISAN/AgriStack (identity + district, not a barrier). Contact grant only
after offer + farmer acknowledgement; audited; per-buyer daily rate limit. Hardening per §8.5
(zod everywhere, Argon2id, rotating refresh with reuse detection, rate limits, CSP without
`unsafe-inline`, idempotency keys on every mutating endpoint, PII-redacted logs with a test,
append-only audit log). Image hardening per §8.6 (magic bytes, 8 MB streaming cap, bomb guard,
`sharp` re-encode, metadata stripped again, server UUIDs, short-lived signed URLs, no SVG).

Deal state machine (server-authoritative, never finalised offline — offline shows "Pending server
confirmation"):
```
LISTED → OFFERED → COUNTERED → ACCEPTED → SAUDA_SLIP → DELIVERY_CONFIRMED (both, independently)
      → PAYMENT_CONFIRMED (farmer) → MUTUALLY_RATED
from DELIVERY_CONFIRMED: DISPUTE_OPEN → UNDER_REVIEW → RESOLVED (reason code, note, evidence photo,
routed to district agriculture officer; an open dispute suppresses clean reputation)
```
Reputation from completed deals only; always shown with the completed-deal count.

## 9 · Design tokens (PART IX) — `apps/web/design/tokens.css` is the only place colour lives

NIGHT (default, extends Phase 1):
```
--ground #07110C  --ground-soft #0B1710  --surface #0E1B13  --surface-raised #122018
--rule #1C2B22    --rule-strong #2A3C31
--text #F4F7F3    --text-muted #91A097   --text-faint #65736B
--farmer #B9E879  --farmer-tint rgba(185,232,121,.08)
--buyer  #7EC4FF  --buyer-tint  rgba(126,196,255,.08)
--fpo    #D2C09E  --fpo-tint    rgba(210,192,158,.08)
--caution #E8B44A --caution-tint rgba(232,180,74,.08)
--refuse  #E8836B --refuse-tint  rgba(232,131,107,.09)
```
FIELD (outdoor, ink on paper):
```
--ground #F7F8F7  --ground-soft #EDF2EE  --surface #FFFFFF  --surface-raised #FFFFFF
--rule #DCE0DD    --rule-strong #A9BEB0
--text #1A1E1C    --text-muted #5C645E   --text-faint #7C8981
--farmer #1E5631 / #E9F3EB   --buyer #1F3864 / #ECF0F8   --fpo #8A5A00 / #EEE7DB
--caution #8A5A00 / #FDF3E0  --refuse #9C3A2A / #FBEEEB
```
Rules: tints are washes, never blocks · one role accent per screen + at most one semantic ·
colour never the only carrier · no gradients · every text/background pair AA in both themes,
printed as a table.

Type: Manrope 700/800 display · DM Sans 400–700 interface · **DM Mono** all figures
(`tabular-nums lining-nums`) · **Noto Sans Devanagari** for mr/hi, tracking 0, extra leading.
Scale 12/14/16/20/25/31/39/49 · body 16 · nothing below 13 px, body ≥ 15 px · labels 12 px
`.08em` uppercase `--text-faint`. Self-hosted, subset, preloaded, `font-display: swap` (P1-12).

Materials: hairline rules instead of shadows · one shadow token
`0 1px 2px rgb(0 0 0/.18), 0 8px 24px rgb(0 0 0/.12)` for floating surfaces only · radius ≤ 4px
containers, 2px inputs, 0 tables (the `.mic-button` pill is the only exception) · no
`backdrop-filter` · record spine 56–72px (district · language · theme · sync · as-of) · 3:2 / 2:1
asymmetric grid · ~20 hand-drawn glyphs, 20px grid, 1.25 stroke, square caps, `currentColor`, no
icon library, **no emoji** · motion 120–180ms `cubic-bezier(.2,0,0,1)`, opacity + 2–4px translate
only, numbers crossfade 90ms (never count up), `mic-pulse` kept, reduced-motion honoured.

Signature elements: evidence panel ("Why this signal?", descendant of Phase 1's understanding
card) · benchmark strip (modal, MSP rule, hand-drawn 1px sparkline, delta) · parse-confirm card ·
sauda slip (perforated edge, A5 print in FIELD) · refusal card (considered, never an error) ·
field-mode strip. Navigation: `HOME · SELL · BUYERS · MY DEALS`.

Budgets: FCP from cache < 1.5 s · JS < 200 KB gz excluding lazily-loaded ONNX runtime · zero
blocking requests to render home · 44×44 touch targets · 2px focus rings · works at 320 px · no
layout shift. Sizes: 360×800 · 390×844 · 1440+ · tablet.

## 10 · Language

Chosen **before login**; drives UI strings, currency/number formatting, parser, speech
recognition locale, speech synthesis voice. Marathi leads, then Hindi, English; Bengali and
Punjabi resource files retained. Culturally natural Marathi. Offline voice = record locally,
structured fields immediately, transcribe on reconnect. Every error is a domain explanation.

## 11 · Acceptance gates (all ten must pass)

A Offline (API killed, values recomputed) · B Security (SEC-01…14 fail to bypass) · C Camera
(CAM-01…14) · D Staleness (clock-shifted at exact threshold) · E Decision (seven independent
refusals) · F Matching (explained, net-realisation ordered, no `%` anywhere) · G Deal state
(compile-time + runtime) · H Language (snapshot diff across three locales) · I Price units (the
₹2500 test) · J Migration (every P1-01…P1-12 row has a passing test and `status = done`).

Test targets: shared ≥ 97 · ml ≥ 32 · security 14 · E2E ≥ 51 assertions · contract suites for
every adapter · axe in both themes · Lighthouse + bundle budgets · visual snapshots
(2 themes × 3 locales × 360/1440). Seed every random source.

## 12 · Build order

P1 scaffold + PART 0 · P2 shared · P3 DB/RLS/auth (Gate B) · P4 adapters · P5 ingest/clean ·
P6 RAKSHA · P7 bundles · P8 offline PWA (Gate A) · P9 design system · P10 home/benchmark/RAKSHA ·
P11 parser/voice/units (H, I) · P12 camera (C) · P13 matching (F) · P14 pools · P15 offers/deals
(G) · P16 delivery/payment/reputation · P17 disputes · P18 transport/storage/weather (D, E) ·
P19 channels · P20 full suite + Judge Mode (J) · P21 23-step rehearsal, both themes.

Demo seed: Nashik / Lasalgaon / onion primary; Latur (soybean, tur), Jalgaon (banana), Nagpur
(orange), Pune & Ahmednagar (horticulture). Scenario: verified Nashik farmer, 5 qtl onion,
Marathi; buyers A ₹1,950 / 4 days, B ₹2,000 / 60 days, C ₹1,900 / 2 days — A outranks B.
