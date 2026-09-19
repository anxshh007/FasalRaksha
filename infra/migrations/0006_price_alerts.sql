-- 0006 · price alerts (PROMPT §XI outbox: "price alerts")
--
-- "Tell me when onion reaches ₹2,000 a quintal." Set on the phone, often offline, and sent
-- through the outbox when the network returns. The district is the farmer's verified district,
-- taken on the server (P1-04), never from the phone. The threshold is stored per quintal:
-- a threshold per kg is normalised once on the way in, and a per-crate or per-lot figure is
-- refused, because it cannot be compared with a district price per quintal.
--
-- Delivering the alert (SMS or WhatsApp when the price crosses) is the channels phase (P19).
-- This table is the durable record of what the farmer asked for.

CREATE TABLE app.price_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id     uuid NOT NULL REFERENCES app.farmer_profiles (user_id),
  crop          text NOT NULL CHECK (crop ~ '^[a-z0-9-]+$'),
  district      text NOT NULL,
  threshold_per_quintal numeric(12, 2) NOT NULL CHECK (threshold_per_quintal > 0),
  stated_amount numeric(12, 2) NOT NULL CHECK (stated_amount > 0),
  stated_unit   text NOT NULL CHECK (stated_unit IN ('kg', 'quintal', 'tonne')),
  client_key    text NOT NULL CHECK (length(client_key) BETWEEN 8 AND 128),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farmer_id, client_key)
);

ALTER TABLE app.price_alerts ENABLE ROW LEVEL SECURITY;

-- A farmer's alerts are theirs alone: nobody else reads or writes them.
CREATE POLICY price_alerts_own_read ON app.price_alerts FOR SELECT USING (farmer_id = (SELECT app.actor_id()));
CREATE POLICY price_alerts_own_insert ON app.price_alerts FOR INSERT
  WITH CHECK (farmer_id = (SELECT app.actor_id()) AND (SELECT app.actor_role()) = 'farmer');
CREATE POLICY price_alerts_own_update ON app.price_alerts FOR UPDATE
  USING (farmer_id = (SELECT app.actor_id())) WITH CHECK (farmer_id = (SELECT app.actor_id()));

GRANT SELECT, INSERT, UPDATE ON app.price_alerts TO fasal_app;
