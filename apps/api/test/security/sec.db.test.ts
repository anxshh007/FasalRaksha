/**
 * Gate B — the adversarial database suite (PROMPT §8.7). Every attack runs as the application
 * role against a real PostgreSQL server, either with a legitimately signed identity trying to
 * reach someone else's data, or with the API bypassed entirely and an identity forged at the
 * database. All must fail to bypass. SEC-09, SEC-13 and SEC-14 — which the API refuses before
 * the database is reached — are in sec-app.test.ts.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contextSignature, withActor, type Actor, type Database } from '../../src/db/actor.js';
import { createPool, type Pool, type PoolClient } from '../../src/db/pool.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from '../support/cluster.js';
import { seedDeals, seedGrants, seedWorld, type SeededWorld } from '../support/seed.js';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let appDb: Database;
let w: SeededWorld;

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  w = await seedWorld(db.seedUrl);
  pool = createPool(db.appUrl, { max: 4 });
  appDb = { pool, contextKey: db.contextKey };
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

const farmer = (id: string): Actor => ({ userId: id, role: 'farmer' });
const buyer = (id: string): Actor => ({ userId: id, role: 'buyer' });
const as = <T>(actor: Actor, work: (c: PoolClient) => Promise<T>): Promise<T> => withActor(appDb, actor, work);

/** A raw connection with the API bypassed: set whatever identity you like, sign it however you can. */
async function bypassingApi<T>(settings: { uid: string; role: string; sig?: string }, work: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true), set_config('app.context_sig', $3, true)", [
      settings.uid,
      settings.role,
      settings.sig ?? '',
    ]);
    return await work(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describe('SEC-01 · P1-08 · cross-tenant read of another farmer’s contact row (contacts live apart from profiles)', () => {
  it('another farmer reads nothing, by id or by scan', async () => {
    const rows = await as(farmer(w.farmerB), async (c) => {
      const byId = await c.query('SELECT phone_e164 FROM app.farmer_contacts WHERE user_id = $1', [w.farmerA]);
      const all = await c.query<{ user_id: string }>('SELECT user_id FROM app.farmer_contacts');
      return { byId: byId.rows, all: all.rows.map((r) => r.user_id) };
    });
    expect(rows.byId).toEqual([]);
    expect(rows.all).toEqual([w.farmerB]);
  });

  it('a verified buyer with an acknowledged offer still never reads the raw number', async () => {
    await as(farmer(w.farmerA), (c) => c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'acknowledged offer')", [w.dealOffered, w.farmerA, w.buyerVerified]));
    const seen = await as(buyer(w.buyerVerified), async (c) => ({
      contacts: (await c.query('SELECT * FROM app.farmer_contacts WHERE user_id = $1', [w.farmerA])).rows,
      grants: (await c.query<{ relay_handle: string }>('SELECT relay_handle FROM app.contact_grants WHERE deal_id = $1', [w.dealOffered])).rows,
    }));
    expect(seen.contacts).toEqual([]);
    expect(seen.grants).toHaveLength(1);
    expect(seen.grants[0]?.relay_handle).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('SEC-02 · cross-tenant write to another farmer’s listing', () => {
  it('an update aimed at another farmer’s listing changes nothing', async () => {
    const result = await as(farmer(w.farmerB), (c) => c.query('UPDATE app.listings SET qty = 1 WHERE id = $1', [w.listingA]));
    expect(result.rowCount).toBe(0);
    const check = new pg.Client({ connectionString: db.seedUrl });
    await check.connect();
    const { rows } = await check.query<{ qty: string }>('SELECT qty FROM app.listings WHERE id = $1', [w.listingA]);
    await check.end();
    expect(Number(rows[0]?.qty)).toBe(5);
  });

  it('a listing cannot be created in another farmer’s name', async () => {
    await expect(
      as(farmer(w.farmerB), (c) =>
        c.query("INSERT INTO app.listings (client_id, farmer_id, crop, qty, qty_unit, district, available_from, available_until) VALUES ('forged-listing-1', $1, 'onion', 5, 'quintal', 'nashik', '2026-09-06', '2026-09-10')", [w.farmerA]),
      ),
    ).rejects.toThrow(/only be created in your own name/);
  });

  it('a farmer cannot hand their own listing to someone else', async () => {
    await expect(as(farmer(w.farmerB), (c) => c.query('UPDATE app.listings SET farmer_id = $1 WHERE id = $2', [w.farmerA, w.listingB]))).rejects.toThrow(
      /row-level security|cannot change hands/,
    );
  });

  it('the listing’s district always comes from the verified record, whatever the client sends (P1-04)', async () => {
    const district = await as(farmer(w.farmerB), async (c) => {
      const { rows } = await c.query<{ district: string }>(
        "INSERT INTO app.listings (client_id, farmer_id, crop, qty, qty_unit, district, available_from, available_until) VALUES ('own-listing-01', $1, 'onion', 5, 'quintal', 'latur', '2026-09-06', '2026-09-10') RETURNING district",
        [w.farmerB],
      );
      return rows[0]?.district;
    });
    expect(district).toBe('nashik');
  });
});

describe('SEC-03 · ARCH-03 · forged farmer_id at the DB layer, API bypassed', () => {
  it('an unsigned identity is refused outright', async () => {
    await expect(bypassingApi({ uid: w.farmerA, role: 'farmer' }, (c) => c.query('SELECT * FROM app.farmer_contacts'))).rejects.toThrow(/signature is invalid/);
  });

  it('a signature replayed from another transaction is refused', async () => {
    const captured = await as(farmer(w.farmerA), async (c) => (await c.query<{ sig: string }>("SELECT current_setting('app.context_sig') AS sig")).rows[0]?.sig ?? '');
    await expect(bypassingApi({ uid: w.farmerA, role: 'farmer', sig: captured }, (c) => c.query('SELECT * FROM app.farmer_contacts'))).rejects.toThrow(
      /signature is invalid/,
    );
  });

  it('a signature for one farmer cannot carry another farmer’s id', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const xid = (await client.query<{ x: string }>('SELECT pg_current_xact_id()::text AS x')).rows[0]?.x ?? '';
      const sigForB = contextSignature(db.contextKey, farmer(w.farmerB), xid);
      await client.query("SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'farmer', true), set_config('app.context_sig', $2, true)", [
        w.farmerA,
        sigForB,
      ]);
      await expect(client.query('SELECT * FROM app.farmer_contacts')).rejects.toThrow(/signature is invalid/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('a forged farmer_id in the data itself is refused even with a valid session', async () => {
    await expect(
      as(farmer(w.farmerB), (c) => c.query("INSERT INTO app.farmer_contacts (user_id, phone_e164) VALUES ($1, '+919999999999')", [w.farmerA])),
    ).rejects.toThrow(/row-level security|duplicate/);
  });

  it('with no identity at all, nothing private is visible', async () => {
    const client = await pool.connect();
    try {
      const contacts = await client.query('SELECT * FROM app.farmer_contacts');
      const listings = await client.query('SELECT * FROM app.listings');
      expect(contacts.rows).toEqual([]);
      expect(listings.rows).toEqual([]);
    } finally {
      client.release();
    }
  });
});

describe('SEC-04 · forged buyer_id at the DB layer', () => {
  it('another buyer cannot modify this buyer’s requirement', async () => {
    const result = await as(buyer(w.buyerVerified2), (c) => c.query('UPDATE app.buyer_requirements SET price = 1 WHERE id = $1', [w.requirementV]));
    expect(result.rowCount).toBe(0);
  });

  it('a requirement cannot be posted under another buyer’s id', async () => {
    await expect(
      as(buyer(w.buyerVerified2), (c) =>
        c.query(
          "INSERT INTO app.buyer_requirements (buyer_id, crop, min_qty, min_qty_unit, max_qty, max_qty_unit, price, price_unit, district, location_lat, location_lon, radius_km, valid_from, valid_until) VALUES ($1, 'onion', 1, 'quintal', 5, 'quintal', 100, 'quintal', 'nashik', 20, 74, 10, '2026-09-01', '2026-09-30')",
          [w.buyerVerified],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a forged buyer identity with the API bypassed is refused', async () => {
    await expect(
      bypassingApi({ uid: w.buyerVerified, role: 'buyer', sig: 'f'.repeat(64) }, (c) => c.query('UPDATE app.buyer_requirements SET price = 1 WHERE id = $1', [w.requirementV])),
    ).rejects.toThrow(/signature is invalid/);
  });
});

describe('SEC-05 · P1-09 · an unverified buyer attempts an offer', () => {
  it('cannot open a deal', async () => {
    await expect(
      as(buyer(w.buyerUnverified), (c) =>
        c.query(
          "INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by) VALUES ($1, $2, 'farmer', $3, 'nashik', 'OFFERED', 2100, 'quintal', 5, 'quintal', 'buyer')",
          [w.listingB, w.farmerB, w.buyerUnverified],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the same offer from a verified buyer is accepted by the database (control)', async () => {
    const opened = await as(buyer(w.buyerVerified2), (c) =>
      c.query(
        "INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by) VALUES ($1, $2, 'farmer', $3, 'nashik', 'OFFERED', 2100, 'quintal', 5, 'quintal', 'buyer')",
        [w.listingB, w.farmerB, w.buyerVerified2],
      ),
    );
    expect(opened.rowCount).toBe(1);
  });

  it('cannot open a deal on a listing with a seller who does not own it', async () => {
    await expect(
      as(buyer(w.buyerVerified2), (c) =>
        c.query(
          "INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by) VALUES ($1, $2, 'farmer', $3, 'nashik', 'OFFERED', 2100, 'quintal', 5, 'quintal', 'buyer')",
          [w.listingB, w.farmerA, w.buyerVerified2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('SEC-06 · contact grant without farmer acknowledgement', () => {
  it('a buyer cannot grant themselves a farmer’s contact', async () => {
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'self-granted')", [w.dealSlip, w.farmerA, w.buyerVerified])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a farmer cannot grant a contact on a deal they are not party to', async () => {
    await expect(
      as(farmer(w.farmerB), (c) => c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'not mine')", [w.dealSlip, w.farmerB, w.buyerVerified])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a grant can never go to an unverified buyer', async () => {
    await expect(
      as(farmer(w.farmerA), (c) => c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'unverified')", [w.dealSlip, w.farmerA, w.buyerUnverified])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('SEC-07 · contact grant exceeding the per-buyer daily rate limit', () => {
  it('the 21st contact for one buyer in 24 hours is refused', async () => {
    const deals = await seedDeals(db.seedUrl, w.listingA, w.farmerA, w.buyerVerified2, 21);
    await seedGrants(db.seedUrl, deals.slice(0, 20), w.farmerA, w.buyerVerified2);
    const last = deals[20];
    await expect(
      as(farmer(w.farmerA), (c) => c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'acknowledged offer')", [last, w.farmerA, w.buyerVerified2])),
    ).rejects.toThrow(/today's limit/);
  });
});

describe('SEC-08 · a buyer approving its own offer', () => {
  it('the buyer who named the price cannot accept it', async () => {
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query("UPDATE app.deals SET state = 'ACCEPTED', version = version + 1 WHERE id = $1", [w.dealOffered])),
    ).rejects.toThrow(/cannot accept a price you named/);
  });

  it('nor counter its own price to itself', async () => {
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query("UPDATE app.deals SET state = 'COUNTERED', price = 1900, version = version + 1 WHERE id = $1", [w.dealOffered])),
    ).rejects.toThrow(/terms change only by a counter-offer/);
  });

  it('nor confirm payment, or delivery for the seller', async () => {
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query("UPDATE app.deals SET state = 'PAYMENT_CONFIRMED', version = version + 1 WHERE id = $1", [w.dealDelivered])),
    ).rejects.toThrow(/only the seller confirms/);
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query('UPDATE app.deals SET delivery_seller = true, version = version + 1 WHERE id = $1', [w.dealSlip])),
    ).rejects.toThrow(/other side/);
  });

  it('the farmer, who did not name the price, can accept it (control)', async () => {
    const accepted = await as(farmer(w.farmerA), (c) => c.query("UPDATE app.deals SET state = 'ACCEPTED', version = version + 1 WHERE id = $1", [w.dealOffered]));
    expect(accepted.rowCount).toBe(1);
  });
});

describe('SEC-10 · rating a deal that never completed', () => {
  it('a rating before payment is confirmed is refused', async () => {
    await expect(
      as(farmer(w.farmerA), (c) => c.query('INSERT INTO app.ratings (deal_id, rater_id, ratee_id, payment_timeliness) VALUES ($1, $2, $3, 5)', [w.dealSlip, w.farmerA, w.buyerVerified])),
    ).rejects.toThrow(/row-level security/);
  });

  it('on a completed deal the rating is accepted once, and only once (control)', async () => {
    const first = await as(farmer(w.farmerA), (c) => c.query('INSERT INTO app.ratings (deal_id, rater_id, ratee_id, payment_timeliness) VALUES ($1, $2, $3, 4)', [w.dealPaid, w.farmerA, w.buyerVerified]));
    expect(first.rowCount).toBe(1);
    await expect(
      as(farmer(w.farmerA), (c) => c.query('INSERT INTO app.ratings (deal_id, rater_id, ratee_id, payment_timeliness) VALUES ($1, $2, $3, 5)', [w.dealPaid, w.farmerA, w.buyerVerified])),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe('SEC-11 · a dispute raised before DELIVERY_CONFIRMED', () => {
  it('is refused before delivery', async () => {
    await expect(
      as(farmer(w.farmerA), (c) =>
        c.query("INSERT INTO app.disputes (deal_id, raised_by, raised_by_party, reason, note, district) VALUES ($1, $2, 'seller', 'GRADE_DISPUTE', 'too early', 'x')", [w.dealSlip, w.farmerA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('is accepted after delivery, routed to the deal’s district (control)', async () => {
    const district = await as(farmer(w.farmerA), async (c) => {
      const { rows } = await c.query<{ district: string }>(
        "INSERT INTO app.disputes (deal_id, raised_by, raised_by_party, reason, note, district) VALUES ($1, $2, 'seller', 'GRADE_DISPUTE', 'Re-graded to C at the yard', 'latur') RETURNING district",
        [w.dealDelivered, w.farmerA],
      );
      return rows[0]?.district;
    });
    expect(district).toBe('nashik');
  });

  it('only the district officer of that district may review it', async () => {
    const officer = (id: string): Actor => ({ userId: id, role: 'officer' });
    const other = await as(officer(w.officerLatur), (c) => c.query("UPDATE app.disputes SET state = 'UNDER_REVIEW' WHERE deal_id = $1", [w.dealDelivered]));
    expect(other.rowCount).toBe(0);
    const own = await as(officer(w.officerNashik), (c) => c.query("UPDATE app.disputes SET state = 'UNDER_REVIEW' WHERE deal_id = $1", [w.dealDelivered]));
    expect(own.rowCount).toBe(1);
  });
});

describe('SEC-12 · direct edit of a counterparty’s reputation', () => {
  it('the rated buyer cannot edit a rating about themselves', async () => {
    await expect(as(buyer(w.buyerVerified), (c) => c.query('UPDATE app.ratings SET payment_timeliness = 5 WHERE ratee_id = $1', [w.buyerVerified]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('nor delete it', async () => {
    await expect(as(buyer(w.buyerVerified), (c) => c.query('DELETE FROM app.ratings WHERE ratee_id = $1', [w.buyerVerified]))).rejects.toThrow(/permission denied/);
  });

  it('nor rate themselves', async () => {
    await expect(
      as(buyer(w.buyerVerified), (c) => c.query('INSERT INTO app.ratings (deal_id, rater_id, ratee_id, payment_timeliness) VALUES ($1, $2, $2, 5)', [w.dealPaid, w.buyerVerified])),
    ).rejects.toThrow(/row-level security|ratings_not_self/);
  });

  it('nor rewrite the payment record reputation is computed from', async () => {
    await expect(as(buyer(w.buyerVerified), (c) => c.query('UPDATE app.payments SET days_after_delivery = 0'))).rejects.toThrow(/permission denied/);
  });

  it('the audit trail itself is append-only, even for its owner', async () => {
    const owner = new pg.Client({ connectionString: db.ownerUrl });
    await owner.connect();
    try {
      await owner.query("INSERT INTO app.audit_log (action, target_type) VALUES ('test.event', 'test')");
      await expect(owner.query('DELETE FROM app.audit_log')).rejects.toThrow(/append-only/);
      await expect(owner.query("UPDATE app.audit_log SET action = 'rewritten'")).rejects.toThrow(/append-only/);
    } finally {
      await owner.end();
    }
  });
});
