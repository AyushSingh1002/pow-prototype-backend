import { Pool } from "pg";
import { env } from "./env";

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
  }

  if (!pool) {
    const connectionString = env.DATABASE_URL.replace(
      /([?&])sslmode=require\b/,
      "$1uselibpqcompat=true&sslmode=require"
    );
    pool = new Pool({
      connectionString,
      ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return pool;
}
