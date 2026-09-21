/**
 * Cluster bootstrap: the two roles and the database, created once by a superuser.
 *
 *   fasal_owner — owns the schema; runs migrations; never used by the running API.
 *   fasal_app   — the API's login: NOSUPERUSER, NOBYPASSRLS, owns nothing, cannot create
 *                 roles or databases. Row-level security binds it (ARCH-03).
 *
 * Passwords are supplied by the caller (generated per environment) and never have defaults.
 * Everything here is idempotent: re-running re-asserts the attributes and rotates passwords.
 */
import pg from 'pg';

export const OWNER_ROLE = 'fasal_owner';
export const APP_ROLE = 'fasal_app';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface BootstrapOptions {
  database: string;
  ownerPassword: string;
  appPassword: string;
}

export interface BootstrapResult {
  ownerUrl: string;
  appUrl: string;
}

function urlFor(base: URL, user: string, password: string, database: string): string {
  const url = new URL(base.toString());
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${database}`;
  return url.toString();
}

async function ensureRole(client: pg.Client, role: string, password: string): Promise<void> {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (rowCount === 0) await client.query(`CREATE ROLE "${role}"`);
  // Utility statements cannot take bind parameters; the literal is escaped by the driver.
  await client.query(
    `ALTER ROLE "${role}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
  );
}

export async function bootstrapDatabase(superuserUrl: string, options: BootstrapOptions): Promise<BootstrapResult> {
  const { database } = options;
  if (!IDENTIFIER.test(database)) throw new Error(`"${database}" is not a safe database name.`);
  if (options.ownerPassword.length < 16 || options.appPassword.length < 16) {
    throw new Error('Database role passwords must be at least 16 characters.');
  }

  const base = new URL(superuserUrl);
  const admin = new pg.Client({ connectionString: superuserUrl, application_name: 'fasal-bootstrap' });
  await admin.connect();
  try {
    await ensureRole(admin, OWNER_ROLE, options.ownerPassword);
    await ensureRole(admin, APP_ROLE, options.appPassword);
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${database}" OWNER "${OWNER_ROLE}" ENCODING 'UTF8' TEMPLATE template0`);
    }
  } finally {
    await admin.end();
  }

  // Tighten the new database: nobody connects or creates by default; the app may connect.
  const inDb = new pg.Client({ connectionString: urlFor(base, decodeURIComponent(base.username), decodeURIComponent(base.password), database) });
  await inDb.connect();
  try {
    await inDb.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await inDb.query(`GRANT CONNECT ON DATABASE "${database}" TO "${APP_ROLE}"`);
    await inDb.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await inDb.query(`ALTER ROLE "${APP_ROLE}" IN DATABASE "${database}" SET search_path = app, public`);
  } finally {
    await inDb.end();
  }

  return {
    ownerUrl: urlFor(base, OWNER_ROLE, options.ownerPassword, database),
    appUrl: urlFor(base, APP_ROLE, options.appPassword, database),
  };
}

/**
 * The managed-database path: the instance and its database already exist and were handed to you
 * as one connection string, with no superuser and no second database to create. Everything
 * `bootstrapDatabase` does except `CREATE DATABASE` — the two roles, the grants they need, and
 * the extension the migrations expect — applied to the database the admin URL already names.
 *
 * The API still refuses to connect as the role the platform gave you (it owns the relations, so
 * row-level security would not bind it); this is what creates the role it will connect as.
 */
export async function provisionDatabase(adminUrl: string, options: Omit<BootstrapOptions, 'database'>): Promise<BootstrapResult> {
  if (options.ownerPassword.length < 16 || options.appPassword.length < 16) {
    throw new Error('Database role passwords must be at least 16 characters.');
  }
  const base = new URL(adminUrl);
  const database = decodeURIComponent(base.pathname.replace(/^\//, ''));
  if (!IDENTIFIER.test(database)) throw new Error(`The admin URL must name a database; "${database}" is not one.`);

  const admin = new pg.Client({ connectionString: adminUrl, application_name: 'fasal-provision' });
  await admin.connect();
  try {
    await ensureRole(admin, OWNER_ROLE, options.ownerPassword);
    await ensureRole(admin, APP_ROLE, options.appPassword);
    // The owner creates the schemas; the app only ever connects.
    await admin.query(`GRANT CONNECT, CREATE ON DATABASE "${database}" TO "${OWNER_ROLE}"`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO "${APP_ROLE}"`);
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await admin.query(`ALTER ROLE "${APP_ROLE}" IN DATABASE "${database}" SET search_path = app, public`);
    // Tightening, not correctness: a managed platform may not let its user revoke from PUBLIC,
    // and the policies still bind without it. Report it rather than failing the provision.
    for (const statement of [`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`, 'REVOKE CREATE ON SCHEMA public FROM PUBLIC']) {
      try {
        await admin.query(statement);
      } catch (error) {
        process.stderr.write(`  note: "${statement}" was refused (${(error as Error).message.trim()}). The policies still bind.\n`);
      }
    }
  } finally {
    await admin.end();
  }

  return {
    ownerUrl: urlFor(base, OWNER_ROLE, options.ownerPassword, database),
    appUrl: urlFor(base, APP_ROLE, options.appPassword, database),
  };
}

/**
 * Install (or rotate) the request-context key in the database, as the owner. Run after
 * migrations. The same key must be in the API's DB_CONTEXT_KEY; until it is installed, every
 * signed request fails closed.
 */
export async function installContextKey(ownerUrl: string, keyHex: string): Promise<void> {
  if (!/^[0-9a-f]{64,}$/i.test(keyHex)) throw new Error('The context key must be at least 32 bytes of hex.');
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'fasal-bootstrap' });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO app_private.context_key (id, key) VALUES (1, decode($1, 'hex')) ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key",
      [keyHex],
    );
  } finally {
    await client.end();
  }
}
