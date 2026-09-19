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
