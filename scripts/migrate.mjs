#!/usr/bin/env node
/**
 * Startup-time database migrator (node-postgres, `pg`).
 *
 * Runs before the web server starts, when Render's private network is available.
 * Each file is applied in one transaction and recorded in `_migrations`, so it
 * runs once and is safe to re-run.
 *
 * The read is non-recursive, so only this game's schema is applied.
 *
 * No DATABASE_URL in production is a hard failure. Local development can skip;
 * PGLite applies the same files on its own (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[migrate] DATABASE_URL is required in production. Link the Render PostgreSQL database to this web service.",
    );
    process.exit(1);
  }
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const migrationLock = [1481465683, 1];

async function main() {
  const entries = await readdir(migrationsDir);
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", migrationLock);
    lockAcquired = true;
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1, $2)", migrationLock);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
