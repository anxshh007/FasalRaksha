-- 0012 · what the other side said afterwards (PROMPT §8.9; FR-14)
--
-- Migration 0003 keeps a rating private to the two people it is about: `ratings_read` shows a row
-- only to its rater or its ratee. That is right — a rating is one person's account of one deal —
-- and it means nobody can compute a reputation by reading the table, which is exactly what a
-- farmer choosing between traders needs to see.
--
-- So reputation comes out as aggregates, the same way a track record does (migration 0008): how
-- many people have rated this account, and their average on each of the three things their side
-- of the deal is rated on. Never a row, never a rater, never a deal.
--
-- Buyers are rated on payment timeliness, weighment fairness and pickup reliability; farmers on
-- quality as described, quantity as described and availability. An account is shown its average
-- beside the count of completed deals, because one five-star rating on one deal must not look
-- like a trader with a hundred closed transactions behind them.

CREATE FUNCTION app.party_ratings(p_users uuid[])
  RETURNS TABLE (
    rated_id uuid,
    ratings integer,
    payment_timeliness numeric,
    weighment_fairness numeric,
    pickup_reliability numeric,
    quality_as_described numeric,
    quantity_as_described numeric,
    availability numeric
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'sign in to see reputation' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT u.id,
         count(r.id)::integer,
         round(avg(r.payment_timeliness), 1),
         round(avg(r.weighment_fairness), 1),
         round(avg(r.pickup_reliability), 1),
         round(avg(r.quality_as_described), 1),
         round(avg(r.quantity_as_described), 1),
         round(avg(r.availability), 1)
    FROM unnest(p_users) AS u(id)
    LEFT JOIN app.ratings r ON r.ratee_id = u.id
   GROUP BY u.id;
END
$$;

REVOKE ALL ON FUNCTION app.party_ratings(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.party_ratings(uuid[]) TO fasal_app;
