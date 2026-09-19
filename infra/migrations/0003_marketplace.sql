-- 0003 · the marketplace: demand, listings, deals and their records, contact grants, pools
--
-- Runs as fasal_owner. Every table has row-level security keyed on the signed actor (0002).
-- The deal state machine's single implementation lives in @fasal/shared (dealstate.ts); the
-- API applies it. The database *independently* enforces the security-relevant subset — who
-- may accept, who confirms payment, which edges exist, when ratings and disputes are allowed —
-- so that a client that skips the API still cannot approve its own offer (SEC-08) or rate a
-- deal that never completed (SEC-10). Defence in depth, not a second product rule.

-- Shared value checks (P1-02 / P1-03 at the storage boundary: no number without its unit).
CREATE DOMAIN app.quantity_unit AS text CHECK (VALUE IN ('kg', 'quintal', 'tonne', 'crate', 'bag'));
CREATE DOMAIN app.price_unit AS text CHECK (VALUE IN ('kg', 'quintal', 'tonne', 'crate', 'lot'));
CREATE DOMAIN app.grade AS text CHECK (VALUE IN ('A', 'B', 'C'));

-- ─── buyer demand (FR-02, FR-03) ───────────────────────────────────────────────────────────

CREATE TABLE app.buyer_requirements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id     uuid NOT NULL REFERENCES app.buyer_profiles (user_id),
  crop         text NOT NULL,
  variety      text,
  grade_floor  app.grade,
  min_qty      numeric(14, 3) NOT NULL CHECK (min_qty > 0),
  min_qty_unit app.quantity_unit NOT NULL,
  max_qty      numeric(14, 3) NOT NULL CHECK (max_qty > 0),
  max_qty_unit app.quantity_unit NOT NULL,
  price        numeric(12, 2) NOT NULL CHECK (price > 0),
  price_unit   app.price_unit NOT NULL CHECK (price_unit <> 'lot'),
  moisture_max_pct numeric(4, 1) CHECK (moisture_max_pct BETWEEN 0 AND 100),
  district     text NOT NULL,
  location_lat double precision NOT NULL CHECK (location_lat BETWEEN -90 AND 90),
  location_lon double precision NOT NULL CHECK (location_lon BETWEEN -180 AND 180),
  radius_km    numeric(6, 1) NOT NULL CHECK (radius_km > 0),
  valid_from   date NOT NULL,
  valid_until  date NOT NULL CHECK (valid_until >= valid_from),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── listings (FR-10) ──────────────────────────────────────────────────────────────────────

CREATE TABLE app.listings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        text NOT NULL CHECK (length(client_id) BETWEEN 8 AND 64),
  farmer_id        uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  crop             text NOT NULL,
  variety          text,
  qty              numeric(14, 3) NOT NULL CHECK (qty > 0),
  qty_unit         app.quantity_unit NOT NULL,
  asking_price     numeric(12, 2) CHECK (asking_price > 0),
  asking_unit      app.price_unit,
  grade            app.grade,
  grade_provenance text CHECK (grade_provenance IN ('farmer-declared', 'farmer-declared-ai-assisted')),
  district         text NOT NULL,
  location_lat     double precision CHECK (location_lat BETWEEN -90 AND 90),
  location_lon     double precision CHECK (location_lon BETWEEN -180 AND 180),
  available_from   date NOT NULL,
  available_until  date NOT NULL CHECK (available_until >= available_from),
  pool_opt_in      boolean NOT NULL DEFAULT false,
  note             text CHECK (length(note) <= 500),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'withdrawn', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A price never exists without the basis it was stated on (P1-03).
  CONSTRAINT listings_price_has_unit CHECK ((asking_price IS NULL) = (asking_unit IS NULL)),
  CONSTRAINT listings_grade_has_provenance CHECK ((grade IS NULL) OR (grade_provenance IS NOT NULL)),
  UNIQUE (farmer_id, client_id)
);

-- The district is the farmer's verified district, never the client's claim (P1-04).
CREATE FUNCTION app_private.listing_district() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_district text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.farmer_id <> OLD.farmer_id THEN
      RAISE EXCEPTION 'a listing cannot change hands' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.district := OLD.district;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- BEFORE triggers run ahead of the row-level-security check, so say the true reason here
  -- rather than failing later on a profile this actor is not allowed to read.
  IF app.actor_id() IS NOT NULL AND NEW.farmer_id IS DISTINCT FROM app.actor_id() THEN
    RAISE EXCEPTION 'a listing can only be created in your own name' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT district INTO v_district FROM app.farmer_profiles WHERE user_id = NEW.farmer_id AND verified_at IS NOT NULL;
  IF v_district IS NULL THEN
    RAISE EXCEPTION 'verify your farmer identifier before listing a crop' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.district := v_district;
  RETURN NEW;
END;
$$;
CREATE TRIGGER listings_district BEFORE INSERT OR UPDATE ON app.listings FOR EACH ROW EXECUTE FUNCTION app_private.listing_district();

CREATE TABLE app.listing_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES app.listings (id),
  farmer_id    uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  storage_key  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_length  integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 8388608),
  width        integer NOT NULL CHECK (width > 0),
  height       integer NOT NULL CHECK (height > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, content_hash)
);

-- ─── aggregation (FR-09, PROMPT §6.6) ──────────────────────────────────────────────────────

CREATE TABLE app.aggregation_pools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES app.buyer_requirements (id),
  coordinator_id uuid NOT NULL REFERENCES app.fpos (user_id),
  crop           text NOT NULL,
  district       text NOT NULL,
  status         text NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'cleared', 'dealt', 'closed')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.aggregation_members (
  pool_id        uuid NOT NULL REFERENCES app.aggregation_pools (id),
  listing_id     uuid NOT NULL REFERENCES app.listings (id),
  farmer_id      uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  contributed_kg numeric(14, 3) NOT NULL CHECK (contributed_kg > 0),
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, listing_id)
);

-- ─── deals and their records (FR-12…FR-15) ─────────────────────────────────────────────────

CREATE TABLE app.deals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       uuid REFERENCES app.listings (id),
  pool_id          uuid REFERENCES app.aggregation_pools (id),
  seller_id        uuid NOT NULL REFERENCES app.users (id),
  seller_kind      text NOT NULL CHECK (seller_kind IN ('farmer', 'fpo')),
  buyer_id         uuid NOT NULL REFERENCES app.buyer_profiles (user_id),
  district         text NOT NULL,
  state            text NOT NULL CHECK (state IN ('OFFERED', 'COUNTERED', 'ACCEPTED', 'SAUDA_SLIP', 'DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED', 'MUTUALLY_RATED', 'DECLINED')),
  price            numeric(12, 2) NOT NULL CHECK (price > 0),
  price_unit       app.price_unit NOT NULL,
  qty              numeric(14, 3) NOT NULL CHECK (qty > 0),
  qty_unit         app.quantity_unit NOT NULL,
  last_price_by    text NOT NULL CHECK (last_price_by IN ('seller', 'buyer')),
  delivery_seller  boolean NOT NULL DEFAULT false,
  delivery_buyer   boolean NOT NULL DEFAULT false,
  rated_seller     boolean NOT NULL DEFAULT false,
  rated_buyer      boolean NOT NULL DEFAULT false,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deals_one_subject CHECK ((listing_id IS NULL) <> (pool_id IS NULL)),
  CONSTRAINT deals_parties_differ CHECK (seller_id <> buyer_id)
);
CREATE INDEX deals_seller ON app.deals (seller_id);
CREATE INDEX deals_buyer ON app.deals (buyer_id);

-- The seller's party for the actor, or null.
CREATE FUNCTION app.deal_party(p_deal app.deals, p_actor uuid) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN p_actor = p_deal.seller_id THEN 'seller' WHEN p_actor = p_deal.buyer_id THEN 'buyer' END $$;

CREATE FUNCTION app_private.guard_deal() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid;
  v_party text;
BEGIN
  IF current_user = 'fasal_owner' THEN
    RETURN NEW;
  END IF;
  v_actor := app.actor_id();
  v_party := app.deal_party(OLD, v_actor);
  IF v_party IS NULL THEN
    RAISE EXCEPTION 'only the two parties to a deal can change it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.seller_id <> OLD.seller_id OR NEW.buyer_id <> OLD.buyer_id OR NEW.seller_kind <> OLD.seller_kind
     OR NEW.district <> OLD.district OR NEW.listing_id IS DISTINCT FROM OLD.listing_id OR NEW.pool_id IS DISTINCT FROM OLD.pool_id THEN
    RAISE EXCEPTION 'the parties and subject of a deal cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'this deal changed since you last saw it' USING ERRCODE = 'serialization_failure';
  END IF;
  -- A counter-offer is the only way terms change: the price passes to the side that did not name
  -- it last, and the deal is (or stays) COUNTERED. COUNTERED → COUNTERED is a state "no-op", so
  -- the turn is checked here, not only on state changes.
  IF NEW.last_price_by IS DISTINCT FROM OLD.last_price_by THEN
    IF NEW.last_price_by <> v_party OR OLD.last_price_by = v_party
       OR NEW.state <> 'COUNTERED' OR OLD.state NOT IN ('OFFERED', 'COUNTERED') THEN
      RAISE EXCEPTION 'you can only counter a price the other side named' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_party = 'buyer' AND NOT app.is_verified_buyer(v_actor) THEN
      RAISE EXCEPTION 'a buyer must be verified to negotiate' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF (NEW.price, NEW.price_unit, NEW.qty, NEW.qty_unit) IS DISTINCT FROM (OLD.price, OLD.price_unit, OLD.qty, OLD.qty_unit)
        OR (NEW.state = 'COUNTERED' AND OLD.state <> 'COUNTERED') THEN
    RAISE EXCEPTION 'terms change only by a counter-offer from the other side' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.state <> OLD.state THEN
    IF (OLD.state, NEW.state) NOT IN (
      ('OFFERED', 'COUNTERED'), ('COUNTERED', 'COUNTERED'),
      ('OFFERED', 'ACCEPTED'), ('COUNTERED', 'ACCEPTED'),
      ('OFFERED', 'DECLINED'), ('COUNTERED', 'DECLINED'),
      ('ACCEPTED', 'SAUDA_SLIP'), ('SAUDA_SLIP', 'DELIVERY_CONFIRMED'),
      ('DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED'), ('PAYMENT_CONFIRMED', 'MUTUALLY_RATED')
    ) THEN
      RAISE EXCEPTION 'a deal cannot move from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state = 'ACCEPTED' AND OLD.last_price_by = v_party THEN
      RAISE EXCEPTION 'you cannot accept a price you named yourself' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.state = 'ACCEPTED' AND v_party = 'buyer' AND NOT app.is_verified_buyer(v_actor) THEN
      RAISE EXCEPTION 'a buyer must be verified to negotiate' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.state = 'PAYMENT_CONFIRMED' AND v_party <> 'seller' THEN
      RAISE EXCEPTION 'only the seller confirms that payment arrived' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.state = 'DELIVERY_CONFIRMED' AND NOT (NEW.delivery_seller AND NEW.delivery_buyer) THEN
      RAISE EXCEPTION 'delivery is confirmed by both sides' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state = 'MUTUALLY_RATED' AND NOT (NEW.rated_seller AND NEW.rated_buyer) THEN
      RAISE EXCEPTION 'both sides must rate first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Each side sets only its own confirmation flags, once, at the right stage.
  IF NEW.delivery_seller IS DISTINCT FROM OLD.delivery_seller AND (v_party <> 'seller' OR OLD.delivery_seller OR OLD.state <> 'SAUDA_SLIP') THEN
    RAISE EXCEPTION 'you cannot confirm delivery for the other side' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.delivery_buyer IS DISTINCT FROM OLD.delivery_buyer AND (v_party <> 'buyer' OR OLD.delivery_buyer OR OLD.state <> 'SAUDA_SLIP') THEN
    RAISE EXCEPTION 'you cannot confirm delivery for the other side' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rated_seller IS DISTINCT FROM OLD.rated_seller AND (v_party <> 'seller' OR OLD.rated_seller OR OLD.state <> 'PAYMENT_CONFIRMED') THEN
    RAISE EXCEPTION 'ratings follow a completed deal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rated_buyer IS DISTINCT FROM OLD.rated_buyer AND (v_party <> 'buyer' OR OLD.rated_buyer OR OLD.state <> 'PAYMENT_CONFIRMED') THEN
    RAISE EXCEPTION 'ratings follow a completed deal' USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER deals_guard BEFORE UPDATE ON app.deals FOR EACH ROW EXECUTE FUNCTION app_private.guard_deal();

CREATE TABLE app.offers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL UNIQUE REFERENCES app.deals (id),
  buyer_id   uuid NOT NULL REFERENCES app.buyer_profiles (user_id),
  price      numeric(12, 2) NOT NULL CHECK (price > 0),
  price_unit app.price_unit NOT NULL,
  qty        numeric(14, 3) NOT NULL CHECK (qty > 0),
  qty_unit   app.quantity_unit NOT NULL,
  -- The district benchmark at the moment the offer was made (benchmark before price).
  benchmark_modal numeric(12, 2),
  benchmark_as_of date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.counters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES app.deals (id),
  by_party   text NOT NULL CHECK (by_party IN ('seller', 'buyer')),
  by_user    uuid NOT NULL REFERENCES app.users (id),
  price      numeric(12, 2) NOT NULL CHECK (price > 0),
  price_unit app.price_unit NOT NULL,
  qty        numeric(14, 3) NOT NULL CHECK (qty > 0),
  qty_unit   app.quantity_unit NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.sauda_slips (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL UNIQUE REFERENCES app.deals (id),
  slip_no    text NOT NULL UNIQUE,
  -- Frozen at acceptance: terms, grade and provenance, benchmark at the time of sale, freight,
  -- pickup arrangement, payment terms, the pool split table when pooled.
  payload    jsonb NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES app.deals (id),
  party        text NOT NULL CHECK (party IN ('seller', 'buyer')),
  confirmed_by uuid NOT NULL REFERENCES app.users (id),
  weighed_qty  numeric(14, 3) CHECK (weighed_qty > 0),
  weighed_unit app.quantity_unit,
  note         text CHECK (length(note) <= 500),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, party)
);

CREATE TABLE app.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL UNIQUE REFERENCES app.deals (id),
  amount       numeric(14, 2) NOT NULL CHECK (amount > 0),
  confirmed_by uuid NOT NULL REFERENCES app.users (id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  days_after_delivery integer NOT NULL CHECK (days_after_delivery >= 0)
);

CREATE TABLE app.ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES app.deals (id),
  rater_id   uuid NOT NULL REFERENCES app.users (id),
  ratee_id   uuid NOT NULL REFERENCES app.users (id),
  -- Buyers are rated on these three (payment timeliness is the load-bearing signal)…
  payment_timeliness  smallint CHECK (payment_timeliness BETWEEN 1 AND 5),
  weighment_fairness  smallint CHECK (weighment_fairness BETWEEN 1 AND 5),
  pickup_reliability  smallint CHECK (pickup_reliability BETWEEN 1 AND 5),
  -- …farmers on these three.
  quality_as_described  smallint CHECK (quality_as_described BETWEEN 1 AND 5),
  quantity_as_described smallint CHECK (quantity_as_described BETWEEN 1 AND 5),
  availability          smallint CHECK (availability BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ratings_not_self CHECK (rater_id <> ratee_id),
  UNIQUE (deal_id, rater_id)
);

CREATE TABLE app.disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES app.deals (id),
  raised_by       uuid NOT NULL REFERENCES app.users (id),
  raised_by_party text NOT NULL CHECK (raised_by_party IN ('seller', 'buyer')),
  reason          text NOT NULL CHECK (reason IN ('QUANTITY_SHORT', 'GRADE_DISPUTE', 'PAYMENT_OVERDUE', 'NO_SHOW', 'OTHER')),
  note            text NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  district        text NOT NULL,
  state           text NOT NULL DEFAULT 'DISPUTE_OPEN' CHECK (state IN ('DISPUTE_OPEN', 'UNDER_REVIEW', 'RESOLVED')),
  reviewed_by     uuid REFERENCES app.users (id),
  outcome         text CHECK (outcome IN ('upheld', 'rejected', 'settled')),
  resolution_note text,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
-- One open dispute per deal at a time.
CREATE UNIQUE INDEX disputes_one_open ON app.disputes (deal_id) WHERE state <> 'RESOLVED';

CREATE FUNCTION app_private.guard_dispute() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_deal app.deals%ROWTYPE;
BEGIN
  IF current_user = 'fasal_owner' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_deal FROM app.deals WHERE id = NEW.deal_id;
    NEW.district := v_deal.district;
    NEW.state := 'DISPUTE_OPEN';
    RETURN NEW;
  END IF;
  IF (OLD.deal_id, OLD.raised_by, OLD.raised_by_party, OLD.reason, OLD.note, OLD.district, OLD.opened_at)
     IS DISTINCT FROM (NEW.deal_id, NEW.raised_by, NEW.raised_by_party, NEW.reason, NEW.note, NEW.district, NEW.opened_at) THEN
    RAISE EXCEPTION 'a dispute record cannot be rewritten' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.state = 'DISPUTE_OPEN' AND NEW.state = 'UNDER_REVIEW') OR (OLD.state = 'UNDER_REVIEW' AND NEW.state = 'RESOLVED')) THEN
    RAISE EXCEPTION 'a dispute moves open → under review → resolved' USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewed_by := app.actor_id();
  IF NEW.state = 'RESOLVED' THEN
    IF NEW.outcome IS NULL THEN
      RAISE EXCEPTION 'a resolution needs an outcome' USING ERRCODE = 'check_violation';
    END IF;
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER disputes_guard BEFORE INSERT OR UPDATE ON app.disputes FOR EACH ROW EXECUTE FUNCTION app_private.guard_dispute();

CREATE TABLE app.grievance_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES app.disputes (id),
  uploaded_by  uuid NOT NULL REFERENCES app.users (id),
  storage_key  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── contact grants: masked, acknowledged, audited, rate-limited (PROMPT §8.4) ─────────────

CREATE TABLE app.contact_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES app.deals (id),
  farmer_id    uuid NOT NULL REFERENCES app.users (id),
  buyer_id     uuid NOT NULL REFERENCES app.buyer_profiles (user_id),
  -- An opaque handle for the masked relay; never a phone number.
  relay_handle text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  reason       text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days',
  UNIQUE (deal_id)
);

-- Per-buyer daily limit (SEC-07). A marketplace of verified identities is a contact-harvesting
-- resource without one. 20 grants per buyer per rolling 24 hours.
CREATE FUNCTION app_private.contact_grant_rate_limit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('contact-grant:' || NEW.buyer_id::text));
  IF (SELECT count(*) FROM app.contact_grants WHERE buyer_id = NEW.buyer_id AND granted_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'this buyer has reached today''s limit for new farmer contacts' USING ERRCODE = 'program_limit_exceeded';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contact_grants_rate_limit BEFORE INSERT ON app.contact_grants FOR EACH ROW EXECUTE FUNCTION app_private.contact_grant_rate_limit();

-- ─── idempotency: a 2G retry never creates a second transaction (PROMPT §8.5) ──────────────

CREATE TABLE app.idempotency_keys (
  actor_id     uuid NOT NULL,
  key          text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  status_code  smallint NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);

-- ─── row-level security ────────────────────────────────────────────────────────────────────

ALTER TABLE app.buyer_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aggregation_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aggregation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sauda_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.grievance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Demand is public to anyone signed in; only the buyer writes their own (SEC-04).
CREATE POLICY requirements_read ON app.buyer_requirements FOR SELECT USING ((SELECT app.actor_id()) IS NOT NULL);
CREATE POLICY requirements_insert ON app.buyer_requirements FOR INSERT
  WITH CHECK (buyer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'buyer');
CREATE POLICY requirements_update ON app.buyer_requirements FOR UPDATE
  USING (buyer_id = (SELECT app.actor_id())) WITH CHECK (buyer_id = (SELECT app.actor_id()));

-- Listings: the farmer's own; browsable by buyers, FPOs and officers — never other farmers' (SEC-02).
CREATE POLICY listings_read ON app.listings FOR SELECT
  USING (farmer_id = (SELECT app.actor_id()) OR (SELECT app.actor_role()) IN ('buyer', 'fpo', 'officer'));
CREATE POLICY listings_insert ON app.listings FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'farmer');
CREATE POLICY listings_update ON app.listings FOR UPDATE
  USING (farmer_id = (SELECT app.actor_id())) WITH CHECK (farmer_id = (SELECT app.actor_id()));

CREATE POLICY listing_photos_read ON app.listing_photos FOR SELECT
  USING (farmer_id = (SELECT app.actor_id()) OR (SELECT app.actor_role()) IN ('buyer', 'fpo', 'officer'));
CREATE POLICY listing_photos_insert ON app.listing_photos FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.listings l WHERE l.id = listing_id AND l.farmer_id = (SELECT app.actor_id())));

CREATE POLICY pools_read ON app.aggregation_pools FOR SELECT USING ((SELECT app.actor_id()) IS NOT NULL);
CREATE POLICY pools_insert ON app.aggregation_pools FOR INSERT
  WITH CHECK (coordinator_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'fpo');
CREATE POLICY pools_update ON app.aggregation_pools FOR UPDATE
  USING (coordinator_id = (SELECT app.actor_id())) WITH CHECK (coordinator_id = (SELECT app.actor_id()));

-- Pooling is opt-in: only the farmer puts their own opted-in listing into a pool.
CREATE POLICY pool_members_read ON app.aggregation_members FOR SELECT
  USING (farmer_id = (SELECT app.actor_id())
         OR EXISTS (SELECT 1 FROM app.aggregation_pools p WHERE p.id = pool_id AND p.coordinator_id = (SELECT app.actor_id())));
CREATE POLICY pool_members_join ON app.aggregation_members FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.listings l WHERE l.id = listing_id AND l.farmer_id = (SELECT app.actor_id()) AND l.pool_opt_in AND l.status = 'open'));
CREATE POLICY pool_members_leave ON app.aggregation_members FOR DELETE USING (farmer_id = (SELECT app.actor_id()));

-- Deals: the two parties, and the district officer of the deal's district.
CREATE POLICY deals_read ON app.deals FOR SELECT
  USING (seller_id = (SELECT app.actor_id()) OR buyer_id = (SELECT app.actor_id())
         OR ((SELECT app.actor_role()) = 'officer'
             AND district = (SELECT o.district FROM app.officer_profiles o WHERE o.user_id = (SELECT app.actor_id()))));
-- Only a verified buyer opens a deal, with an offer, on an open listing or pool (SEC-05).
CREATE POLICY deals_open ON app.deals FOR INSERT
  WITH CHECK (
    buyer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'buyer'
    AND app.is_verified_buyer((SELECT app.actor_id()))
    AND state = 'OFFERED' AND last_price_by = 'buyer' AND version = 1
    -- Columns of the new row are qualified as deals.*: inside a subquery an unqualified name binds
    -- to the innermost table that has it, so `l.district = district` would compare l with itself.
    AND (
      (deals.listing_id IS NOT NULL AND deals.seller_kind = 'farmer'
        AND EXISTS (SELECT 1 FROM app.listings l WHERE l.id = deals.listing_id AND l.farmer_id = deals.seller_id
                    AND l.status = 'open' AND l.district = deals.district))
      OR (deals.pool_id IS NOT NULL AND deals.seller_kind = 'fpo'
        AND EXISTS (SELECT 1 FROM app.aggregation_pools p WHERE p.id = deals.pool_id AND p.coordinator_id = deals.seller_id
                    AND p.status = 'cleared' AND p.district = deals.district))
    )
  );
CREATE POLICY deals_update ON app.deals FOR UPDATE
  USING (seller_id = (SELECT app.actor_id()) OR buyer_id = (SELECT app.actor_id()))
  WITH CHECK (seller_id = (SELECT app.actor_id()) OR buyer_id = (SELECT app.actor_id()));

CREATE POLICY offers_read ON app.offers FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY offers_insert ON app.offers FOR INSERT
  WITH CHECK (buyer_id = (SELECT app.actor_id()) AND app.is_verified_buyer((SELECT app.actor_id()))
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.buyer_id = (SELECT app.actor_id())));

CREATE POLICY counters_read ON app.counters FOR SELECT USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY counters_insert ON app.counters FOR INSERT
  WITH CHECK (by_user = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND app.deal_party(d, (SELECT app.actor_id())) = by_party));

CREATE POLICY slips_read ON app.sauda_slips FOR SELECT USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY slips_issue ON app.sauda_slips FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.state = 'SAUDA_SLIP'
                      AND app.deal_party(d, (SELECT app.actor_id())) IS NOT NULL));

CREATE POLICY deliveries_read ON app.deliveries FOR SELECT USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY deliveries_confirm ON app.deliveries FOR INSERT
  WITH CHECK (confirmed_by = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.state IN ('SAUDA_SLIP', 'DELIVERY_CONFIRMED')
                          AND app.deal_party(d, (SELECT app.actor_id())) = party));

CREATE POLICY payments_read ON app.payments FOR SELECT USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY payments_confirm ON app.payments FOR INSERT
  WITH CHECK (confirmed_by = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.state = 'PAYMENT_CONFIRMED'
                          AND d.seller_id = (SELECT app.actor_id())));

-- Ratings: only on a completed deal, by a party, about the counterparty; never edited (SEC-10, SEC-12).
CREATE POLICY ratings_read ON app.ratings FOR SELECT
  USING (rater_id = (SELECT app.actor_id()) OR ratee_id = (SELECT app.actor_id()));
CREATE POLICY ratings_insert ON app.ratings FOR INSERT
  WITH CHECK (rater_id = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.state IN ('PAYMENT_CONFIRMED', 'MUTUALLY_RATED')
                          AND ((d.seller_id = rater_id AND d.buyer_id = ratee_id) OR (d.buyer_id = rater_id AND d.seller_id = ratee_id))));

-- Disputes: raised by a party from delivery onward (SEC-11); reviewed by the district officer.
CREATE POLICY disputes_read ON app.disputes FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id));
CREATE POLICY disputes_raise ON app.disputes FOR INSERT
  WITH CHECK (raised_by = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id
                          AND d.state IN ('DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED', 'MUTUALLY_RATED')
                          AND app.deal_party(d, (SELECT app.actor_id())) = raised_by_party));
CREATE POLICY disputes_review ON app.disputes FOR UPDATE
  USING ((SELECT app.actor_role()) = 'officer'
         AND district = (SELECT o.district FROM app.officer_profiles o WHERE o.user_id = (SELECT app.actor_id())))
  WITH CHECK ((SELECT app.actor_role()) = 'officer'
         AND district = (SELECT o.district FROM app.officer_profiles o WHERE o.user_id = (SELECT app.actor_id())));

CREATE POLICY evidence_read ON app.grievance_evidence FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.disputes x WHERE x.id = dispute_id));
CREATE POLICY evidence_add ON app.grievance_evidence FOR INSERT
  WITH CHECK (uploaded_by = (SELECT app.actor_id())
              AND EXISTS (SELECT 1 FROM app.disputes x JOIN app.deals d ON d.id = x.deal_id
                          WHERE x.id = dispute_id AND app.deal_party(d, (SELECT app.actor_id())) IS NOT NULL));

-- A contact grant is created by the *farmer*, acknowledging a verified buyer's offer (SEC-06).
-- The buyer sees the grant's relay handle; neither side ever reads the other's raw contact row.
CREATE POLICY grants_read ON app.contact_grants FOR SELECT
  USING (farmer_id = (SELECT app.actor_id()) OR buyer_id = (SELECT app.actor_id()));
CREATE POLICY grants_acknowledge ON app.contact_grants FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) IN ('farmer', 'fpo')
              AND app.is_verified_buyer(buyer_id)
              AND EXISTS (SELECT 1 FROM app.deals d WHERE d.id = deal_id AND d.seller_id = farmer_id AND d.buyer_id = contact_grants.buyer_id
                          AND d.state NOT IN ('DECLINED')));

CREATE POLICY idempotency_own ON app.idempotency_keys FOR ALL
  USING (actor_id = (SELECT app.actor_id())) WITH CHECK (actor_id = (SELECT app.actor_id()));

-- ─── grants ────────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON app.buyer_requirements TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.listings TO fasal_app;
GRANT SELECT, INSERT ON app.listing_photos TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.aggregation_pools TO fasal_app;
GRANT SELECT, INSERT, DELETE ON app.aggregation_members TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.deals TO fasal_app;
GRANT SELECT, INSERT ON app.offers, app.counters, app.sauda_slips, app.deliveries, app.payments, app.ratings, app.grievance_evidence, app.contact_grants TO fasal_app;
GRANT SELECT, INSERT, UPDATE ON app.disputes TO fasal_app;
GRANT SELECT, INSERT ON app.idempotency_keys TO fasal_app;
GRANT EXECUTE ON FUNCTION app.deal_party(app.deals, uuid) TO fasal_app;
