-- 0007 · photograph uploads (PROMPT §7.7 CAM-12/13, §7.8, §8.6) and the grading loop (§7.6)
--
-- A photograph leaves the phone in chunks, often over 2G, and may be interrupted anywhere. Each
-- upload is a session keyed by (farmer, listing, content hash): asking again for the same photo
-- returns the same session and how many bytes already arrived, so the phone resumes rather than
-- restarts, and a retry never creates a second photograph. The bytes wait in a spool under a
-- server-generated key; only a finished, verified, re-encoded image becomes a listing photo.
--
-- The learning loop: the photo row keeps what the grader proposed (grade, band, how many views,
-- which weights), next to the grade the farmer declared on the listing. The buyer's grade at
-- pickup is added in P16. Photograph, proposal, declaration and confirmation together are one
-- field-labelled example: the dataset the synthetic-trained weights are waiting for.

CREATE TABLE app.photo_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id       uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  listing_id      uuid NOT NULL REFERENCES app.listings (id),
  content_hash    text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  declared_bytes  integer NOT NULL CHECK (declared_bytes > 0 AND declared_bytes <= 8388608),
  received_bytes  integer NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= declared_bytes),
  spool_key       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  proposal        jsonb CHECK (proposal IS NULL OR jsonb_typeof(proposal) = 'object'),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'stored', 'refused')),
  refusal         text CHECK (length(refusal) <= 64),
  photo_id        uuid REFERENCES app.listing_photos (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farmer_id, listing_id, content_hash),
  CONSTRAINT photo_uploads_stored_has_photo CHECK ((status = 'stored') = (photo_id IS NOT NULL))
);

CREATE INDEX photo_uploads_recent ON app.photo_uploads (farmer_id, created_at DESC);

ALTER TABLE app.listing_photos
  ADD COLUMN proposed_grade  app.grade,
  ADD COLUMN proposal_band   text CHECK (proposal_band IN ('high', 'moderate', 'low')),
  ADD COLUMN proposal_views  integer CHECK (proposal_views BETWEEN 1 AND 5),
  ADD COLUMN model_version   text CHECK (length(model_version) <= 40),
  ADD COLUMN confirmed_grade app.grade,
  ADD CONSTRAINT listing_photos_proposal_whole CHECK (
    (proposed_grade IS NULL AND proposal_band IS NULL AND proposal_views IS NULL AND model_version IS NULL)
    OR (proposed_grade IS NOT NULL AND proposal_band IS NOT NULL AND proposal_views IS NOT NULL AND model_version IS NOT NULL)
  );

ALTER TABLE app.photo_uploads ENABLE ROW LEVEL SECURITY;

-- An upload is the farmer's alone, and only for their own listing.
CREATE POLICY photo_uploads_own_read ON app.photo_uploads FOR SELECT USING (farmer_id = (SELECT app.actor_id()));
CREATE POLICY photo_uploads_own_insert ON app.photo_uploads FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'farmer'
              AND EXISTS (SELECT 1 FROM app.listings l WHERE l.id = listing_id AND l.farmer_id = (SELECT app.actor_id())));
CREATE POLICY photo_uploads_own_update ON app.photo_uploads FOR UPDATE
  USING (farmer_id = (SELECT app.actor_id())) WITH CHECK (farmer_id = (SELECT app.actor_id()));

GRANT SELECT, INSERT, UPDATE ON app.photo_uploads TO fasal_app;
