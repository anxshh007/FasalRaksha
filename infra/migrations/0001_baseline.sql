-- 0001 · baseline
--
-- Runs as fasal_owner. Creates the application schema and the two request-context accessors
-- that every row-level-security policy (P3 onward) is written against.
--
-- The API sets, per transaction and with set_config(..., true):
--   app.current_user_id  the authenticated user's UUID
--   app.current_role     farmer | buyer | fpo | officer
-- Both are discarded at COMMIT/ROLLBACK, so nothing survives on a pooled connection.

CREATE SCHEMA IF NOT EXISTS app;

-- NULL when unset or empty. A malformed id raises rather than silently matching nothing:
-- a forged, unparseable identity is an error worth seeing.
CREATE OR REPLACE FUNCTION app.actor_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.actor_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.current_role', true), '') $$;

-- The application role may use the schema and call the accessors; it owns nothing.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO fasal_app;
REVOKE ALL ON FUNCTION app.actor_id(), app.actor_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_id(), app.actor_role() TO fasal_app;

-- Functions created later in this schema are not executable by PUBLIC unless granted.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
