-- 0005 · bundle releases (PROMPT §5.8, P7)
--
-- A release is one pipeline run published as a whole: every crop × district bundle, the shared
-- bundles (crop dictionary, MSP, district climatology) and the manifest that lists them. The API
-- serves only the current release, so a device can never mix one night's forecast with another
-- night's climatology. A release row is written last, in the same transaction as its bundles:
-- until it commits, nothing in it is visible.
--
-- Runs as fasal_owner. Public reference data: any caller may read it, the application role may
-- not write it.

CREATE TABLE app.bundle_releases (
  version     text PRIMARY KEY CHECK (version ~ '^\d{4}-\d{2}-\d{2}\.\d+$'),
  as_of       date NOT NULL,
  data_source text NOT NULL CHECK (data_source IN ('synthetic', 'agmarknet', 'msamb', 'mixed')),
  manifest    jsonb NOT NULL,
  integrity   text NOT NULL CHECK (integrity ~ '^sha256-[0-9a-f]{64}$'),
  released_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.shared_bundles (
  name         text NOT NULL CHECK (name ~ '^[a-z0-9-]+(/[a-z0-9-]+)?$'),
  version      text NOT NULL,
  payload      jsonb NOT NULL,
  integrity    text NOT NULL CHECK (integrity ~ '^sha256-[0-9a-f]{64}$'),
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (name, version)
);

ALTER TABLE app.forecast_bundles
  ADD CONSTRAINT forecast_bundles_integrity_format CHECK (integrity ~ '^sha256-[0-9a-f]{64}$');
ALTER TABLE app.crop_profiles
  ADD CONSTRAINT crop_profiles_integrity_format CHECK (integrity ~ '^sha256-[0-9a-f]{64}$');

CREATE INDEX bundle_releases_current ON app.bundle_releases (released_at DESC, version DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bundle_releases', 'shared_bundles'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (true)', t || '_public_read', t);
    EXECUTE format('GRANT SELECT ON app.%I TO fasal_app', t);
  END LOOP;
END;
$$;
