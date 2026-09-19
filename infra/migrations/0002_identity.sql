-- 0002 · identity, the signed request context, authentication state, audit
--
-- Runs as fasal_owner.
--
-- THE SIGNED REQUEST CONTEXT. Row-level security keyed on a session variable is only as strong
-- as the variable: anyone holding the application role's password could set
-- app.current_user_id to someone else's id. So the variable is not trusted on its own. The API
-- signs (user id | role | transaction id) with a key it shares only with this database
-- (app_private.context_key, readable by the owner alone), and app.actor_id() verifies that
-- signature before any policy sees the id. A leaked DATABASE_URL therefore reads nothing
-- private and writes nothing at all; a signature captured from one transaction is useless in
-- the next. (SEC-03, SEC-04.)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE app_private.context_key (
  id  smallint PRIMARY KEY CHECK (id = 1),
  key bytea NOT NULL CHECK (octet_length(key) >= 32)
);
REVOKE ALL ON app_private.context_key FROM PUBLIC;

-- Verified (uid, role) of the current transaction, or no row when anonymous.
-- Raises when an identity is asserted but not correctly signed: forgery is loud, not silent.
CREATE FUNCTION app_private.verified_actor() RETURNS TABLE (uid uuid, role text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  text := nullif(current_setting('app.current_user_id', true), '');
  v_role text := nullif(current_setting('app.current_role', true), '');
  v_sig  text := nullif(current_setting('app.context_sig', true), '');
  v_key  bytea;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT k.key INTO v_key FROM app_private.context_key k WHERE k.id = 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'request context cannot be verified: no context key is installed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_sig IS NULL
     OR v_sig <> encode(public.hmac(convert_to(v_uid || '|' || coalesce(v_role, '') || '|' || pg_current_xact_id()::text, 'UTF8'), v_key, 'sha256'::text), 'hex') THEN
    RAISE EXCEPTION 'request context signature is invalid' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_role NOT IN ('farmer', 'buyer', 'fpo', 'officer') THEN
    RAISE EXCEPTION 'request context names an unknown role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  uid := v_uid::uuid;
  role := v_role;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION app_private.verified_actor() FROM PUBLIC;

-- Replaces the unverified accessors from 0001. Policies call them as (SELECT app.actor_id()),
-- which PostgreSQL evaluates once per statement, not once per row.
CREATE OR REPLACE FUNCTION app.actor_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT uid FROM app_private.verified_actor() $$;

CREATE OR REPLACE FUNCTION app.actor_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT role FROM app_private.verified_actor() $$;

-- ─── accounts and public profiles ─────────────────────────────────────────────────────────
-- A phone number or a registry id is never in the same row as a name a buyer can browse.

CREATE TYPE app.account_kind AS ENUM ('farmer', 'buyer', 'fpo', 'officer');

CREATE TABLE app.users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        app.account_kind NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE app.farmer_profiles (
  user_id          uuid PRIMARY KEY REFERENCES app.users (id),
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  district         text,
  village          text,
  location_lat     double precision CHECK (location_lat BETWEEN -90 AND 90),
  location_lon     double precision CHECK (location_lon BETWEEN -180 AND 180),
  preferred_locale text NOT NULL DEFAULT 'mr' CHECK (preferred_locale IN ('mr', 'hi', 'en', 'bn', 'pa')),
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.farmer_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app.users (id),
  registry          text NOT NULL CHECK (registry IN ('pm-kisan', 'agristack')),
  registry_id_hash  text NOT NULL,
  registry_id_last4 text NOT NULL CHECK (length(registry_id_last4) <= 4),
  verified_name     text NOT NULL,
  verified_district text NOT NULL,
  adapter_mode      text NOT NULL CHECK (adapter_mode IN ('mock', 'live')),
  verified_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registry, registry_id_hash)
);

CREATE TABLE app.farmer_contacts (
  user_id    uuid PRIMARY KEY REFERENCES app.users (id),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.buyer_profiles (
  user_id       uuid PRIMARY KEY REFERENCES app.users (id),
  business_name text NOT NULL CHECK (length(business_name) BETWEEN 1 AND 160),
  place         text NOT NULL,
  district      text NOT NULL,
  location_lat  double precision CHECK (location_lat BETWEEN -90 AND 90),
  location_lon  double precision CHECK (location_lon BETWEEN -180 AND 180),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.buyer_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app.users (id),
  method            text NOT NULL CHECK (method IN ('gstin', 'udyam')),
  identifier_hash   text NOT NULL,
  identifier_last4  text NOT NULL CHECK (length(identifier_last4) <= 4),
  legal_name        text NOT NULL,
  status            text NOT NULL CHECK (status IN ('verified', 'rejected')),
  adapter_mode      text NOT NULL CHECK (adapter_mode IN ('mock', 'live')),
  verified_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (method, identifier_hash)
);

CREATE TABLE app.buyer_contacts (
  user_id    uuid PRIMARY KEY REFERENCES app.users (id),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  email      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.fpos (
  user_id         uuid PRIMARY KEY REFERENCES app.users (id),
  name            text NOT NULL,
  registration_no text,
  district        text NOT NULL,
  location_lat    double precision NOT NULL CHECK (location_lat BETWEEN -90 AND 90),
  location_lon    double precision NOT NULL CHECK (location_lon BETWEEN -180 AND 180),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.fpo_contacts (
  user_id    uuid PRIMARY KEY REFERENCES app.users (id),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.fpo_members (
  fpo_id    uuid NOT NULL REFERENCES app.fpos (user_id),
  farmer_id uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fpo_id, farmer_id)
);

CREATE TABLE app.officer_profiles (
  user_id     uuid PRIMARY KEY REFERENCES app.users (id),
  name        text NOT NULL,
  designation text NOT NULL,
  district    text NOT NULL
);

-- ─── authentication state (no tenant data; integrity-protected by the API) ─────────────────
-- Rows here carry a MAC computed with a key only the API holds, over every field that decides
-- who is being authenticated. A row inserted or edited by anyone else fails verification.

CREATE SCHEMA IF NOT EXISTS app_auth;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC;

CREATE TABLE app_auth.phone_index (
  phone_hash text PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_auth.otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  mac         text NOT NULL
);
CREATE INDEX otp_challenges_phone ON app_auth.otp_challenges (phone_hash, created_at DESC);

CREATE TABLE app_auth.refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users (id),
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  mac         text NOT NULL
);
CREATE INDEX refresh_tokens_family ON app_auth.refresh_tokens (family_id);

-- New accounts are created only here: a user row and its phone index entry, together. The
-- index can never be pointed at an existing account.
CREATE FUNCTION app_auth.create_account(p_kind app.account_kind, p_phone_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_phone_hash IS NULL OR length(p_phone_hash) < 32 THEN
    RAISE EXCEPTION 'a phone hash is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO app.users (kind) VALUES (p_kind) RETURNING id INTO v_id;
  INSERT INTO app_auth.phone_index (phone_hash, user_id) VALUES (p_phone_hash, v_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION app_auth.create_account(app.account_kind, text) FROM PUBLIC;

-- The account kind for a phone, for sign-in. Returns nothing for an unknown phone.
CREATE FUNCTION app_auth.account_for_phone(p_phone_hash text) RETURNS TABLE (user_id uuid, kind app.account_kind, disabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT u.id, u.kind, u.disabled_at IS NOT NULL FROM app_auth.phone_index p JOIN app.users u ON u.id = p.user_id WHERE p.phone_hash = p_phone_hash $$;
REVOKE ALL ON FUNCTION app_auth.account_for_phone(text) FROM PUBLIC;

-- ─── verification (called by the API after a registry lookup, as the verified user) ───────

CREATE FUNCTION app.record_farmer_verification(
  p_registry text, p_registry_id_hash text, p_last4 text, p_name text, p_district text, p_mode text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := app.actor_id();
  v_existing app.farmer_verifications%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR app.actor_role() <> 'farmer' THEN
    RAISE EXCEPTION 'only a signed-in farmer can record their own verification' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_existing FROM app.farmer_verifications WHERE user_id = v_actor ORDER BY verified_at DESC LIMIT 1;
  IF FOUND AND v_existing.registry_id_hash <> p_registry_id_hash THEN
    RAISE EXCEPTION 'this account is already verified against a different farmer identifier' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO app.farmer_verifications (user_id, registry, registry_id_hash, registry_id_last4, verified_name, verified_district, adapter_mode)
  VALUES (v_actor, p_registry, p_registry_id_hash, p_last4, p_name, p_district, p_mode)
  ON CONFLICT (registry, registry_id_hash) DO NOTHING;
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM app.farmer_verifications WHERE user_id = v_actor AND registry_id_hash = p_registry_id_hash) THEN
    RAISE EXCEPTION 'this farmer identifier is already linked to another account' USING ERRCODE = 'unique_violation';
  END IF;
  -- The verified name and district become the account's identity.
  UPDATE app.farmer_profiles SET display_name = p_name, district = p_district, verified_at = coalesce(verified_at, now())
   WHERE user_id = v_actor;
END;
$$;
REVOKE ALL ON FUNCTION app.record_farmer_verification(text, text, text, text, text, text) FROM PUBLIC;

CREATE FUNCTION app.record_buyer_verification(
  p_method text, p_identifier_hash text, p_last4 text, p_legal_name text, p_status text, p_mode text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := app.actor_id();
BEGIN
  IF v_actor IS NULL OR app.actor_role() <> 'buyer' THEN
    RAISE EXCEPTION 'only a signed-in buyer can record their own verification' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.buyer_verifications (user_id, method, identifier_hash, identifier_last4, legal_name, status, adapter_mode)
  VALUES (v_actor, p_method, p_identifier_hash, p_last4, p_legal_name, p_status, p_mode)
  ON CONFLICT (method, identifier_hash) DO UPDATE
    SET status = EXCLUDED.status, legal_name = EXCLUDED.legal_name, verified_at = now()
    WHERE app.buyer_verifications.user_id = v_actor;
  IF NOT EXISTS (SELECT 1 FROM app.buyer_verifications WHERE user_id = v_actor AND method = p_method AND identifier_hash = p_identifier_hash) THEN
    RAISE EXCEPTION 'this business identifier is already linked to another account' USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app.record_buyer_verification(text, text, text, text, text, text) FROM PUBLIC;

-- Verified-buyer status is public (farmers see it); the identifier itself is not.
CREATE FUNCTION app.is_verified_buyer(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT EXISTS (SELECT 1 FROM app.buyer_verifications WHERE user_id = p_user AND status = 'verified') $$;
REVOKE ALL ON FUNCTION app.is_verified_buyer(uuid) FROM PUBLIC;

-- District and verification come only from the registry, through record_farmer_verification
-- (which runs as the owner). The verified name is the farmer's immutable identity once set.
-- `current_user` distinguishes that definer path from the application role — a session
-- setting would not, because any client can set one.
CREATE FUNCTION app_private.guard_farmer_profile() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'fasal_owner' THEN
    IF NEW.district IS DISTINCT FROM OLD.district OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
      RAISE EXCEPTION 'district and verification come only from the farmer registry' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.verified_at IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
      RAISE EXCEPTION 'a verified name cannot be edited' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER farmer_profile_guard BEFORE UPDATE ON app.farmer_profiles FOR EACH ROW EXECUTE FUNCTION app_private.guard_farmer_profile();

-- ─── append-only audit log ─────────────────────────────────────────────────────────────────

CREATE TABLE app.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_role  text,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  context     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION app_private.audit_is_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON app.audit_log FOR EACH ROW EXECUTE FUNCTION app_private.audit_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON app.audit_log FOR EACH STATEMENT EXECUTE FUNCTION app_private.audit_is_append_only();

-- ─── row-level security ────────────────────────────────────────────────────────────────────
-- Enabled (not forced) on every table: it binds fasal_app, the only role the API may use
-- (the boot guard refuses anything else). fasal_owner — migrations, and the narrow SECURITY
-- DEFINER functions above, each of which checks the signed actor itself — is not bound.

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.farmer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.farmer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.farmer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.buyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.buyer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.buyer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fpos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fpo_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fpo_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.officer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self ON app.users FOR SELECT USING (id = (SELECT app.actor_id()));

-- Public farmer profile: the farmer, and the people who trade with farmers.
CREATE POLICY farmer_profiles_read ON app.farmer_profiles FOR SELECT
  USING (user_id = (SELECT app.actor_id()) OR (SELECT app.actor_role()) IN ('buyer', 'fpo', 'officer'));
CREATE POLICY farmer_profiles_insert ON app.farmer_profiles FOR INSERT
  WITH CHECK (user_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'farmer' AND verified_at IS NULL AND district IS NULL);
CREATE POLICY farmer_profiles_update ON app.farmer_profiles FOR UPDATE
  USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));

CREATE POLICY farmer_verifications_self ON app.farmer_verifications FOR SELECT USING (user_id = (SELECT app.actor_id()));

-- Contact rows: the owner only. Nobody else, ever, reads a raw phone number (SEC-01).
CREATE POLICY farmer_contacts_self ON app.farmer_contacts FOR ALL
  USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));

CREATE POLICY buyer_profiles_read ON app.buyer_profiles FOR SELECT USING ((SELECT app.actor_id()) IS NOT NULL);
CREATE POLICY buyer_profiles_insert ON app.buyer_profiles FOR INSERT
  WITH CHECK (user_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'buyer');
CREATE POLICY buyer_profiles_update ON app.buyer_profiles FOR UPDATE
  USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));
CREATE POLICY buyer_verifications_self ON app.buyer_verifications FOR SELECT USING (user_id = (SELECT app.actor_id()));
CREATE POLICY buyer_contacts_self ON app.buyer_contacts FOR ALL
  USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));

CREATE POLICY fpos_read ON app.fpos FOR SELECT USING ((SELECT app.actor_id()) IS NOT NULL);
CREATE POLICY fpos_insert ON app.fpos FOR INSERT WITH CHECK (user_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'fpo');
CREATE POLICY fpos_update ON app.fpos FOR UPDATE USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));
CREATE POLICY fpo_contacts_self ON app.fpo_contacts FOR ALL
  USING (user_id = (SELECT app.actor_id())) WITH CHECK (user_id = (SELECT app.actor_id()));
-- Membership is the farmer's choice; the FPO sees its members.
CREATE POLICY fpo_members_read ON app.fpo_members FOR SELECT
  USING (farmer_id = (SELECT app.actor_id()) OR fpo_id = (SELECT app.actor_id()));
CREATE POLICY fpo_members_join ON app.fpo_members FOR INSERT WITH CHECK (farmer_id = (SELECT app.actor_id()));
CREATE POLICY fpo_members_leave ON app.fpo_members FOR DELETE USING (farmer_id = (SELECT app.actor_id()));

CREATE POLICY officer_profiles_read ON app.officer_profiles FOR SELECT USING ((SELECT app.actor_id()) IS NOT NULL);

-- Anyone signed in may append an audit row about themselves; nobody reads it through the app role.
CREATE POLICY audit_log_append ON app.audit_log FOR INSERT WITH CHECK (actor_id IS NOT DISTINCT FROM (SELECT app.actor_id()));

-- ─── grants ────────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA app_auth TO fasal_app;
GRANT SELECT ON app.users TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.farmer_profiles TO fasal_app;
GRANT SELECT ON app.farmer_verifications TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.farmer_contacts TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.buyer_profiles TO fasal_app;
GRANT SELECT ON app.buyer_verifications TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.buyer_contacts TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.fpos TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.fpo_contacts TO fasal_app;
GRANT SELECT, INSERT, DELETE ON app.fpo_members TO fasal_app;
GRANT SELECT ON app.officer_profiles TO fasal_app;
GRANT INSERT ON app.audit_log TO fasal_app;
GRANT SELECT ON app_auth.phone_index TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app_auth.otp_challenges TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app_auth.refresh_tokens TO fasal_app;
GRANT EXECUTE ON FUNCTION app_auth.create_account(app.account_kind, text) TO fasal_app;
GRANT EXECUTE ON FUNCTION app_auth.account_for_phone(text) TO fasal_app;
GRANT EXECUTE ON FUNCTION app.record_farmer_verification(text, text, text, text, text, text) TO fasal_app;
GRANT EXECUTE ON FUNCTION app.record_buyer_verification(text, text, text, text, text, text) TO fasal_app;
GRANT EXECUTE ON FUNCTION app.is_verified_buyer(uuid) TO fasal_app;
