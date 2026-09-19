-- 0009 · what a consignment adds up to (PROMPT §6.6; FR-09)
--
-- A farmer deciding whether to put their lot into a consignment needs to know what it holds:
-- how many contributors, how much volume against the buyer's minimum, the grade range and the
-- window everyone shares. They do not need to know whose lots those are, and migration 0003's
-- policy is right to keep every membership row private to its own farmer and the coordinator.
--
-- So the totals come from a SECURITY DEFINER function that returns sums and counts only: one row
-- per pool, no listing, no farmer. The caller's own membership is read through the ordinary
-- policy, so "your share" is theirs alone.

CREATE FUNCTION app.pool_totals(p_pools uuid[])
  RETURNS TABLE (pool_id uuid, contributors integer, total_kg numeric, best_grade app.grade, worst_grade app.grade, ungraded integer, window_from date, window_until date)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'sign in to see a consignment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT p.id,
         count(m.listing_id)::integer,
         COALESCE(sum(m.contributed_kg), 0),
         -- app.grade is a text domain: 'A' sorts first, and A is the best grade. An aggregate
         -- over a domain comes back as its base type, so each is cast back.
         min(l.grade)::app.grade,
         max(l.grade)::app.grade,
         count(m.listing_id) FILTER (WHERE l.grade IS NULL)::integer,
         max(l.available_from),
         min(l.available_until)
    FROM unnest(p_pools) AS p(id)
    LEFT JOIN app.aggregation_members m ON m.pool_id = p.id
    LEFT JOIN app.listings l ON l.id = m.listing_id
   GROUP BY p.id;
END
$$;

REVOKE ALL ON FUNCTION app.pool_totals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pool_totals(uuid[]) TO fasal_app;
