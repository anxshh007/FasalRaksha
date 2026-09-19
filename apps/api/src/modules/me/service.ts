/**
 * GET /api/me — the signed-in account as its owner sees it. Read through row-level security as
 * the actor, so it can only ever return the actor's own rows. The phone number is returned
 * masked even to its owner: no screen needs the full number, so no response carries it.
 */
import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { maskPhone } from '../../security/phone.js';

export interface MeView {
  id: string;
  role: Actor['role'];
  displayName: string;
  district: string | null;
  village?: string | null;
  place?: string;
  locale?: string;
  phone: string | null;
  verification: { verified: boolean; method: string | null; last4: string | null; legalName?: string | null };
}

export async function getMe(db: Database, actor: Actor): Promise<MeView> {
  return withActor(db, actor, async (client) => {
    if (actor.role === 'farmer') {
      const { rows } = await client.query<{
        display_name: string;
        district: string | null;
        village: string | null;
        preferred_locale: string;
        verified_at: Date | null;
        phone_e164: string | null;
        registry: string | null;
        registry_id_last4: string | null;
      }>(
        `SELECT p.display_name, p.district, p.village, p.preferred_locale, p.verified_at, c.phone_e164, v.registry, v.registry_id_last4
           FROM app.farmer_profiles p
           LEFT JOIN app.farmer_contacts c ON c.user_id = p.user_id
           LEFT JOIN LATERAL (SELECT registry, registry_id_last4 FROM app.farmer_verifications WHERE user_id = p.user_id ORDER BY verified_at DESC LIMIT 1) v ON true
          WHERE p.user_id = $1`,
        [actor.userId],
      );
      const r = rows[0];
      if (r === undefined) throw new DomainError(404, 'PROFILE_MISSING', 'This account has no farmer profile.');
      return {
        id: actor.userId,
        role: actor.role,
        displayName: r.display_name,
        district: r.district,
        village: r.village,
        locale: r.preferred_locale,
        phone: r.phone_e164 === null ? null : maskPhone(r.phone_e164),
        verification: { verified: r.verified_at !== null, method: r.registry, last4: r.registry_id_last4 },
      };
    }
    if (actor.role === 'buyer') {
      const { rows } = await client.query<{
        business_name: string;
        place: string;
        district: string;
        phone_e164: string | null;
        method: string | null;
        identifier_last4: string | null;
        legal_name: string | null;
        status: string | null;
      }>(
        `SELECT p.business_name, p.place, p.district, c.phone_e164, v.method, v.identifier_last4, v.legal_name, v.status
           FROM app.buyer_profiles p
           LEFT JOIN app.buyer_contacts c ON c.user_id = p.user_id
           LEFT JOIN LATERAL (SELECT method, identifier_last4, legal_name, status FROM app.buyer_verifications WHERE user_id = p.user_id ORDER BY verified_at DESC LIMIT 1) v ON true
          WHERE p.user_id = $1`,
        [actor.userId],
      );
      const r = rows[0];
      if (r === undefined) throw new DomainError(404, 'PROFILE_MISSING', 'This account has no buyer profile.');
      return {
        id: actor.userId,
        role: actor.role,
        displayName: r.business_name,
        place: r.place,
        district: r.district,
        phone: r.phone_e164 === null ? null : maskPhone(r.phone_e164),
        verification: { verified: r.status === 'verified', method: r.method, last4: r.identifier_last4, legalName: r.legal_name },
      };
    }
    if (actor.role === 'fpo') {
      const { rows } = await client.query<{ name: string; district: string; phone_e164: string | null }>(
        'SELECT f.name, f.district, c.phone_e164 FROM app.fpos f LEFT JOIN app.fpo_contacts c ON c.user_id = f.user_id WHERE f.user_id = $1',
        [actor.userId],
      );
      const r = rows[0];
      if (r === undefined) throw new DomainError(404, 'PROFILE_MISSING', 'This account has no FPO profile.');
      return { id: actor.userId, role: actor.role, displayName: r.name, district: r.district, phone: r.phone_e164 === null ? null : maskPhone(r.phone_e164), verification: { verified: false, method: null, last4: null } };
    }
    const { rows } = await client.query<{ name: string; district: string; designation: string }>('SELECT name, district, designation FROM app.officer_profiles WHERE user_id = $1', [actor.userId]);
    const r = rows[0];
    if (r === undefined) throw new DomainError(404, 'PROFILE_MISSING', 'This account has no officer profile.');
    return { id: actor.userId, role: actor.role, displayName: `${r.name}, ${r.designation}`, district: r.district, phone: null, verification: { verified: true, method: 'appointment', last4: null } };
  });
}
