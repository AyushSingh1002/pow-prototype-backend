import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDatabasePool } from "../config/database";

async function runMigration(): Promise<void> {
  const migrationDirectory = resolve(process.cwd(), "prisma/migrations");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const pool = getDatabasePool();
  try {
    for (const migrationFile of migrationFiles) {
      const migration = await readFile(resolve(migrationDirectory, migrationFile), "utf8");
      await pool.query(migration);
      console.log(`Database migration completed: ${migrationFile}`);
    }
  } finally {
    await pool.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error("Database migration failed.");
  console.error(error instanceof Error ? error.message : "Unknown migration error.");
  process.exitCode = 1;
});
