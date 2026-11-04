import assert from "node:assert/strict";
import test from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";

test("migration order is stable, SQL-only, and keyed by filename", () => {
  const pending = pendingMigrations(
    ["0003_scores.sql", "notes.md", "0002_forca.sql"],
    ["0002_forca.sql"],
  );
  assert.deepEqual(pending, [{ name: "0003_scores.sql", path: "0003_scores.sql" }]);
  assert.equal(isMigrationFile("README.md"), false);
  assert.equal(migrationName("/migrations/0003_scores.sql"), "0003_scores.sql");
});
