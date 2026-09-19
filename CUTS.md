# CUTS.md

Every decision not to build something, reduce its scope, or substitute a locked-stack component —
one entry each, with the reason. **A silent cut is a defect; a logged cut is a design decision.**

Format: `ID · what · why · what exists instead · what it would take to close`

---

## C-01 · Local PostgreSQL runs from the `embedded-postgres` binaries, not docker-compose

**What.** PROMPT §3.2 locks "docker-compose for Postgres". On this development machine the
local database is started by `pnpm db:start`, which runs PostgreSQL 18.4 from the
`embedded-postgres` npm binaries instead of a container.

**Why.** Docker is not installed on the build machine, and installing it needs administrator
rights the build environment does not have.

**What exists instead — and why it is not a downgrade.** It is a genuine PostgreSQL server
process (`PostgreSQL 18.4 on x86_64-windows`) speaking the wire protocol through the same `pg`
driver the API uses in production — not an in-process emulation. The application logs in as a
separate `fasal_app` role with `NOBYPASSRLS`, so row-level security is enforced by the server
exactly as it would be in a container; `apps/api/test/foundation.db.test.ts` proves it on every
run against a throwaway cluster. `infra/docker-compose.yml` ships unchanged (postgres:18) and
`pnpm db:bootstrap` provisions it with the identical roles and migrations; CI runs the database
suite against a `postgres:18` service container. Switching is configuration
(`TEST_DATABASE_SUPERUSER_URL`, `DATABASE_SUPERUSER_URL`), never code.

**To close.** On a machine with Docker: `docker compose -f infra/docker-compose.yml --env-file
.env up -d`, then `pnpm db:bootstrap`.

## C-02 · Live adapters are verified against recorded responses, not against the real services

**What.** All nine adapters have a `Live*` implementation (Agmarknet/OGD, Open-Meteo, the
PM-KISAN/AgriStack and GSTIN/Udyam registry gateway, a DLT SMS gateway, Bhashini ASR, Claude,
the WDRA storage and transport gateways). None has been run against the real service.

**Why.** The build has no credentials for any of them, and a hackathon team cannot obtain
registry-gateway access. Constitution §15 forbids claiming a live integration that is not.

**What exists instead.** Each `Live*` adapter sends the documented request shape and parses the
documented response shape; the contract suite (`apps/api/test/contracts/`) runs the *same*
assertions against the Mock and against the Live adapter replaying recorded responses in the
upstream's format, and also asserts the request each Live adapter sends (URL, headers, body).
For the registry, storage and transport gateways the contract is this project's own gateway
specification (written in each adapter's header), because those registries are reachable only
through an authorised integrator. Open-Meteo needs no key and is the one Live adapter that
would work as soon as `WEATHER_ADAPTER=live` is set. Every adapter defaults to `mock`; Judge
Mode prints each adapter's mode; a live adapter without its credential stops the API at boot.

**To close.** Supply credentials in `.env`, set the adapter to `live`, and run the contract
suite with a recording of one real response per upstream added to the fixtures.

## C-03 · Bundles are integrity-hashed, not asymmetrically signed

**What.** PROMPT §8.5 asks for "signed, versioned, integrity-checked bundles". Every bundle is
versioned and integrity-checked: SHA-256 over its canonical JSON, verified by the publisher,
re-verified by the API on every response, and verified again by the device (SEC-14). Bundles
are **not** signed with a private key whose public half is pinned in the app.

**Why.** A hash proves the document is the one that was hashed. It does not prove who hashed it,
so someone who can rewrite a bundle in transit can also recompute its hash. In this prototype
the bundles travel only from the project's own API origin over TLS, with no CDN or third-party
cache in between, so the threat a signature addresses has no place to occur yet. Verifying an
Ed25519 signature on the device needs either WebCrypto Ed25519, which the older Android WebViews
common in rural India do not have, or a pure-TypeScript verifier inside `@fasal/shared`, which
is far more code than the prototype's risk justifies.

**What exists instead.** Tamper detection at every hop where a bundle can be altered: pipeline
→ publisher (Python seals verified in TypeScript), database → wire (a row altered in PostgreSQL
is refused with 500, `apps/api/test/bundles.db.test.ts`), and wire → phone (the device verifies
before storing, P8). The application role cannot write a bundle at all.

**To close.** Sign `integrity` with Ed25519 in the publisher (key in `.env`, never committed),
ship the signature in the manifest, pin the public key in the web build, and verify on the
device with WebCrypto where available and a vendored verifier otherwise.

## C-04 · `--text-faint` is lighter (NIGHT) and darker (FIELD) than §9.4 specifies

**What.** §9.4 gives `--text-faint` as `#65736B` (NIGHT) and `#7C8981` (FIELD). The shipped
values are `#87968D` and `#616A64`.

**Why.** §9.10 requires WCAG AA on all text in both themes, and the specified values fail it
against every ground: 2.99–3.85:1 in NIGHT, 2.97–3.65:1 in FIELD, where 4.5:1 is required. The
specification's own criticism of Phase 1 (faint greys below AA) applies to them. Each value was
moved toward `--text-muted` by the smallest step that passes on every ground and tint.

**What exists instead.** `apps/web/src/design/contrast.test.ts` computes every text/background
pair from `tokens.css` in both themes and prints the table. The lowest pair is now 4.79:1 in NIGHT
and 4.55:1 in FIELD. Faint and muted are therefore close in colour, so hierarchy comes from size,
weight and case. The test also asserts that the original values fail, so the reason stays
checkable.

**To close.** Nothing to close unless the team prefers a different AA-passing shade. Any value is
acceptable if the contrast test passes.

## C-05 · The performance budget is measured with Playwright + DevTools throttling, not the Lighthouse CLI

**What.** The P9 gate asks for "Lighthouse budget printed". `apps/web/e2e/budget.spec.ts`
measures and prints the §9.10 budget in the installed Microsoft Edge through the Chrome DevTools
Protocol, not through the Lighthouse CLI. It covers JS gzip size, FCP from cache on a 4× CPU /
2G-throttled phone, rendering with no network, and requests to other origins.

**Why.** Lighthouse brings a second browser-automation stack and a large dependency tree into the
repository to compute the same paint timing from the same engine. The Playwright run already
drives the real browser, kills the real API, and asserts the budget, so a regression fails
`pnpm verify` rather than producing a report somebody has to read.

**What exists instead.** Every number is printed on each run and asserted: JS < 200 KB gzip,
median FCP from cache < 1.5 s, a paint with the network gone, and zero third-party requests.

**To close.** `npx lighthouse http://127.0.0.1:4179 --preset=perf --throttling-method=devtools`
against `pnpm e2e`'s preview server gives the same numbers in Lighthouse's format.

## C-06 · The grader was trained on rendered lots, not on field photographs

**What.** §7.3 asks for a MobileNetV3-Small or EfficientNet-Lite0 class model per crop family.
The models in `apps/web/public/models` are a fixed descriptor stage (colour signatures, blemish
and texture energy) with a small INT8 classifier, trained on lots rendered by
`ml/vision/render.py`. They have never seen a real onion.

**Why.** This build has no field-labelled grading photographs and no deep-learning framework
(ARCHITECTURE G-3). Training a CNN on a laboratory corpus would report near-perfect accuracy that
means nothing in a mandi yard (§7.6), which is worse than a small model that says what it is.

**What exists instead.** The full pipeline around the model is real and tested: quality gate,
out-of-distribution rejection, five-view aggregation into a grade and a band, farmer
confirmation with provenance, the proposal stored beside the photo for the learning loop, ONNX
Runtime Web running the INT8 graph on the phone, and parity with Python. Every artefact says
`fieldValidated: false`; the held-out figures on rendered lots are in
`data/models/report.json`, internal only, never shown as an accuracy. The farmer always
confirms, changes or skips the proposal.

**To close.** Collect photograph + proposal + farmer grade + buyer grade at pickup (P16) into a
field set; train MobileNetV3-Small on it; export `image` [N,3,224,224] → `grade_probs` [N,3]
to ONNX and replace the files named in `apps/web/src/camera/models.json`. No device code changes.

## C-07 · Colour-signature priors and gate thresholds are set from descriptions and rendered scenes

**What.** The crop-family colour boxes (`packages/shared/src/vision/signatures.ts`) and the
§7.1/§7.2 thresholds were written from descriptions of the produce and calibrated on the
rendered camera scenes in `data/fixtures/camera`, not on field photographs.

**Why.** The same reason as C-06: there are no field photographs to fit them to.

**What exists instead.** Every threshold is a named constant with a test pinning its behaviour
on each scene (`apps/api/test/vision.scenes.test.ts`): lots pass for their family; a wall, a
ceiling, a face, a shoe and a bucket are rejected for all seven families; each viewfinder message
fires on the scene it exists for. Priors are deliberately wider than the renderer's palettes.

**To close.** Re-fit the boxes and floors on the field set C-06 collects, and add its hard cases
(tarpaulin under a lot, dusk, shade netting) to the scene tests.

## C-08 · Photographs are stored on local disk and scanned for a test signature only

**What.** §8.6 serves photographs "from object storage" and puts a virus scan behind an adapter.
Here the `PhotoStore` is the local disk (`PHOTO_STORE_DIR`), and the `ScanAdapter` is a signature
scanner that recognises the EICAR test file.

**Why.** No object store or scanning service is configured for this build, and a fake "live"
adapter would claim a protection that is not there.

**What exists instead.** Both are interfaces the upload path already calls: storage keys are
server-generated UUIDs only, photos are served only through signed, expiring, per-viewer URLs as
nosniff attachments, and every image is re-encoded by sharp, which destroys embedded payloads
whatever a scanner says. The scan hook runs on every upload and its refusal path is tested.

**To close.** An S3-compatible `PhotoStore` and a ClamAV (or cloud) `ScanAdapter` behind the same
interfaces, selected by configuration.
