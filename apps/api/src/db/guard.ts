/**
 * ARCH-03 · the API refuses to run with more database privilege than it needs.
 *
 * Row-level security is only a boundary if the connecting role cannot step around it. A
 * superuser bypasses RLS; so does any role with BYPASSRLS; so does a table's owner unless the
 * table forces RLS. A misconfigured `DATABASE_URL` pointing at any of those would leave every
 * policy in place and none of them enforced — silently. This check makes that loud, at boot.
 */
import type { Pool } from './pool.js';

export interface PrivilegeReport {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDb: boolean;
  ownedRelations: number;
}

export class PrivilegeError extends Error {
  readonly report: PrivilegeReport;

  constructor(report: PrivilegeReport, problems: readonly string[]) {
    super(
      `The API is connected to PostgreSQL as "${report.role}", which is not a least-privilege role: ${problems.join('; ')}. ` +
        'Point DATABASE_URL at the application role (fasal_app).',
    );
    this.name = 'PrivilegeError';
    this.report = report;
  }
}

export async function inspectPrivileges(pool: Pool): Promise<PrivilegeReport> {
  const { rows } = await pool.query<{
    role: string;
    superuser: boolean;
    bypass_rls: boolean;
    create_role: boolean;
    create_db: boolean;
    owned_relations: string;
  }>(
    `SELECT r.rolname AS role,
            r.rolsuper AS superuser,
            r.rolbypassrls AS bypass_rls,
            r.rolcreaterole AS create_role,
            r.rolcreatedb AS create_db,
            (SELECT count(*) FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relowner = r.oid
                AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND n.nspname NOT LIKE 'pg_toast%') AS owned_relations
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('PostgreSQL did not report the connected role.');
  return {
    role: row.role,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    createRole: row.create_role,
    createDb: row.create_db,
    ownedRelations: Number(row.owned_relations),
  };
}

/** Throws `PrivilegeError` unless the connected role is least-privilege. */
export async function assertLeastPrivilege(pool: Pool): Promise<PrivilegeReport> {
  const report = await inspectPrivileges(pool);
  const problems: string[] = [];
  if (report.superuser) problems.push('it is a superuser');
  if (report.bypassRls) problems.push('it has BYPASSRLS');
  if (report.createRole) problems.push('it can create roles');
  if (report.createDb) problems.push('it can create databases');
  if (report.ownedRelations > 0) problems.push(`it owns ${report.ownedRelations} relation(s), and owners bypass row-level security`);
  if (problems.length > 0) throw new PrivilegeError(report, problems);
  return report;
}
