/**
 * Verification pointed at the risky side (PROMPT §8.3; P1-09).
 *
 * Buyers verify with GSTIN or Udyam before they can make an offer or be granted a farmer's
 * contact. Farmers verify with a PM-KISAN or AgriStack identifier — not as a barrier to using the
 * product, but because their verified name and district become their identity: every listing is
 * bound to it, and the parser's location fallback is that district (P1-04). All lookups run
 * here, server-side, through the registry adapters. Identifiers are stored only as keyed hashes
 * plus their last four characters.
 */
import type { BuyerRegistryAdapter, BusinessIdKind, FarmerRegistry, FarmerRegistryAdapter } from '../../adapters/registry/types.js';
import { isPlausibleFarmerId, isValidGstin, isValidUdyam } from '../../adapters/registry/types.js';
import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { hmacHex, type KeyRing } from '../../security/keys.js';

export interface VerifyDeps {
  db: Database;
  keys: KeyRing;
  farmers: FarmerRegistryAdapter;
  businesses: BuyerRegistryAdapter;
}

export interface FarmerVerification {
  name: string;
  district: string;
  village: string | null;
  registry: FarmerRegistry;
}

export async function verifyFarmer(deps: VerifyDeps, actor: Actor, registry: FarmerRegistry, rawId: string): Promise<FarmerVerification> {
  if (actor.role !== 'farmer') throw new DomainError(403, 'NOT_A_FARMER_ACCOUNT', 'Farmer identifiers are verified on farmer accounts.');
  const id = rawId.trim().toUpperCase();
  if (!isPlausibleFarmerId(registry, id)) {
    throw new DomainError(422, 'FARMER_ID_NOT_VALID', registry === 'pm-kisan' ? 'A PM-KISAN registration looks like PMK-MH-2003-11427.' : 'An AgriStack farmer ID is 11 digits.');
  }
  const record = await deps.farmers.lookup(registry, id);
  if (record === null) {
    throw new DomainError(404, 'FARMER_ID_NOT_FOUND', 'This Farmer ID was not found in government farmer records. Double-check the ID or contact your local agriculture office.');
  }
  await withActor(deps.db, actor, async (client) => {
    await client.query('SELECT app.record_farmer_verification($1, $2, $3, $4, $5, $6)', [
      registry,
      hmacHex(deps.keys.key('registry-id'), `${registry}|${id}`),
      id.slice(-4),
      record.name,
      record.district,
      deps.farmers.mode,
    ]);
    await client.query(
      "INSERT INTO app.audit_log (actor_id, actor_role, action, target_type, target_id, context) VALUES ($1::uuid, 'farmer', 'verification.farmer', 'user', $1::text, $2)",
      [actor.userId, { registry, last4: id.slice(-4), district: record.district, mode: deps.farmers.mode }],
    );
    if (record.village !== null) await client.query('UPDATE app.farmer_profiles SET village = $2 WHERE user_id = $1', [actor.userId, record.village]);
  });
  return { name: record.name, district: record.district, village: record.village, registry };
}

export interface BuyerVerification {
  legalName: string;
  status: 'verified' | 'rejected';
  method: BusinessIdKind;
}

export async function verifyBuyer(deps: VerifyDeps, actor: Actor, method: BusinessIdKind, rawId: string): Promise<BuyerVerification> {
  if (actor.role !== 'buyer') throw new DomainError(403, 'NOT_A_BUYER_ACCOUNT', 'Business identifiers are verified on buyer accounts.');
  const id = rawId.trim().toUpperCase();
  if (method === 'gstin' ? !isValidGstin(id) : !isValidUdyam(id)) {
    throw new DomainError(
      422,
      'BUSINESS_ID_NOT_VALID',
      method === 'gstin' ? 'That GSTIN is not valid — check the 15 characters, including the last one.' : 'A Udyam number looks like UDYAM-MH-26-0012345.',
    );
  }
  const record = await deps.businesses.lookup(method, id);
  if (record === null) throw new DomainError(404, 'BUSINESS_NOT_FOUND', 'This business identifier was not found in the registry.');
  const status = record.status === 'active' ? 'verified' : 'rejected';
  await withActor(deps.db, actor, async (client) => {
    await client.query('SELECT app.record_buyer_verification($1, $2, $3, $4, $5, $6)', [
      method,
      hmacHex(deps.keys.key('registry-id'), `${method}|${id}`),
      id.slice(-4),
      record.legalName,
      status,
      deps.businesses.mode,
    ]);
    await client.query(
      "INSERT INTO app.audit_log (actor_id, actor_role, action, target_type, target_id, context) VALUES ($1::uuid, 'buyer', 'verification.buyer', 'user', $1::text, $2)",
      [actor.userId, { method, last4: id.slice(-4), status, mode: deps.businesses.mode }],
    );
  });
  if (status === 'rejected') {
    throw new DomainError(422, 'BUSINESS_NOT_ACTIVE', `This registration is ${record.status}. Only an active registration can make offers to farmers.`);
  }
  return { legalName: record.legalName, status, method };
}
