-- 0010 · a consignment clears itself (PROMPT §6.6; FR-09)
--
-- Migration 0003 is right that only the coordinator may update a consignment: no farmer should be
-- able to declare another farmer's consignment complete. But "complete" is not anybody's opinion.
-- It is arithmetic: the lots actually in the consignment against the minimum the buyer stated. The
-- moment a farmer's lot takes the volume past that minimum the consignment is complete, whether or
-- not the coordinator is awake, and the moment a lot leaves, it is not complete any more.
--
-- Before this function the API set the status itself after a farmer joined. Row-level security
-- silently dropped that UPDATE — the farmer is not the coordinator — and the API went on to tell
-- the farmer the consignment had cleared when the database still said 'forming'. The state moves
-- here instead, derived from the rows, and both callers read the status back out of the table.
--
-- Any signed-in caller may ask a consignment to settle, because asking gains nothing: the answer
-- is determined entirely by the rows, so the only status it can ever write is the one the facts
-- already require. A consignment that has been sold ('dealt', 'closed') is never touched.

CREATE FUNCTION app.pool_settle(p_pool uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_status text;
  v_need   numeric;
  v_total  numeric;
BEGIN
  IF app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'sign in to change a consignment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.status,
         CASE r.min_qty_unit
           WHEN 'kg' THEN r.min_qty
           WHEN 'quintal' THEN r.min_qty * 100
           WHEN 'tonne' THEN r.min_qty * 1000
         END
    INTO v_status, v_need
    FROM app.aggregation_pools p
    JOIN app.buyer_requirements r ON r.id = p.requirement_id
   WHERE p.id = p_pool;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'there is no such consignment' USING ERRCODE = 'no_data_found';
  END IF;

  -- A sold consignment, and a minimum stated in a unit this service cannot weigh (crates, bags),
  -- are both left exactly as they are: the first is history, the second is the coordinator's call.
  IF v_status NOT IN ('forming', 'cleared') OR v_need IS NULL THEN
    RETURN v_status;
  END IF;

  SELECT COALESCE(sum(m.contributed_kg), 0) INTO v_total
    FROM app.aggregation_members m WHERE m.pool_id = p_pool;

  UPDATE app.aggregation_pools
     SET status = CASE WHEN v_total >= v_need THEN 'cleared' ELSE 'forming' END
   WHERE id = p_pool
   RETURNING status INTO v_status;
  RETURN v_status;
END
$$;

REVOKE ALL ON FUNCTION app.pool_settle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pool_settle(uuid) TO fasal_app;
