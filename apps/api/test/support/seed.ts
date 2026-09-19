/**
 * Test seeding. Runs as the cluster superuser against a throwaway database — which bypasses
 * row-level security by design, exactly like an operator's data load. The attacks in the
 * security suite then run as the application role, through the policies.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';

export interface SeededWorld {
  farmerA: string;
  farmerB: string;
  buyerVerified: string;
  buyerVerified2: string;
  buyerUnverified: string;
  fpo: string;
  officerNashik: string;
  officerLatur: string;
  listingA: string;
  listingB: string;
  requirementV: string;
  dealOffered: string;
  dealSlip: string;
  dealDelivered: string;
  dealPaid: string;
}

export async function seedWorld(seedUrl: string): Promise<SeededWorld> {
  const c = new pg.Client({ connectionString: seedUrl });
  await c.connect();
  try {
    const user = async (kind: string): Promise<string> => {
      const id = randomUUID();
      await c.query('INSERT INTO app.users (id, kind) VALUES ($1, $2)', [id, kind]);
      return id;
    };
    const farmer = async (name: string, district: string, phone: string): Promise<string> => {
      const id = await user('farmer');
      await c.query('INSERT INTO app.farmer_profiles (user_id, display_name, district, verified_at) VALUES ($1, $2, $3, now())', [id, name, district]);
      await c.query('INSERT INTO app.farmer_contacts (user_id, phone_e164) VALUES ($1, $2)', [id, phone]);
      await c.query(
        "INSERT INTO app.farmer_verifications (user_id, registry, registry_id_hash, registry_id_last4, verified_name, verified_district, adapter_mode) VALUES ($1, 'pm-kisan', $2, '1427', $3, $4, 'mock')",
        [id, `hash-${id}`, name, district],
      );
      return id;
    };
    const buyer = async (name: string, verified: boolean, phone: string): Promise<string> => {
      const id = await user('buyer');
      await c.query("INSERT INTO app.buyer_profiles (user_id, business_name, place, district) VALUES ($1, $2, 'Lasalgaon', 'nashik')", [id, name]);
      await c.query('INSERT INTO app.buyer_contacts (user_id, phone_e164) VALUES ($1, $2)', [id, phone]);
      if (verified) {
        await c.query(
          "INSERT INTO app.buyer_verifications (user_id, method, identifier_hash, identifier_last4, legal_name, status, adapter_mode) VALUES ($1, 'gstin', $2, '1Z5', $3, 'verified', 'mock')",
          [id, `hash-${id}`, name],
        );
      }
      return id;
    };
    const listing = async (farmerId: string): Promise<string> => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.listings (client_id, farmer_id, crop, qty, qty_unit, district, available_from, available_until, pool_opt_in)
         VALUES ($1, $2, 'onion', 5, 'quintal', 'ignored-by-trigger', '2026-09-05', '2026-09-20', true) RETURNING id`,
        [`client-${randomUUID()}`, farmerId],
      );
      return rows[0]?.id ?? '';
    };
    const deal = async (listingId: string, sellerId: string, buyerId: string, state: string, extra: Record<string, boolean> = {}): Promise<string> => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by,
                                delivery_seller, delivery_buyer)
         VALUES ($1, $2, 'farmer', $3, 'nashik', $4, 1950, 'quintal', 5, 'quintal', 'buyer', $5, $6) RETURNING id`,
        [listingId, sellerId, buyerId, state, extra['delivered'] ?? false, extra['delivered'] ?? false],
      );
      return rows[0]?.id ?? '';
    };

    const farmerA = await farmer('Sunil Ramrao Bhosale', 'nashik', '+919876543210');
    const farmerB = await farmer('Sangita Dnyaneshwar Kadam', 'nashik', '+919812345678');
    const buyerVerified = await buyer('Godavari Agro Traders', true, '+919820000001');
    const buyerVerified2 = await buyer('Deccan Exports', true, '+919820000002');
    const buyerUnverified = await buyer('Unverified Commission Agent', false, '+919820000099');
    const fpo = await user('fpo');
    await c.query("INSERT INTO app.fpos (user_id, name, district, location_lat, location_lon) VALUES ($1, 'Sahyadri Farmer Producer Company', 'nashik', 20.12, 74.18)", [fpo]);
    const officerNashik = await user('officer');
    await c.query("INSERT INTO app.officer_profiles (user_id, name, designation, district) VALUES ($1, 'S. Deshmukh', 'District Agriculture Officer', 'nashik')", [officerNashik]);
    const officerLatur = await user('officer');
    await c.query("INSERT INTO app.officer_profiles (user_id, name, designation, district) VALUES ($1, 'R. Kulkarni', 'District Agriculture Officer', 'latur')", [officerLatur]);

    const listingA = await listing(farmerA);
    const listingB = await listing(farmerB);
    const { rows: req } = await c.query<{ id: string }>(
      `INSERT INTO app.buyer_requirements (buyer_id, crop, min_qty, min_qty_unit, max_qty, max_qty_unit, price, price_unit, district, location_lat, location_lon, radius_km, valid_from, valid_until)
       VALUES ($1, 'onion', 1, 'quintal', 50, 'quintal', 1950, 'quintal', 'nashik', 20.1497, 74.233, 60, '2026-09-01', '2026-09-30') RETURNING id`,
      [buyerVerified],
    );

    return {
      farmerA,
      farmerB,
      buyerVerified,
      buyerVerified2,
      buyerUnverified,
      fpo,
      officerNashik,
      officerLatur,
      listingA,
      listingB,
      requirementV: req[0]?.id ?? '',
      dealOffered: await deal(listingA, farmerA, buyerVerified, 'OFFERED'),
      dealSlip: await deal(listingA, farmerA, buyerVerified, 'SAUDA_SLIP'),
      dealDelivered: await deal(listingA, farmerA, buyerVerified, 'DELIVERY_CONFIRMED', { delivered: true }),
      dealPaid: await deal(listingA, farmerA, buyerVerified, 'PAYMENT_CONFIRMED', { delivered: true }),
    };
  } finally {
    await c.end();
  }
}

/** Extra deals between a farmer and a buyer, for the contact-grant rate-limit test. */
export async function seedDeals(seedUrl: string, listingId: string, sellerId: string, buyerId: string, count: number): Promise<string[]> {
  const c = new pg.Client({ connectionString: seedUrl });
  await c.connect();
  try {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by)
         VALUES ($1, $2, 'farmer', $3, 'nashik', 'OFFERED', 1950, 'quintal', 5, 'quintal', 'buyer') RETURNING id`,
        [listingId, sellerId, buyerId],
      );
      ids.push(rows[0]?.id ?? '');
    }
    return ids;
  } finally {
    await c.end();
  }
}

/** Grant contacts directly (as an operator would backfill), bypassing policies but not the rate-limit trigger. */
export async function seedGrants(seedUrl: string, dealIds: readonly string[], farmerId: string, buyerId: string): Promise<void> {
  const c = new pg.Client({ connectionString: seedUrl });
  await c.connect();
  try {
    for (const dealId of dealIds) {
      await c.query("INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, 'seeded acknowledgement')", [dealId, farmerId, buyerId]);
    }
  } finally {
    await c.end();
  }
}
