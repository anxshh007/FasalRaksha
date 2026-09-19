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
