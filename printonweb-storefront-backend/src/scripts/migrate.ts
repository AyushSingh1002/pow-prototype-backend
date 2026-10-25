import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDatabasePool } from "../config/database";

async function runMigration(): Promise<void> {
  const migrationPath = resolve(
    process.cwd(),
    "prisma/migrations/20261024000000_production_core.sql"
  );
  const migration = await readFile(migrationPath, "utf8");
  const pool = getDatabasePool();
  try {
    await pool.query(migration);
    console.log("Production core schema migration completed.");
  } finally {
    await pool.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error("Database migration failed.");
  console.error(error instanceof Error ? error.message : "Unknown migration error.");
  process.exitCode = 1;
});
