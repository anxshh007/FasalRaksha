-- 0011 · the sauda slip's number, and what a struck deal does to the lot (PROMPT §8.9, §9.9.4)
--
-- Two things follow from acceptance that neither party should have to be trusted to do.
--
-- A slip number. It is read aloud, written in a notebook and quoted in a dispute, so it is short,
-- human and unique: SR-NAS-20260920-0007 — the district, the day, and a number from a sequence
-- that no two transactions can share.
--
-- And the lot stops being for sale. The sauda slip is the agreement, so the listing behind it is
-- sold from that moment; a consignment's listings are all sold together and the consignment is
-- 'dealt'; and every other offer still open on the same lot is declined, because a farmer who has
-- sold their five quintals cannot sell them again and should not be left holding offers that look
-- live. Row-level security rightly lets only a farmer update their own listing, and the party who
-- accepts may be the buyer, so this cannot be application code holding it together: it is a
-- trigger on the deal itself, running as the owner, that closes the subject of the deal.

CREATE SEQUENCE app.sauda_slip_no AS bigint START 1;
GRANT USAGE, SELECT ON SEQUENCE app.sauda_slip_no TO fasal_app;

CREATE FUNCTION app_private.close_subject_of_deal() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.listing_id IS NOT NULL THEN
    UPDATE app.listings SET status = 'sold', updated_at = now() WHERE id = NEW.listing_id AND status = 'open';
  END IF;
  IF NEW.pool_id IS NOT NULL THEN
    UPDATE app.aggregation_pools SET status = 'dealt' WHERE id = NEW.pool_id AND status IN ('forming', 'cleared');
    UPDATE app.listings SET status = 'sold', updated_at = now()
     WHERE status = 'open' AND id IN (SELECT m.listing_id FROM app.aggregation_members m WHERE m.pool_id = NEW.pool_id);
  END IF;

  -- The other traders who were still bidding on this lot are told, rather than left hanging.
  UPDATE app.deals d
     SET state = 'DECLINED', version = d.version + 1, updated_at = now()
   WHERE d.id <> NEW.id
     AND d.state IN ('OFFERED', 'COUNTERED')
     AND ((NEW.listing_id IS NOT NULL AND d.listing_id = NEW.listing_id) OR (NEW.pool_id IS NOT NULL AND d.pool_id = NEW.pool_id));
  RETURN NULL;
END;
$$;

CREATE TRIGGER deals_close_subject AFTER UPDATE OF state ON app.deals
  FOR EACH ROW WHEN (NEW.state = 'SAUDA_SLIP' AND OLD.state = 'ACCEPTED')
  EXECUTE FUNCTION app_private.close_subject_of_deal();
