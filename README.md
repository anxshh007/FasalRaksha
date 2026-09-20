<p align="center">
  <img src="docs/brand/banner.png" alt="फसल रक्षा · Fasal Raksha — today's rate first, then a decision you can defend" width="900">
</p>

<p align="center">
  <strong>Offline-first price intelligence and a verified-buyer marketplace for the field gate.</strong><br>
  Smart India Hackathon 2026 · PS 26132 — <em>Strengthening market linkages and price discovery for farmers</em><br>
  Government of Maharashtra · Maharashtra State Innovation Society · Team Fasal Rakshak
</p>

---

A farmer standing at the field gate is asked to name a price by someone who already knows what the
mandi paid this morning. Fasal Raksha closes that gap before the buyer opens his mouth: today's
district rate, what waiting would actually cost, and which buyer leaves the most money in the
farmer's hand after freight and the risk of being paid late.

> **It does not merely find a buyer. It protects the farmer's decision before the buyer names the price.**

Everything a farmer sees is computed **on their own phone**, from sealed, hash-verified data
bundles. Kill the server mid-session and the prices, the sell-or-wait answer, the evidence behind
it and the ranked buyers all keep rendering — freshly calculated, not a cached screenshot of
yesterday.

---

## What it looks like

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/screens/03-briefing.png" alt="The morning briefing" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/screens/04-evidence.png" alt="Why this signal" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/screens/07-buyers.png" alt="The buyer shortlist" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>The morning briefing.</b> The district rate first and largest, with the MSP floor, the seven-day movement drawn by hand, and the season's position. Rain in Nashik on Sunday says so, in words a farmer can act on.</td>
    <td valign="top"><b>"Why this signal?"</b> Nine layers of evidence with their measured weights, the seven conditions that must hold before waiting is ever suggested, and technical detail underneath for anyone who wants to check the arithmetic.</td>
    <td valign="top"><b>The buyers.</b> Ranked by what actually reaches the farmer — the offer, less freight, less the cost of waiting for payment and the chance of not being paid. No match percentages anywhere.</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screens/05-price-unit.png" alt="The price unit question" width="100%"></td>
    <td valign="top"><img src="docs/screens/09-sauda-slip.png" alt="The sauda slip" width="100%"></td>
    <td valign="top"><img src="docs/screens/10-offline.png" alt="Field mode, with no network" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>₹2,500 — for what?</b> Per quintal, per kilo, or for the whole lot differ by two orders of magnitude. The app stops and asks with a single tap rather than guessing and being confidently wrong.</td>
    <td valign="top"><b>The sauda slip.</b> Issued by the server the moment a price is agreed, with the day's benchmark, the grade and where it came from, the freight estimate and a suggested pickup day frozen into it. Prints at A5.</td>
    <td valign="top"><b>Field mode.</b> No network, and the product still knows everything it knew: the benchmark, the decision, the evidence, the shortlist — all computed on the phone from verified bundles.</td>
  </tr>
</table>

<p align="center"><img src="docs/brand/grain-rule.svg" alt="" width="520"></p>

## Try it in two minutes

You need Node 24 and pnpm. Nothing else — PostgreSQL is downloaded and run for you, and every
external service has a mock, so there is no account to create and no key to paste.

```bash
pnpm install
pnpm demo
```

Open **http://127.0.0.1:4173**. Sign in with any phone number — the one-time code appears on
screen — then pick any farmer from the demonstration registry list on the verification screen.
Choose a Nashik one for the onion scenario.

```bash
pnpm verify      # typecheck, build, unit, database, ML, 24 browser tests, requirements audit
```

## What makes it different

**It refuses.** When the evidence does not support waiting, the product says so and explains which
condition failed, in a sentence a farmer can act on. Seven guardrails sit in front of every
"wait", and any one of them failing blocks it. Onion — the demonstration crop — is exactly where
forecasting is hardest, and a panel is more usefully shown a system that declines to advise than
one that performs.

**It never scores a farmer against themselves.** Buyers are ranked against the district modal
price, never against the farmer's own asking price, and never with a percentage. The card shows
the offer, the distance, the freight, the gross, what lands after freight, and the buyer's
completed-deal record — every line checkable, nothing asking to be trusted.

**It stops when the data is old.** Past seven days for perishables, fourteen for grains, the
recommendation disappears on its own and the price stays with its date on it. A stale forecast can
never reach a farmer wearing a recommendation.

**It works where the network does not.** A service worker, an IndexedDB store and an outbox mean a
lot can be listed standing in a field with no signal, and it syncs when the connection returns.
Deal transitions are the one thing that cannot happen offline — they commit two parties at once —
and the interface says exactly that instead of pretending.

**It reaches beyond the smartphone.** The same engine answers WhatsApp, a 160-character SMS
(`Kanda Lasalgaon Rs3508/qtl · 7d +4% · vikri karava`) and an IVR script in Marathi. A test asserts
all four channels quote the identical figure for the same crop, district and date.

**Nothing on a farmer's screen mentions a model.** Not "AI", not "confidence interval", not
"score" — the words are banned by a test that scans the shipped copy. Security is invisible too:
no padlocks, no "verified" badges, no "runs locally" reassurance. The product is trustworthy
because of what it does, not because of what it claims.

## How it is built

```
packages/shared   one implementation of every domain rule — benchmark, decision, matching,
                  aggregation, deal state, parser, vision, channels. Zero dependencies, no I/O,
                  no clock. The phone, the API and the channels all compute from this.
apps/api          Fastify over PostgreSQL. Ownership lives in row-level security, not in code:
                  every request asserts a signed actor for one transaction only.
apps/web          React PWA. Marathi first, Hindi and English. Two themes — NIGHT for the hall,
                  FIELD for standing in the sun.
ml                The forecast pipeline: ingest, clean, climatology, features, conformal bands,
                  validation, and the sealed bundle release the phone verifies.
infra             Twelve ordered, checksummed migrations. Immutable once applied.
```

**Ten acceptance gates**, all automated and all run by `pnpm verify`:

| | Gate | Proven by |
|---|---|---|
| A | The backend can be killed mid-session and home still renders | The API process is really killed, then the screen is read |
| B | Fourteen adversarial database tests fail to bypass | `pnpm test:security` |
| C | Every one of fourteen camera failure paths is handled | A scripted camera, the real grader, the real upload pipeline |
| D | An old forecast cannot produce a recommendation | The phone's clock moved past the crop's own limit |
| E | Any single failed condition blocks WAIT | Seven independent refusals, and the screen obeying them |
| F | Ranking is explainable, net-realisation ordered, no percentages | The three-buyer scenario, and a search for `%` |
| G | An offline client cannot finalise a deal | A type-level proof, plus IndexedDB read with the network off |
| H | Switching language changes the interface, not just speech | All three locales |
| I | An ambiguous price unit cannot pass silently | The ₹2,500 test |
| J | Every migrated Phase-1 defect has a passing test | The requirements audit |

## The demonstration

§16.3's twenty-three steps are an automated test — `apps/web/e2e/rehearsal.spec.ts` — run twice on
every verify, once in each theme: choosing Marathi before sign-in, the benchmark, the evidence
panel, a Marathi sentence understood on the phone, the ₹2,500 question, a frame too dark to use, a
real lot of onions graded on the device, the ranked buyers, an offer taken, the sauda slip,
delivery, payment, the buyer's record moving, a grade dispute with the photograph — then the
network switched off, everything still computed on the phone, and the outbox draining when it
comes back.

<p align="center"><img src="docs/screens/12-judge.png" alt="Judge Mode" width="820"></p>

**Judge Mode** (`#/_judge`, typed, never linked from any farmer screen) is the one surface written
to be disbelieved: the release actually loaded and its age, every external service in the mode it
is really running in, all nine layers with their measured weights, the seven conditions, the
pipeline's validation table, the ingest report, the grading models marked `field-validated: false`,
this phone's own cache, and the requirements count. Every figure is read at the moment it is shown.

## The documents

| | |
|---|---|
| [`PROMPT.md`](PROMPT.md) | The master build prompt — the contract this was built against |
| [`CONSTITUTION.md`](CONSTITUTION.md) | The eighteen rules that cannot be broken |
| [`SPEC.md`](SPEC.md) | The condensed specification |
| [`REQUIREMENTS.csv`](REQUIREMENTS.csv) | Every requirement, where it lives, which test proves it |
| [`CUTS.md`](CUTS.md) | Every scope decision and substitution, with its reason |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The map, the decisions taken in each phase, the gaps |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Running it somewhere other than a laptop |
| [`docs/PHASE1-STUDY.md`](docs/PHASE1-STUDY.md) | What carries forward from Phase 1, and what changes |

## Status, honestly

Twenty-one phases built, ten gates green, **75 of 77 requirement rows done**. Run
`pnpm requirements` to print the table.

What is deliberately **not** built, and written down rather than implied:

- **The buyer's own desk** (FR-02, FR-03). The demonstration traders act through the same API a
  real buyer would, but no buyer signs in.
- **The FPO and district-officer consoles.** Both are first-class accounts in the database with
  tested endpoints and no screens of their own.
- **A contact relay.** A masked handle is issued when a farmer acknowledges an offer; nothing yet
  carries a call through it.
- **Field-validated grading.** The models are trained on rendered lots, marked
  `fieldValidated: false` everywhere, and the farmer always confirms the grade.

The market data is a synthetic dataset built to the shape of the real feeds, with every defect of
the real ones injected — wrong units, duplicate sessions, impossible rows, silent gaps — and the
cleaner's report is in Judge Mode. Every screen that shows demonstration data says so.

## Licence

[Apache-2.0](LICENSE).

<p align="center"><img src="docs/brand/grain-rule.svg" alt="" width="360"></p>
