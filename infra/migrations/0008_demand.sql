-- 0008 · demand for the phone (PROMPT §6.5, §8.9; FR-09; Gate F)
--
-- A farmer's buyer shortlist is computed on the phone, from the district's current demand and
-- each buyer's track record, so it renders with no network at all (Gate A). This migration adds
-- the one thing the phone cannot read directly: a buyer's track record. Row-level security keeps
-- every deal private to its two parties, so the record is exposed only as per-buyer aggregates,
-- through a SECURITY DEFINER function that returns counts and payment days, never a deal.
--
-- Reputation comes from completed transactions only (§8.9):
--   completed deals     deals whose payment the farmer confirmed (PAYMENT_CONFIRMED onward)
--   payment days        days from delivery to payment, one per completed deal
--   defaults            delivered deals still unpaid DEFAULT_DECLARED_AFTER_DAYS after delivery;
--                       each counts that many days of exposure (policy: 90, verified: false)
--   open disputes       disputes not yet resolved on the buyer's deals; they suppress a clean
--                       record on the card
--
-- `demonstration` marks the seeded Maharashtra buyers of the §16 scenario, so every screen that
-- shows one can say it is a demonstration buyer.

ALTER TABLE app.buyer_profiles ADD COLUMN demonstration boolean NOT NULL DEFAULT false;

CREATE FUNCTION app.buyer_track_records(p_buyers uuid[])
  RETURNS TABLE (buyer_id uuid, completed_deals integer, payment_days integer[], defaults integer, default_exposure_days integer, open_disputes integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  c_default_after CONSTANT integer := 90;
BEGIN
  IF app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'sign in to see buyer records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT b.id,
         (SELECT count(*)::integer FROM app.deals d
            WHERE d.buyer_id = b.id AND d.state IN ('PAYMENT_CONFIRMED', 'MUTUALLY_RATED')),
         COALESCE((SELECT array_agg(p.days_after_delivery ORDER BY p.confirmed_at)
                     FROM app.deals d JOIN app.payments p ON p.deal_id = d.id
                    WHERE d.buyer_id = b.id AND d.state IN ('PAYMENT_CONFIRMED', 'MUTUALLY_RATED')), ARRAY[]::integer[]),
         (SELECT count(*)::integer FROM app.deals d
            WHERE d.buyer_id = b.id AND d.state = 'DELIVERY_CONFIRMED'
              AND NOT EXISTS (SELECT 1 FROM app.payments p WHERE p.deal_id = d.id)
              AND (SELECT max(v.confirmed_at) FROM app.deliveries v WHERE v.deal_id = d.id) < now() - make_interval(days => c_default_after)),
         (SELECT count(*)::integer * c_default_after FROM app.deals d
            WHERE d.buyer_id = b.id AND d.state = 'DELIVERY_CONFIRMED'
              AND NOT EXISTS (SELECT 1 FROM app.payments p WHERE p.deal_id = d.id)
              AND (SELECT max(v.confirmed_at) FROM app.deliveries v WHERE v.deal_id = d.id) < now() - make_interval(days => c_default_after)),
         (SELECT count(*)::integer FROM app.disputes x JOIN app.deals d ON d.id = x.deal_id
            WHERE d.buyer_id = b.id AND x.state <> 'RESOLVED')
    FROM unnest(p_buyers) AS b(id);
END
$$;

REVOKE ALL ON FUNCTION app.buyer_track_records(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.buyer_track_records(uuid[]) TO fasal_app;
