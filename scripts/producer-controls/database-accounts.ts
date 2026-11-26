/**
 * "Create database accounts" (#107 setup step 3).
 *
 * Postgres.app lets the Mac's own user administer the local server without a
 * password. VERA uses that once to create the two least-privileged accounts
 * from the runbook, with passwords it generates, and writes the resulting
 * URLs straight into the private settings file. The Producer never sees or
 * types a password.
 *
 * - `vera_pilot`: owns the `vera_pilot` database. No superuser, no CREATEDB,
 *   no CREATEROLE.
 * - `vera_drill`: CREATEDB only, for recovery tests in throwaway databases.
 *
 * Safe to press again: when the settings file already holds working
 * credentials nothing changes; otherwise only the two VERA accounts get new
 * passwords. It never touches other roles or databases, never drops anything,
 * and refuses if the `vera_pilot` database belongs to someone else.
 */
import { randomBytes } from "node:crypto";

export const PILOT_ROLE = "vera_pilot";
export const DRILL_ROLE = "vera_drill";
export const PILOT_DATABASE = "vera_pilot";

export type Query = (
  sql: string,
  params?: unknown[],
) => Promise<Array<Record<string, unknown>>>;

export type AccountDeps = {
  /** Runs as the Postgres.app administrator (the Mac's own user). */
  admin: Query;
  /** Tries a login with a candidate URL; true when `SELECT 1` works. */
  canLogin: (url: string) => Promise<boolean>;
  host: string;
  port: number;
  password?: () => string;
};

export type AccountResult = {
  changed: boolean;
  message: string;
  /** New values for the settings file, when anything changed. */
  settings?: { PILOT_PG_URL: string; PILOT_DRILL_PG_URL: string };
};

export class DatabaseAccountError extends Error {}

const url = (
  role: string,
  password: string,
  host: string,
  port: number,
  database: string,
) =>
  `postgresql://${role}:${encodeURIComponent(password)}@${host}:${port}/${database}`;

/** Usable when the URL names our role and its password isn't a placeholder. */
export function configuredUrl(
  value: string | undefined,
  role?: string,
): boolean {
  if (!value || value.includes("CHANGE_ME")) return false;
  try {
    const parsed = new URL(value);
    return (
      (!role || parsed.username === role) &&
      parsed.username.length > 0 &&
      parsed.password.length > 0
    );
  } catch {
    return false;
  }
}

export async function createDatabaseAccounts(
  current: { pilotUrl?: string; drillUrl?: string },
  deps: AccountDeps,
): Promise<AccountResult> {
  if (
    configuredUrl(current.pilotUrl, PILOT_ROLE) &&
    configuredUrl(current.drillUrl, DRILL_ROLE) &&
    (await deps.canLogin(current.pilotUrl!)) &&
    (await deps.canLogin(current.drillUrl!))
  )
    return {
      changed: false,
      message: "Both database accounts already work. Nothing changed.",
    };

  const [me] = await deps.admin(
    "SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  if (!me?.rolsuper)
    throw new DatabaseAccountError(
      "This Mac's PostgreSQL user can't create accounts. Use Postgres.app's own server, or ask for help (runbook setup step 2).",
    );

  const owner = await deps.admin(
    "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
    [PILOT_DATABASE],
  );
  if (owner[0] && owner[0].owner !== PILOT_ROLE)
    throw new DatabaseAccountError(
      `A database named ${PILOT_DATABASE} already exists and belongs to someone else. VERA left it alone; ask for help.`,
    );

  const make = deps.password ?? (() => randomBytes(24).toString("base64url"));
  const pilotPassword = make();
  const drillPassword = make();
  const roles = [
    [PILOT_ROLE, pilotPassword, "NOSUPERUSER NOCREATEDB NOCREATEROLE"],
    [DRILL_ROLE, drillPassword, "NOSUPERUSER CREATEDB NOCREATEROLE"],
  ] as const;
  for (const [role, password, rights] of roles) {
    const exists = await deps.admin(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [role],
    );
    // format() quotes the name and password; neither is spliced in by hand.
    const [statement] = await deps.admin(
      `SELECT format('${exists.length ? "ALTER" : "CREATE"} ROLE %I WITH LOGIN ${rights} PASSWORD %L', $1::text, $2::text) AS sql`,
      [role, password],
    );
    await deps.admin(String(statement!.sql));
  }
  if (!owner[0]) {
    const [statement] = await deps.admin(
      "SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $2::text) AS sql",
      [PILOT_DATABASE, PILOT_ROLE],
    );
    await deps.admin(String(statement!.sql));
  }

  const settings = {
    PILOT_PG_URL: url(
      PILOT_ROLE,
      pilotPassword,
      deps.host,
      deps.port,
      PILOT_DATABASE,
    ),
    PILOT_DRILL_PG_URL: url(
      DRILL_ROLE,
      drillPassword,
      deps.host,
      deps.port,
      "postgres",
    ),
  };
  for (const [name, value] of Object.entries(settings))
    if (!(await deps.canLogin(value)))
      throw new DatabaseAccountError(
        `The new ${name === "PILOT_PG_URL" ? PILOT_ROLE : DRILL_ROLE} account couldn't sign in. Check that Postgres.app is running, then try again.`,
      );
  return {
    changed: true,
    message: `Set up the ${PILOT_ROLE} and ${DRILL_ROLE} accounts${owner[0] ? "" : ` and the ${PILOT_DATABASE} database`}, and saved their passwords in the settings file.`,
    settings,
  };
}
